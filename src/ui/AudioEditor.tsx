/** Audio Editor: waveform view with selection, slicing (playhead/equal/transient),
 * normalize/gain/fade/reverse/pitch/stretch (all non-destructive: results are new
 * assets), zero-crossing snap, BPM/key estimates, send-to Drum Rack/Playlist/Sampler. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudio } from "../state/store";
import { ensureAssetLoaded, assetPeaks, assetFromChannelData, sliceAsset } from "../audio/assets";
import { runAnalysis } from "../workers/analysis-client";
import { engine } from "../engine/engine";
import { nearestZeroCrossing, normalizeBuffer, detectSilence, extractMelody } from "../engine/analysis";
import { secondsToTicks } from "../../shared/time";
import { PulseTunePanel } from "./PulseTune";
import { StemExtractor } from "./StemExtractor";
import { resampleLinear } from "../engine/dsp";
import { clamp } from "../../shared/time";

export function AudioEditor() {
  const { project, selection, select, update, addAsset, dispatch, toast, setTab, zoom, setZoom } = useStudio();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null); // seconds
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [transients, setTransients] = useState<number[]>([]);
  const [markers, setMarkers] = useState<number[]>([]); // slice markers in seconds
  const [busy, setBusy] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [stemsOpen, setStemsOpen] = useState(false);
  const [zeroSnap, setZeroSnap] = useState(true);
  const stopPreview = useRef<(() => void) | null>(null);

  const asset = project.assets.find((a) => a.id === selection.assetId) ?? project.assets[0];
  const zoomX = zoom.audio;

  useEffect(() => {
    setSel(null);
    setMarkers([]);
    setTransients([]);
    setBuffer(null);
    setPeaks(null);
    if (!asset) return;
    let alive = true;
    (async () => {
      const buf = await ensureAssetLoaded(asset);
      if (!alive || !buf) return;
      setBuffer(buf);
      const pk = await assetPeaks(asset, 2000);
      if (alive) setPeaks(pk);
    })();
    return () => { alive = false; };
  }, [asset?.id]);

  const W = Math.max(800, Math.floor(1200 * zoomX));
  const H = 320;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!peaks || !buffer) {
      ctx.fillStyle = "#5a6478";
      ctx.font = "13px sans-serif";
      ctx.fillText(asset ? "Loading waveform…" : "Select or import an audio asset (Browser panel → Project Assets, or drop a file).", 20, 40);
      return;
    }
    const mid = H / 2;
    ctx.fillStyle = "#131826";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#2c3650";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();
    const buckets = peaks.length / 2;
    ctx.fillStyle = "#4cc2ff";
    for (let i = 0; i < buckets; i++) {
      const x = (i / buckets) * W;
      const mn = peaks[i * 2]!;
      const mx = peaks[i * 2 + 1]!;
      ctx.fillRect(x, mid - mx * mid * 0.95, Math.max(1, W / buckets), Math.max(1, (mx - mn) * mid * 0.95));
    }
    // selection
    if (sel) {
      const x0 = (sel.start / buffer.duration) * W;
      const x1 = (sel.end / buffer.duration) * W;
      ctx.fillStyle = "rgba(232,102,60,0.25)";
      ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.strokeStyle = "#e8663c";
      ctx.strokeRect(x0, 0, x1 - x0, H);
    }
    // slice markers
    ctx.strokeStyle = "#ffd166";
    for (const m of markers) {
      const x = (m / buffer.duration) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillStyle = "#ffd166";
      ctx.fillText("▼", x - 4, 12);
    }
    // transients
    ctx.strokeStyle = "rgba(142,245,138,0.5)";
    for (const t of transients) {
      const x = (t / buffer.length) * W;
      ctx.beginPath();
      ctx.moveTo(x, H - 30);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }, [peaks, buffer, sel, markers, transients, W, asset]);

  const secAtX = useCallback((clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, W);
    let sec = (x / W) * (buffer?.duration ?? 0);
    if (zeroSnap && buffer) {
      const idx = nearestZeroCrossing(buffer.getChannelData(0), Math.floor(sec * buffer.sampleRate));
      sec = idx / buffer.sampleRate;
    }
    return sec;
  }, [buffer, W, zeroSnap]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!buffer) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const start = secAtX(e.clientX);
    setSel({ start, end: start });
    const move = (ev: PointerEvent) => setSel((s) => (s ? { ...s, end: secAtX(ev.clientX) } : s));
    const up = () => {
      setSel((s) => (s && Math.abs(s.end - s.start) < 0.005 ? null : s && s.end < s.start ? { start: s.end, end: s.start } : s));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!asset) {
    return <div className="rack"><p className="dim">No audio assets yet. Import audio in the Browser panel (left), record in the Recording Studio, or generate in the Sound Lab.</p></div>;
  }

  const selRange = sel && sel.end > sel.start ? sel : buffer ? { start: 0, end: buffer.duration } : null;

  // ---------- operations (all create new assets or update in place non-destructively) ----------
  const getSelData = (): Float32Array[] | null => {
    if (!buffer || !selRange) return null;
    const s = Math.floor(selRange.start * buffer.sampleRate);
    const e = Math.ceil(selRange.end * buffer.sampleRate);
    const out: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) out.push(buffer.getChannelData(c).slice(s, e));
    return out;
  };

  const makeAsset = async (name: string, data: Float32Array[], tag: string) => {
    const created = await assetFromChannelData(name, data, buffer!.sampleRate, "slice", { tags: [tag] });
    addAsset(created);
    select({ assetId: created.id });
    toast(`Created "${created.name}"`, "success");
    return created;
  };

  const ops = {
    preview: async () => {
      if (!buffer) return;
      stopPreview.current?.();
      if (selRange && (selRange.start > 0 || selRange.end < buffer.duration)) {
        const data = getSelData()!;
        const ctxBuf = new AudioBuffer({ length: data[0]!.length, numberOfChannels: data.length, sampleRate: buffer.sampleRate });
        data.forEach((d, i) => ctxBuf.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        stopPreview.current = engine.previewBuffer(ctxBuf);
      } else {
        stopPreview.current = engine.previewBuffer(buffer);
      }
    },
    stop: () => stopPreview.current?.(),
    crop: async () => {
      const data = getSelData();
      if (data) await makeAsset(`${asset.name} crop`, data, "crop");
    },
    normalize: async () => {
      const data = getSelData();
      if (data) await makeAsset(`${asset.name} norm`, data.map((d) => normalizeBuffer(d)), "normalized");
    },
    gain: async (db: number) => {
      const data = getSelData();
      if (!data) return;
      const g = Math.pow(10, db / 20);
      await makeAsset(`${asset.name} ${db > 0 ? "+" : ""}${db}dB`, data.map((d) => d.map((v) => clamp(v * g, -1, 1))), "gain");
    },
    fade: async (dir: "in" | "out") => {
      const data = getSelData();
      if (!data) return;
      const n = data[0]!.length;
      await makeAsset(`${asset.name} fade-${dir}`, data.map((d) => d.map((v, i) => v * (dir === "in" ? i / n : 1 - i / n))), "fade");
    },
    reverse: async () => {
      const data = getSelData();
      if (data) await makeAsset(`${asset.name} rev`, data.map((d) => d.slice().reverse()), "reversed");
    },
    pitch: async (semitones: number) => {
      const data = getSelData();
      if (!data || !buffer) return;
      const ratio = Math.pow(2, semitones / 12);
      await makeAsset(`${asset.name} ${semitones > 0 ? "+" : ""}${semitones}st`, data.map((d) => resampleLinear(d, buffer.sampleRate * ratio, buffer.sampleRate)), "pitched");
    },
    stretch: async (factor: number) => {
      const data = getSelData();
      if (!data || !buffer) return;
      await makeAsset(`${asset.name} ×${factor}`, data.map((d) => resampleLinear(d, buffer.sampleRate, buffer.sampleRate * factor)), "stretched");
    },
    sliceAtPlayhead: () => {
      if (!buffer) return;
      const sec = clamp((usePlayheadTicksToSec()), 0, buffer.duration);
      setMarkers((m) => [...new Set([...m, sec])].sort((a, b) => a - b));
    },
    sliceEqual: (n: number) => {
      if (!buffer) return;
      const r = selRange ?? { start: 0, end: buffer.duration };
      const out: number[] = [];
      for (let i = 1; i < n; i++) out.push(r.start + ((r.end - r.start) * i) / n);
      setMarkers((m) => [...new Set([...m, ...out])].sort((a, b) => a - b));
    },
    detectTransients: async () => {
      if (!buffer) return;
      setBusy(true);
      const { promise } = runAnalysis("transients", buffer.getChannelData(0), buffer.sampleRate);
      const res = await promise;
      setTransients(res.transients ?? []);
      setMarkers((m) => [...new Set([...m, ...(res.transients ?? []).map((t) => t / buffer.sampleRate)])].sort((a, b) => a - b));
      setBusy(false);
      toast(`${res.transients?.length ?? 0} transients marked`, "success");
    },
    toMidi: () => {
      if (!buffer) return;
      const sr = buffer.sampleRate;
      const r = selRange ?? { start: 0, end: buffer.duration };
      const mono = buffer.getChannelData(0).slice(Math.floor(r.start * sr), Math.floor(r.end * sr));
      const found = extractMelody(mono, sr);
      if (!found.length) return toast("No clear melody detected — works best on a clean solo hum/voice/instrument", "error");
      const st = useStudio.getState();
      st.dispatch({ type: "createChannel", name: "Hummed Melody", instrument: { type: "synth", synthId: "subtractive", presetId: "synth-lead", params: {} } });
      const chan = useStudio.getState().project.channels.at(-1)!;
      st.dispatch({ type: "createPattern", name: "Hummed Melody", lengthSteps: 32 });
      const pat = useStudio.getState().project.patterns.at(-1)!;
      const bpm = st.project.bpm;
      st.dispatch({
        type: "addNotes", patternId: pat.id, channelId: chan.id, replace: true,
        notes: found.map((n) => ({
          pitch: clamp(n.midi, 24, 96),
          startTick: secondsToTicks(n.startSec, bpm),
          lengthTicks: Math.max(60, secondsToTicks(n.durSec, bpm)),
          velocity: n.velocity, pan: 0, probability: 1,
        })),
      });
      st.select({ channelId: chan.id, patternId: pat.id });
      st.setTab("piano-roll");
      toast(`${found.length} notes transcribed (experimental) — review in Piano Roll`, "success");
    },
    detectSilence: () => {
      if (!buffer) return;
      const regions = detectSilence(buffer.getChannelData(0), buffer.sampleRate);
      if (!regions.length) return toast("No silent regions found");
      setMarkers((m) => [...new Set([...m, ...regions.flatMap(([s, e]) => [s / buffer.sampleRate, e / buffer.sampleRate])])].sort((a, b) => a - b));
      toast(`${regions.length} silent regions marked`);
    },
    slicesToAssets: async (): Promise<string[]> => {
      if (!buffer || !markers.length) {
        toast("Add slice markers first (equal divisions or transients)", "error");
        return [];
      }
      setBusy(true);
      const bounds = [0, ...markers, buffer.duration];
      const ids: string[] = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        if (bounds[i + 1]! - bounds[i]! < 0.02) continue;
        const s = await sliceAsset(asset, bounds[i]!, bounds[i + 1]!, `${asset.name} #${i + 1}`);
        addAsset(s);
        ids.push(s.id);
      }
      setBusy(false);
      toast(`Created ${ids.length} slices`, "success");
      return ids;
    },
    slicesToDrumRack: async () => {
      const ids = await ops.slicesToAssets();
      for (const id of ids) {
        const a = useStudio.getState().project.assets.find((x) => x.id === id)!;
        dispatch({
          type: "createChannel", name: a.name,
          instrument: { type: "sampler", assetId: a.id, params: {} as any },
        });
      }
      if (ids.length) { toast(`${ids.length} slices added as sampler channels`, "success"); setTab("channel-rack"); }
    },
    selectionToPlaylist: () => {
      const track = project.tracks.find((t) => t.kind === "audio") ?? project.tracks[0];
      if (!track) return toast("Add a track in the Playlist first", "error");
      dispatch({ type: "placeAudioClip", trackId: track.id, assetId: asset.id, startTick: 0 });
      toast(`"${asset.name}" placed in Playlist`, "success");
      setTab("playlist");
    },
    selectionToSampler: async () => {
      let target = asset;
      if (selRange && buffer && (selRange.start > 0 || selRange.end < buffer.duration)) {
        target = await sliceAsset(asset, selRange.start, selRange.end, `${asset.name} zone`);
        addAsset(target);
      }
      dispatch({
        type: "createChannel", name: `${target.name} sampler`,
        instrument: { type: "sampler", assetId: target.id, params: {} as any },
      });
      toast("Sampler instrument created — play it from the Piano Roll", "success");
      setTab("channel-rack");
    },
    setLoopPoints: () => {
      if (!selRange || !buffer) return;
      // store loop points on any sampler channels using this asset
      const chans = project.channels.filter((c) => c.instrument.type === "sampler" && c.instrument.assetId === asset.id);
      if (!chans.length) return toast("No sampler instrument uses this asset yet — create one first", "error");
      update((p) => ({
        ...p,
        channels: p.channels.map((c) =>
          c.instrument.type === "sampler" && c.instrument.assetId === asset.id
            ? { ...c, instrument: { ...c.instrument, params: { ...c.instrument.params, loop: true, loopStartNorm: selRange.start / buffer.duration, loopEndNorm: selRange.end / buffer.duration } } }
            : c,
        ),
      }));
      toast(`Loop points set on ${chans.length} sampler(s)`, "success");
    },
  };

  function usePlayheadTicksToSec(): number {
    // slice-at-playhead uses preview time = not tracked; approximate with selection start or middle
    return sel?.start ?? (buffer?.duration ?? 0) / 2;
  }

  return (
    <div className="audio-editor">
      <div className="ae-toolbar">
        <select className="sel" value={asset.id} onChange={(e) => select({ assetId: e.target.value })} aria-label="Asset">
          {project.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn small" onClick={ops.preview} title="Preview selection or whole asset">▶ Preview</button>
        <button className="btn small" onClick={ops.stop}>■</button>
        <label className="row small dim" title="Snap selection edges to zero crossings">
          <input type="checkbox" checked={zeroSnap} onChange={(e) => setZeroSnap(e.target.checked)} />zero-x
        </label>
        <span className="dim small">|</span>
        <button className="btn small" onClick={ops.crop} title="Selection → new trimmed asset">Crop</button>
        <button className="btn small" onClick={ops.normalize}>Normalize</button>
        <button className="btn small" onClick={() => ops.gain(3)}>+3dB</button>
        <button className="btn small" onClick={() => ops.gain(-3)}>−3dB</button>
        <button className="btn small" onClick={() => ops.fade("in")}>Fade In</button>
        <button className="btn small" onClick={() => ops.fade("out")}>Fade Out</button>
        <button className="btn small" onClick={ops.reverse}>Reverse</button>
        <button className="btn small" onClick={() => ops.pitch(Number(prompt("Pitch shift (semitones, ±24; repitch-style)", "2")) || 0)}>Pitch…</button>
        <button className="btn small" onClick={() => ops.stretch(clamp(Number(prompt("Stretch factor (0.5 = half length, 2 = double; repitch-style)", "1.5")) || 1, 0.25, 4))}>Stretch…</button>
        <span className="dim small">|</span>
        <button className="btn small" onClick={() => ops.sliceEqual(Number(prompt("Slice into how many equal pieces?", "4")) || 4)}>Slice ÷n</button>
        <button className="btn small" onClick={ops.detectTransients} disabled={busy}>Transients</button>
        <button className="btn small" onClick={ops.detectSilence}>Silence</button>
        <button className="btn small" onClick={ops.toMidi}
          title="EXPERIMENTAL: transcribe a hummed/sung monophonic melody to Piano Roll notes">♪ To MIDI ⚗</button>
        <button className="btn small" onClick={() => setTuneOpen(true)}
          title="EXPERIMENTAL: PulseTune pitch correction — creates a new tuned asset">PulseTune ⚗</button>
        <button className="btn small" onClick={() => setStemsOpen(true)}
          title="AI Stem Extractor — split this audio into vocals/drums/bass/other via a connected provider (uploads audio)">Stems ✂</button>
        <button className="btn small" onClick={() => setMarkers([])} disabled={!markers.length}>Clear marks</button>
        <div className="spacer" />
        <button className="btn small" title="Zoom out" onClick={() => setZoom("audio", Math.max(0.5, zoomX / 1.4))}>−</button>
        <button className="btn small" title="Zoom in" onClick={() => setZoom("audio", Math.min(8, zoomX * 1.4))}>+</button>
      </div>
      <div className="ae-toolbar" style={{ borderTop: "none" }}>
        <button className="btn small primary" onClick={ops.slicesToDrumRack} disabled={busy}>Slices → Drum Rack</button>
        <button className="btn small" onClick={ops.slicesToAssets} disabled={busy}>Slices → Library</button>
        <button className="btn small" onClick={ops.selectionToPlaylist}>→ Playlist</button>
        <button className="btn small" onClick={ops.selectionToSampler}>→ Sampler Instrument</button>
        <button className="btn small" onClick={ops.setLoopPoints}>Set Loop Points</button>
        <div className="spacer" />
        <span className="dim small mono">
          {buffer ? `${buffer.duration.toFixed(2)}s · ${buffer.sampleRate}Hz · ${buffer.numberOfChannels}ch` : ""}
          {asset.bpmEstimate ? ` · ~${asset.bpmEstimate} BPM (est.)` : ""}
          {asset.keyEstimate ? ` · ~${asset.keyEstimate} (est.)` : ""}
          {selRange && buffer ? ` · sel ${(selRange.end - selRange.start).toFixed(3)}s` : ""}
        </span>
      </div>
      <div className="ae-canvas-wrap" ref={wrapRef} style={{ overflowX: "auto" }}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} style={{ cursor: "text" }} />
      </div>
      <p className="dim small" style={{ padding: "4px 10px" }}>
        Edits never modify the original: every operation creates a new asset. Originals from imports & recordings stay recoverable in the Browser.
      </p>
      {stemsOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setStemsOpen(false)}>
          <div className="modal">
            <h2>Stem Extractor <span className="faint small">AI-powered stem separation</span></h2>
            <StemExtractor targetAssetId={asset.id} />
            <div className="row end" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setStemsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {tuneOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setTuneOpen(false)}>
          <div className="modal">
            <h2>PulseTune <span className="faint small">experimental pitch correction</span></h2>
            <PulseTunePanel targetAssetId={asset.id} onDone={(id: string) => { setTuneOpen(false); select({ assetId: id }); }} />
          </div>
        </div>
      )}
    </div>
  );
}
