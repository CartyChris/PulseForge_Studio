/**
 * End-to-end: real browser, real audio engine, real storage, production build.
 * Builds a complete test song (drums, bass, keys, mocked vocal, imported sample,
 * mocked AI composition, mocked AI audio asset), saves, reloads, re-verifies,
 * renders WAV offline and checks header/duration/non-silence.
 */
import { test, expect, type Page } from "@playwright/test";

async function appReady(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector(".topbar", { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__pulseforge?.useStudio.getState().projectLoaded, undefined, { timeout: 20000 });
  await page.click("body");
  await page.waitForFunction(async () => {
    const pf = (window as any).__pulseforge;
    await pf.engine.init();
    return pf.engine.initialized;
  }, undefined, { timeout: 20000 });
}

test.describe.configure({ mode: "serial" });

test("backend health & providers are served alongside the app", async ({ page }) => {
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).ok).toBe(true);
  const providers = await page.request.get("/api/providers");
  const list = (await providers.json()).providers;
  expect(list).toHaveLength(10);
  expect(JSON.stringify(list)).not.toMatch(/sk-[a-zA-Z0-9]/);
});

test("UI smoke: tabs, transport, step programming via clicks", async ({ page }) => {
  await appReady(page);
  // program a step by clicking the first step cell of the first channel
  await page.click('button.tab:has-text("Channel Rack")');
  const firstStep = page.locator(".rack-row").first().locator(".step").first();
  await firstStep.click();
  const stepCount = await page.evaluate(() => {
    const s = (window as any).__pulseforge.useStudio.getState();
    const pat = s.project.patterns.find((p: any) => p.id === s.selection.patternId) ?? s.project.patterns[0];
    return Object.values(pat.steps).flat().length;
  });
  expect(stepCount).toBeGreaterThan(0);

  // transport: play then verify audio-clock movement, then stop
  await page.click('button[aria-label="Play or pause"]');
  await page.waitForTimeout(1200);
  const pos = await page.evaluate(() => (window as any).__pulseforge.engine.positionTicks);
  expect(pos).toBeGreaterThan(0);
  await page.click('button[aria-label="Stop"]');
  const posAfter = await page.evaluate(() => (window as any).__pulseforge.engine.positionTicks);
  expect(posAfter).toBe(0);

  // every workspace tab renders
  for (const tab of ["Piano Roll", "Playlist", "Audio Editor", "Mixer", "Instrument", "Recording", "AI Assistant", "Sound Lab", "Resources"]) {
    await page.click(`button.tab:has-text("${tab}")`);
    await expect(page.locator(".workspace-body")).toBeVisible();
  }

  // command palette opens
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.locator(".palette input")).toBeVisible();
  await page.keyboard.press("Escape");
});

/**
 * Regression for the launch-day silence bug: a fresh project with rack steps but an
 * EMPTY playlist must be audible in pattern mode via the real play button, at the
 * project tempo, with the transport looping. (Guards the init/applyProject ordering
 * fix and the PAT-mode virtual clip.)
 */
test("pattern mode: fresh rack beat is audible through the play button", async ({ page }) => {
  await appReady(page);
  await page.click('button.tab:has-text("Channel Rack")');
  // four-on-the-floor on channel 0 + offbeats on channel 3 via real clicks
  const rows = page.locator(".rack-row");
  for (const i of [0, 4, 8, 12]) await rows.nth(0).locator(".step").nth(i).click();
  for (const i of [2, 6, 10, 14]) await rows.nth(3).locator(".step").nth(i).click();

  await page.click('button[aria-label="Play or pause"]');
  const result = await page.evaluate(async () => {
    const pf = (window as any).__pulseforge;
    const eng = pf.engine;
    const ctx = eng.masterTap.context.rawContext;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    eng.masterTap.output.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]!); if (a > peak) peak = a; }
      await new Promise((r) => setTimeout(r, 50));
    }
    const tr = eng.masterTap.context.transport;
    return { peak, bpm: tr.bpm.value, loop: tr.loop, mode: eng.playMode };
  });
  await page.click('button[aria-label="Stop"]');
  expect(result.mode).toBe("pattern");
  expect(result.loop).toBe(true);
  const projectBpm = (await page.evaluate(() => (window as any).__pulseforge.useStudio.getState().project.bpm)) as number;
  expect(Math.round(result.bpm)).toBe(projectBpm);
  expect(result.peak).toBeGreaterThan(0.05); // audibly non-silent at the master tap
});

test("full song: build, save, reload, verify, export WAV (non-silent)", async ({ page }) => {
  test.setTimeout(240_000);
  await appReady(page);

  const built = await page.evaluate(async () => {
    const pf = (window as any).__pulseforge;
    const store = pf.useStudio.getState();

    // fresh 90 BPM project
    const tpl = pf.PROJECT_TEMPLATES.find((t: any) => t.id === "hiphop-90");
    const project = { ...tpl.create(), name: "E2E Song", bpm: 90 };
    await pf.saveProject(project);
    store.setProject(project);

    const s = () => pf.useStudio.getState();
    const dispatch = (cmd: any) => {
      s().dispatch(cmd);
      const toasts = s().toasts.filter((t: any) => t.kind === "error");
      if (toasts.length) throw new Error(`Command failed: ${JSON.stringify(cmd)}: ${toasts[0].text}`);
    };

    // --- drums (built-in kit channels came from the template) ---
    const p0 = s().project;
    const kick = p0.channels.find((c: any) => c.name === "Kick");
    const snare = p0.channels.find((c: any) => c.name === "Snare");
    const hat = p0.channels.find((c: any) => c.name === "Hat Closed");
    const pattern = p0.patterns[0];
    dispatch({ type: "setSteps", patternId: pattern.id, channelId: kick.id, steps: [0, 6, 8, 14].map((i) => ({ index: i, velocity: 0.95, probability: 1, micro: 0 })) });
    dispatch({ type: "setSteps", patternId: pattern.id, channelId: snare.id, steps: [4, 12].map((i) => ({ index: i, velocity: 0.9, probability: 1, micro: 0 })) });
    dispatch({ type: "setSteps", patternId: pattern.id, channelId: hat.id, steps: Array.from({ length: 8 }, (_, k) => ({ index: k * 2, velocity: 0.6, probability: 1, micro: 0 })) });

    // --- 808 bass + piano ---
    dispatch({ type: "createChannel", name: "808 Bass", instrument: { type: "synth", synthId: "bass808", presetId: "bass-808", params: {} } });
    dispatch({ type: "createChannel", name: "Keys", instrument: { type: "synth", synthId: "piano", presetId: "piano-studio", params: {} } });
    const bass = s().project.channels.find((c: any) => c.name === "808 Bass");
    const keys = s().project.channels.find((c: any) => c.name === "Keys");
    dispatch({
      type: "addNotes", patternId: pattern.id, channelId: bass.id, replace: true,
      notes: [
        { pitch: 41, startTick: 0, lengthTicks: 144, velocity: 0.95, pan: 0, probability: 1 },
        { pitch: 44, startTick: 192, lengthTicks: 96, velocity: 0.9, pan: 0, probability: 1 },
        { pitch: 36, startTick: 288, lengthTicks: 96, velocity: 0.95, pan: 0, probability: 1 },
      ],
    });
    dispatch({
      type: "addNotes", patternId: pattern.id, channelId: keys.id, replace: true,
      notes: [
        { pitch: 65, startTick: 0, lengthTicks: 192, velocity: 0.7, pan: 0, probability: 1 },
        { pitch: 68, startTick: 0, lengthTicks: 192, velocity: 0.7, pan: 0, probability: 1 },
        { pitch: 72, startTick: 0, lengthTicks: 192, velocity: 0.7, pan: 0, probability: 1 },
        { pitch: 77, startTick: 192, lengthTicks: 96, velocity: 0.8, pan: 0, probability: 1 },
      ],
    });

    // --- arrange: intro + verse + chorus + outro on the template's Drums track ---
    const track = s().project.tracks[0];
    dispatch({ type: "placePatternClip", trackId: track.id, patternId: pattern.id, startTick: 0, lengthTicks: 1536 });
    dispatch({ type: "duplicateSection", startTick: 0, lengthTicks: 1536, toTick: 1536, name: "Verse" });
    dispatch({ type: "addSection", name: "Intro", startTick: 0, lengthTicks: 1536 });

    // --- imported sample (synthetic, programmatic) ---
    const rate = 44100;
    const sine = new Float32Array(rate * 2);
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * Math.exp(-i / (rate * 0.7)) * 0.8;
    const imported = await pf.assetFromChannelData("Imported Pluck", [sine], rate, "import", {});
    s().addAsset(imported);

    // --- slice into 4 pieces, rearrange 2 of them on an audio track ---
    dispatch({ type: "createTrack", name: "Chops", kind: "audio" });
    const chopTrack = s().project.tracks.find((t: any) => t.name === "Chops");
    const sliceIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const sl = await pf.sliceAsset(imported, i * 0.5, (i + 1) * 0.5, `chop ${i + 1}`);
      s().addAsset(sl);
      sliceIds.push(sl.id);
    }
    dispatch({ type: "placeAudioClip", trackId: chopTrack.id, assetId: sliceIds[3], startTick: 3072, lengthTicks: 96 });
    dispatch({ type: "placeAudioClip", trackId: chopTrack.id, assetId: sliceIds[0], startTick: 3168, lengthTicks: 96 });
    dispatch({ type: "placeAudioClip", trackId: chopTrack.id, assetId: sliceIds[2], startTick: 3264, lengthTicks: 96 });

    // --- mocked vocal recording (synthetic voiced buzz) + Clean Rap style chain ---
    const vox = new Float32Array(rate * 2);
    for (let i = 0; i < vox.length; i++) {
      const t = i / rate;
      vox[i] = (Math.sin(2 * Math.PI * 140 * t) * 0.4 + Math.sin(2 * Math.PI * 280 * t) * 0.2) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t));
    }
    const vocal = await pf.assetFromChannelData("Mock Vocal Take", [vox], rate, "recording", {});
    s().addAsset(vocal);
    dispatch({ type: "createTrack", name: "Vocals", kind: "audio" });
    const voxTrack = s().project.tracks.find((t: any) => t.name === "Vocals");
    dispatch({ type: "placeAudioClip", trackId: voxTrack.id, assetId: vocal.id, startTick: 1536 });
    dispatch({ type: "addEffect", mixerChannelId: voxTrack.mixerChannelId, effectType: "compressor", params: { threshold: -18, ratio: 4, makeup: 4 } });
    dispatch({ type: "addEffect", mixerChannelId: voxTrack.mixerChannelId, effectType: "eq3", params: { low: -2, high: 2 } });

    // --- mocked AI structured composition -> alternate chorus ---
    const comp = pf.validateComposition({
      version: 1, title: "Alt Chorus", bpm: 90, key: "F", scale: "minor",
      sections: [{
        name: "Alt Chorus", role: "chorus", lengthBars: 4,
        drumPattern: [
          { sound: "kick", step: 0 }, { sound: "kick", step: 10 }, { sound: "clap", step: 4 }, { sound: "clap", step: 12 },
          { sound: "hat-closed", step: 2 }, { sound: "hat-closed", step: 6 }, { sound: "hat-closed", step: 14 },
        ],
        bassNotes: [{ pitch: 41, startStep: 0, lengthSteps: 8, velocity: 0.9 }],
        melodyNotes: [{ pitch: 77, startStep: 0, lengthSteps: 2 }, { pitch: 80, startStep: 4, lengthSteps: 2 }, { pitch: 84, startStep: 8, lengthSteps: 4 }],
      }],
    });
    s().update((p: any) => pf.insertComposition(p, comp, { mode: "alternate", applyTempo: false }));

    // --- mocked AI-generated audio asset, chopped & layered ---
    const aiBuf = new Float32Array(rate);
    for (let i = 0; i < aiBuf.length; i++) aiBuf[i] = Math.sin((2 * Math.PI * 660 * i) / rate) * Math.exp(-i / (rate * 0.25)) * 0.7;
    const aiAsset = await pf.assetFromChannelData("Mock AI Sound", [aiBuf], rate, "ai", {
      licenseNote: "mock generation (test)",
      aiMeta: { providerId: "mock", model: "test", prompt: "test tone", jobId: "j1", createdAt: "" },
    });
    s().addAsset(aiAsset);
    const aiSlice = await pf.sliceAsset(aiAsset, 0, 0.4, "AI chop");
    s().addAsset(aiSlice);
    dispatch({ type: "placeAudioClip", trackId: chopTrack.id, assetId: aiSlice.id, startTick: 0, lengthTicks: 192 });

    await s().save();
    const p = s().project;
    return {
      id: p.id,
      counts: { tracks: p.tracks.length, channels: p.channels.length, patterns: p.patterns.length, clips: p.clips.length, assets: p.assets.length, sections: p.sections.length },
    };
  });

  expect(built.counts.tracks).toBeGreaterThanOrEqual(4);
  expect(built.counts.assets).toBeGreaterThanOrEqual(8);
  expect(built.counts.patterns).toBeGreaterThanOrEqual(2);
  expect(built.counts.clips).toBeGreaterThanOrEqual(8);

  // ---- restart the app (reload) and verify everything came back ----
  await page.reload();
  await page.waitForSelector(".topbar");
  await page.waitForFunction(() => (window as any).__pulseforge?.useStudio.getState().projectLoaded, undefined, { timeout: 20000 });
  await page.click("body");

  const reloaded = await page.evaluate(async () => {
    const pf = (window as any).__pulseforge;
    const s = pf.useStudio.getState();
    await pf.ensureProjectAssetsLoaded(s.project);
    const p = s.project;
    const buffersLoaded = p.assets.filter((a: any) => pf.engine.getAssetBuffer(a.id)).length;
    return {
      id: p.id, name: p.name, bpm: p.bpm,
      counts: { tracks: p.tracks.length, channels: p.channels.length, patterns: p.patterns.length, clips: p.clips.length, assets: p.assets.length, sections: p.sections.length },
      buffersLoaded,
      sectionNames: p.sections.map((x: any) => x.name),
    };
  });
  expect(reloaded.id).toBe(built.id);
  expect(reloaded.name).toBe("E2E Song");
  expect(reloaded.bpm).toBe(90);
  expect(reloaded.counts).toEqual(built.counts);
  expect(reloaded.buffersLoaded).toBe(built.counts.assets);
  expect(reloaded.sectionNames).toContain("Alt Chorus");

  // ---- offline WAV export: header, duration, non-silence ----
  const wav = await page.evaluate(async () => {
    const pf = (window as any).__pulseforge;
    const s = pf.useStudio.getState();
    await pf.ensureProjectAssetsLoaded(s.project);
    const out = await pf.renderProjectToWav(s.project, (id: string) => pf.engine.getAssetBuffer(id), { sampleRate: 44100, bitDepth: 16, tailSec: 1 }, "e2e");
    if (!out) return null;
    const header = pf.parseWavHeader(out.wav);
    const { channelData } = pf.decodeWavSamples(out.wav);
    return { header, peak: pf.peakLevel(channelData), bytes: out.wav.byteLength, clipped: out.result.clipped };
  });
  expect(wav).not.toBeNull();
  expect(wav!.header.sampleRate).toBe(44100);
  expect(wav!.header.channels).toBe(2);
  expect(wav!.header.bitDepth).toBe(16);
  expect(wav!.header.durationSec).toBeGreaterThan(20); // ~4 bars x N sections at 90bpm + tail
  expect(wav!.peak).toBeGreaterThan(0.05); // audibly non-silent
});

test("recording studio captures from the fake microphone", async ({ page }) => {
  test.setTimeout(120_000);
  await appReady(page);
  await page.click('button.tab:has-text("Recording")');
  await page.click('button:has-text("Enable Microphone")');
  await page.waitForSelector(".input-meter", { timeout: 15000 });
  await page.click('button:has-text("Start Recording")');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Stop & Save Take")');
  await page.waitForFunction(() => (window as any).__pulseforge.useStudio.getState().project.takes.length > 0, undefined, { timeout: 20000 });
  const take = await page.evaluate(() => {
    const s = (window as any).__pulseforge.useStudio.getState();
    const t = s.project.takes[0];
    const asset = s.project.assets.find((a: any) => a.id === t.assetId);
    return { duration: asset?.durationSec ?? 0, clipPlaced: s.project.clips.some((c: any) => c.assetId === t.assetId) };
  });
  expect(take.duration).toBeGreaterThan(0.5);
  expect(take.clipPlaced).toBe(true);
});

test("AI edit plan applies through validated commands and is undoable", async ({ page }) => {
  await appReady(page);
  const result = await page.evaluate(() => {
    const pf = (window as any).__pulseforge;
    const s = pf.useStudio.getState();
    const before = s.project.bpm;
    const plan = pf.validateEditPlan({
      version: 1, title: "test", explanation: "",
      commands: [{ type: "setBpm", bpm: 123 }, { type: "createTrack", name: "AI Track", kind: "pattern" }],
    });
    const ok = s.dispatchMany(plan.commands);
    const mid = pf.useStudio.getState().project;
    pf.useStudio.getState().undo();
    const after = pf.useStudio.getState().project;
    return { ok, before, midBpm: mid.bpm, midTracks: mid.tracks.length, afterBpm: after.bpm, afterTracks: after.tracks.length };
  });
  expect(result.ok).toBe(true);
  expect(result.midBpm).toBe(123);
  expect(result.afterBpm).toBe(result.before);
  expect(result.midTracks).toBe(result.afterTracks + 1);
});

test("invalid AI plans are rejected atomically (no partial application)", async ({ page }) => {
  await appReady(page);
  const result = await page.evaluate(() => {
    const pf = (window as any).__pulseforge;
    const s = pf.useStudio.getState();
    const before = JSON.stringify({ bpm: s.project.bpm, tracks: s.project.tracks.length });
    const ok = s.dispatchMany([
      { type: "setBpm", bpm: 150 },
      { type: "placePatternClip", trackId: "nonexistent", patternId: "nope", startTick: 0 },
    ]);
    const p = pf.useStudio.getState().project;
    return { ok, unchanged: before === JSON.stringify({ bpm: p.bpm, tracks: p.tracks.length }) };
  });
  expect(result.ok).toBe(false);
  expect(result.unchanged).toBe(true);
});
