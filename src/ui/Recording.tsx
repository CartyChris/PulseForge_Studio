/** Recording Studio: mic onboarding, device select, metering, monitoring, count-in,
 * punch in/out, loop takes, comping lanes, latency calibration, vocal chain presets. */
import { useEffect, useRef, useState } from "react";
import { useStudio, usePlayhead } from "../state/store";
import { recorder, type InputDevice, type RecorderState } from "../engine/recorder";
import { engine } from "../engine/engine";
import { importAudioData, ensureAssetLoaded, assetFromChannelData } from "../audio/assets";
import { normalizeBuffer } from "../engine/analysis";
import { secondsToTicks, ticksPerBar } from "../../shared/time";
import { newId } from "../../shared/project";
import { EFFECT_CHAIN_PRESETS } from "../engine/effects";
import { PulseTunePanel } from "./PulseTune";
import type { EffectInstance } from "../../shared/project";

const VOCAL_PRESETS = ["Clean Rap", "Aggressive Rap", "Melodic Rap", "Intimate Vocal", "Ad-Lib Wide", "Vocal Double", "Lo-Fi Vocal", "Telephone Vocal", "Podcast Voice", "Harmonized Vocal", "Background Vocal"];

export function Recording() {
  const { project, update, dispatch, addAsset, toast, setFlags, setTab, select } = useStudio();
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [rec, setRec] = useState<RecorderState>(recorder.state);
  const [punchIn, setPunchIn] = useState(0);
  const [punchOut, setPunchOut] = useState(0);
  const [usePunch, setUsePunch] = useState(false);
  const [loopTakes, setLoopTakes] = useState(false);
  const [autoTrim, setAutoTrim] = useState(true);
  const [autoNormalize, setAutoNormalize] = useState(false);
  const [latencyMs, setLatencyMs] = useState(recorder.latencyCompMs);
  const [calibrating, setCalibrating] = useState(false);
  const stopRef = useRef<null | (() => Promise<{ blob: Blob; startedAtAudioTime: number }>)>(null);
  const recordStartTickRef = useRef(0);

  useEffect(() => {
    const unsub = recorder.subscribe((s) => {
      setRec(s);
      setFlags({ micActive: s.active, recording: s.recording });
    });
    return () => { unsub(); };
  }, [setFlags]);

  useEffect(() => () => { if (!recorder.isCapturing()) recorder.close(); }, []);

  const openMic = async (id?: string) => {
    try {
      await recorder.open(id || undefined);
      const list = await recorder.listDevices();
      setDevices(list);
      toast("Microphone connected", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const vocalTrack = () => {
    let track = project.tracks.find((t) => t.kind === "audio" && t.name.toLowerCase().includes("vocal"));
    if (!track) {
      dispatch({ type: "createTrack", name: "Vocals", kind: "audio", color: "#ff7bd5" });
      track = useStudio.getState().project.tracks.at(-1)!;
    }
    return track;
  };

  const startRecording = async () => {
    if (!rec.active) return toast("Open the microphone first", "error");
    await engine.init();
    const track = vocalTrack();
    // count-in: start transport countInBars earlier by scheduling start after metronome pre-roll
    const countTicks = project.countInBars * ticksPerBar(project.timeSignature);
    const startTick = usePlayhead.getState().ticks;
    recordStartTickRef.current = startTick;
    if (countTicks > 0) {
      const wasMetro = project.metronome;
      if (!wasMetro) update((p) => ({ ...p, metronome: true }), { undoable: false });
      await engine.play(Math.max(0, startTick - countTicks));
      // begin capture when playhead crosses startTick
      const waitForPunch = () => new Promise<void>((resolve) => {
        const check = () => {
          if (!engine.playing || engine.positionTicks >= startTick - 6) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      await waitForPunch();
      if (!wasMetro) update((p) => ({ ...p, metronome: false }), { undoable: false });
    } else {
      await engine.play(startTick);
    }
    const capture = recorder.startCapture();
    stopRef.current = capture.stop;
    toast(`Recording onto "${track.name}"…`, "info");

    if (usePunch && punchOut > punchIn) {
      const checkOut = () => {
        if (!recorder.isCapturing()) return;
        if (engine.positionTicks >= punchOut) stopRecording();
        else requestAnimationFrame(checkOut);
      };
      requestAnimationFrame(checkOut);
    }
  };

  const stopRecording = async () => {
    const stop = stopRef.current;
    if (!stop) return;
    stopRef.current = null;
    engine.pause();
    try {
      const { blob } = await stop();
      const data = await blob.arrayBuffer();
      if (data.byteLength < 2000) return toast("Recording was empty", "error");
      const takeNum = project.takes.length + 1;
      const asset = await importAudioData(`Take ${takeNum}`, data, "recording", {
        tags: ["vocal", "take"],
        licenseNote: "Your own recording.",
      });
      addAsset(asset); // dry original is ALWAYS preserved

      // optional post-processing: silence trim + normalize → separate "clean" asset
      let useAsset = asset;
      let trimShiftSec = 0;
      if (autoTrim || autoNormalize) {
        const buf = await ensureAssetLoaded(asset);
        if (buf) {
          const sr = buf.sampleRate;
          const d0 = buf.getChannelData(0);
          let first = 0, last = d0.length - 1;
          if (autoTrim) {
            const thr = Math.pow(10, -45 / 20);
            while (first < d0.length && Math.abs(d0[first]!) < thr) first++;
            while (last > first && Math.abs(d0[last]!) < thr) last--;
            const pad = Math.floor(sr * 0.05); // keep 50ms of air on each side
            first = Math.max(0, first - pad);
            last = Math.min(d0.length - 1, last + pad);
          }
          if (first < last && (autoNormalize || first > 0 || last < d0.length - 1)) {
            let chans: Float32Array[] = [];
            for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice(first, last + 1));
            if (autoNormalize) chans = chans.map((c) => normalizeBuffer(c, 0.95));
            const clean = await assetFromChannelData(`Take ${takeNum} (clean)`, chans, sr, "render", { tags: ["vocal", "take", "clean"] });
            addAsset(clean);
            useAsset = clean;
            trimShiftSec = first / sr;
          }
        }
      }

      const track = vocalTrack();
      // latency compensation shifts the clip earlier; head-trim shifts it later
      const compTicks = Math.round(secondsToTicks(recorder.latencyCompMs / 1000, project.bpm));
      const trimTicks = Math.round(secondsToTicks(trimShiftSec, project.bpm));
      const startTick = Math.max(0, (usePunch ? punchIn : recordStartTickRef.current) - compTicks + trimTicks);
      const lengthTicks = Math.max(24, Math.round(secondsToTicks(useAsset.durationSec, project.bpm)));
      const lane = loopTakes ? project.takes.filter((t) => t.trackId === track.id).length : 0;
      update((p) => ({
        ...p,
        takes: [...p.takes, { id: newId("take"), trackId: track.id, assetId: useAsset.id, startTick, lengthTicks, lane, active: true, recordedAt: new Date().toISOString() }],
      }));
      dispatch({ type: "placeAudioClip", trackId: track.id, assetId: useAsset.id, startTick });
      toast(`Take ${takeNum} saved (${asset.durationSec.toFixed(1)}s)${recorder.latencyCompMs ? ` · comp ${recorder.latencyCompMs}ms` : ""}`, "success");
      if (loopTakes && engine.playing === false && project.loop.enabled) {
        // loop recording: immediately start the next take
        setTimeout(() => startRecording(), 300);
      }
    } catch (e) {
      toast(`Recording failed to save — the raw audio may be recoverable from your browser cache. ${e}`, "error");
    }
  };

  const applyVocalChain = (presetName: string) => {
    const preset = EFFECT_CHAIN_PRESETS.find((p) => p.name === presetName);
    if (!preset) return;
    const track = vocalTrack();
    const mixerChannelId = track.mixerChannelId;
    if (!mixerChannelId) return toast("Vocal track has no mixer channel", "error");
    const effects: EffectInstance[] = preset.effects.map((fx) => ({ id: newId("fx"), type: fx.type, enabled: true, params: fx.params, presetName: preset.name }));
    update((p) => ({
      ...p,
      mixer: { channels: p.mixer.channels.map((c) => (c.id === mixerChannelId ? { ...c, effects } : c)) },
    }));
    toast(`"${preset.name}" chain applied to ${track.name}`, "success");
  };

  const takes = project.takes;
  const levelPct = Math.min(100, rec.level * 130);
  const outLatency = rec.active ? recorder.outputLatencyMs() : 0;

  return (
    <div className="rec-pane">
      <div className="rec-grid">
        <div className="card">
          <h3>1 · Microphone</h3>
          {!rec.active ? (
            <>
              <p className="dim small">PulseForge records locally — audio never leaves this Mac unless you explicitly send it to an AI provider. Your browser will ask for microphone permission.</p>
              <button className="btn primary" onClick={() => openMic()}>Enable Microphone</button>
              {rec.permission === "denied" && <p className="warn">Permission denied. Allow microphone access for this site in your browser settings (Safari/Chrome → Settings → Websites → Microphone), then retry.</p>}
            </>
          ) : (
            <>
              <div className="field"><label>Input device</label>
                <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); openMic(e.target.value); }}>
                  <option value="">Default input</option>
                  {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select></div>
              <div className="input-meter" title="Input level"><div className="fill" style={{ width: `${levelPct}%` }} /></div>
              <p className="dim small" style={{ marginTop: 6 }}>{rec.level > 0.98 ? "⚠ Input clipping — lower your input gain" : rec.level > 0.02 ? "Signal detected" : "No signal — check input"}</p>
              <label className="row small" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={rec.monitoring} onChange={(e) => recorder.setMonitoring(e.target.checked)} />
                Input monitoring (hear yourself)
              </label>
              {rec.monitoring && (
                <p className="warn">Monitoring adds ~{outLatency}ms of latency and can feedback through speakers — use headphones.</p>
              )}
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => recorder.close()}>Disable mic</button>
            </>
          )}
        </div>

        <div className="card">
          <h3>2 · Record</h3>
          <p className="dim small">Count-in: {project.countInBars} bar(s) (set in the top bar) · Metronome: {project.metronome ? "on" : "auto during count-in"}</p>
          <div className="row">
            {!rec.recording ? (
              <button className="btn primary" disabled={!rec.active} onClick={startRecording}>● Start Recording</button>
            ) : (
              <button className="btn danger" onClick={stopRecording}>■ Stop & Save Take</button>
            )}
          </div>
          <label className="row small" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={usePunch} onChange={(e) => setUsePunch(e.target.checked)} /> Punch in/out (ticks)
          </label>
          {usePunch && (
            <div className="row">
              <input className="num-input" type="number" value={punchIn} onChange={(e) => setPunchIn(Number(e.target.value))} title="Punch in tick" />
              <span className="dim">→</span>
              <input className="num-input" type="number" value={punchOut} onChange={(e) => setPunchOut(Number(e.target.value))} title="Punch out tick" />
              <button className="btn small" onClick={() => { setPunchIn(Math.round(usePlayhead.getState().ticks)); }}>in=playhead</button>
            </div>
          )}
          <label className="row small" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={loopTakes} onChange={(e) => setLoopTakes(e.target.checked)} /> Loop recording (stack takes in lanes)
          </label>
          <label className="row small dim" title="Trim leading/trailing silence from each take (dry original always kept)">
            <input type="checkbox" checked={autoTrim} onChange={(e) => setAutoTrim(e.target.checked)} /> Auto-trim silence
          </label>
          <label className="row small dim" title="Normalize each take to -0.5 dBFS (dry original always kept)">
            <input type="checkbox" checked={autoNormalize} onChange={(e) => setAutoNormalize(e.target.checked)} /> Auto-normalize takes
          </label>
          <p className="dim small" style={{ marginTop: 8 }}>Recording is dry — effects are applied on the mixer channel, the raw take is always preserved. Overdub by simply recording again over the same section.</p>
        </div>

        <div className="card">
          <h3>3 · Vocal chain</h3>
          <p className="dim small">One-click starting points applied to the Vocals mixer channel. They replace the channel's current effects.</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {VOCAL_PRESETS.map((name) => (
              <button key={name} className="btn small" onClick={() => applyVocalChain(name)}>{name}</button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>3b · PulseTune — pitch correction <span className="faint">(experimental)</span></h3>
          <PulseTunePanel />
        </div>

        <div className="card">
          <h3>4 · Latency calibration</h3>
          <p className="dim small">Reported output latency: ~{rec.active ? outLatency : "—"}ms. Recorded takes are shifted earlier by the compensation value so they line up with the beat.</p>
          <div className="row">
            <label className="small dim">Compensation</label>
            <input className="num-input" type="number" value={latencyMs} onChange={(e) => { setLatencyMs(Number(e.target.value)); recorder.setLatencyComp(Number(e.target.value)); }} />
            <span className="dim small">ms</span>
            <button className="btn small" disabled={!rec.active || calibrating} onClick={async () => {
              setCalibrating(true);
              toast("Calibrating: 4 clicks will play — let the mic hear them (speakers up)");
              const res = await recorder.calibrate();
              setCalibrating(false);
              if ("error" in res) toast(res.error, "error");
              else { setLatencyMs(res.measuredMs); toast(`Measured round-trip: ${res.measuredMs}ms — compensation set`, "success"); }
            }}>{calibrating ? "Listening…" : "Auto-calibrate"}</button>
          </div>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Takes ({takes.length})</h3>
          {!takes.length && <p className="dim small">No takes yet. Recorded takes appear here and as clips on the Vocals track.</p>}
          {takes.map((t) => {
            const asset = project.assets.find((a) => a.id === t.assetId);
            return (
              <div key={t.id} className="take-row">
                <span className={t.active ? "" : "faint"} style={{ flex: 1 }}>
                  {asset?.name ?? "missing"} · lane {t.lane + 1} · @{t.startTick}t · {asset ? `${asset.durationSec.toFixed(1)}s` : ""}
                </span>
                <button className="btn small" onClick={() => {
                  // comping: activate this take (mute clips of other takes on same lane region)
                  update((p) => ({
                    ...p,
                    takes: p.takes.map((x) => (x.trackId === t.trackId ? { ...x, active: x.id === t.id } : x)),
                    clips: p.clips.map((c) => {
                      const owner = p.takes.find((x) => x.assetId === c.assetId && c.trackId === x.trackId);
                      return owner && owner.trackId === t.trackId ? { ...c, muted: owner.id !== t.id } : c;
                    }),
                  }));
                  toast("Take promoted — other takes muted (comp)", "success");
                }}>Use</button>
                <button className="btn small" onClick={() => { select({ assetId: t.assetId }); setTab("audio-editor"); }}>Edit</button>
                <button className="btn small danger" onClick={() => {
                  update((p) => ({ ...p, takes: p.takes.filter((x) => x.id !== t.id) }));
                }}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
