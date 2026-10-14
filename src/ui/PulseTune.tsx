/** PulseTune — experimental pitch correction panel. Honest labeling: this is a
 * period-synchronous retuner built in-house, not professional Auto-Tune. Non-destructive:
 * always writes a NEW asset. Used in the Recording tab and as a modal in the Audio Editor. */
import { useState } from "react";
import { useStudio } from "../state/store";
import { pitchCorrect, type PitchCorrectOptions } from "../engine/analysis";
import { ensureAssetLoaded, assetFromChannelData } from "../audio/assets";
import { SCALES } from "../../shared/time";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface PulseTuneSettings {
  rootPc: number;
  scaleName: string;
  strength: number;   // 0..1
  retuneMs: number;   // 0 = hard tune
  humanize: number;   // 0..1
}

export const PULSETUNE_PRESETS: Record<string, Omit<PulseTuneSettings, "rootPc" | "scaleName">> = {
  "Natural":   { strength: 0.65, retuneMs: 90, humanize: 0.35 },
  "Tight":     { strength: 0.9,  retuneMs: 35, humanize: 0.15 },
  "Hard-Tune": { strength: 1,    retuneMs: 0,  humanize: 0 },
};

export function toDspOptions(s: PulseTuneSettings): PitchCorrectOptions {
  return { rootPc: s.rootPc, scale: SCALES[s.scaleName] ?? SCALES["chromatic"]!, strength: s.strength, retuneMs: s.retuneMs, humanize: s.humanize };
}

/** Process an asset through PulseTune → new asset added to the project. Returns new asset id. */
export async function applyPulseTune(assetId: string, settings: PulseTuneSettings): Promise<string> {
  const st = useStudio.getState();
  const asset = st.project.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error("Asset not found");
  const buf = await ensureAssetLoaded(asset);
  if (!buf) throw new Error("Asset audio could not be loaded");
  const opts = toDspOptions(settings);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    channels.push(pitchCorrect(buf.getChannelData(c), buf.sampleRate, opts));
  }
  const label = settings.retuneMs === 0 ? "hardtune" : "tuned";
  const newAsset = await assetFromChannelData(`${asset.name} (${label})`, channels, buf.sampleRate, "render");
  st.addAsset(newAsset);
  return newAsset.id;
}

export function PulseTunePanel({ targetAssetId, onDone }: { targetAssetId?: string; onDone?: (newAssetId: string) => void }) {
  const { project, toast } = useStudio();
  const [assetId, setAssetId] = useState(targetAssetId ?? "");
  const [settings, setSettings] = useState<PulseTuneSettings>({ rootPc: 0, scaleName: "minor", ...PULSETUNE_PRESETS["Natural"]! });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PulseTuneSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const chosenAsset = assetId || targetAssetId || "";

  const run = async () => {
    if (!chosenAsset) return toast("Pick a take or asset to tune first", "error");
    setBusy(true);
    try {
      const id = await applyPulseTune(chosenAsset, settings);
      toast("PulseTune applied — new tuned asset created (original untouched)", "success");
      onDone?.(id);
    } catch (e) {
      toast(`PulseTune failed: ${e}`, "error");
    }
    setBusy(false);
  };

  return (
    <div>
      <p className="faint small" style={{ marginTop: 0 }}>
        Experimental pitch correction (period-synchronous retuner). Works best on clean solo
        vocals. Formants shift with pitch — extreme settings sound robotic on purpose. Not
        affiliated with or equivalent to professional Auto-Tune.
      </p>
      {!targetAssetId && (
        <div className="field"><label>Audio to tune</label>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">— select a recorded take / asset —</option>
            {project.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>Key</label>
          <select value={settings.rootPc} onChange={(e) => set({ rootPc: Number(e.target.value) })}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select></div>
        <div className="field" style={{ flex: 2 }}><label>Scale</label>
          <select value={settings.scaleName} onChange={(e) => set({ scaleName: e.target.value })}>
            {Object.keys(SCALES).map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="field" style={{ flex: 1.5 }}><label>Style preset</label>
          <select value="" onChange={(e) => { const p = PULSETUNE_PRESETS[e.target.value]; if (p) set(p); }}>
            <option value="" disabled>apply…</option>
            {Object.keys(PULSETUNE_PRESETS).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></div>
      </div>
      <div className="knob-row"><label>Retune speed</label>
        <input type="range" min={0} max={400} step={5} value={settings.retuneMs} onChange={(e) => set({ retuneMs: Number(e.target.value) })} />
        <span className="val">{settings.retuneMs === 0 ? "HARD" : `${settings.retuneMs}ms`}</span></div>
      <div className="knob-row"><label>Strength</label>
        <input type="range" min={0} max={1} step={0.01} value={settings.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        <span className="val">{Math.round(settings.strength * 100)}%</span></div>
      <div className="knob-row"><label>Humanize</label>
        <input type="range" min={0} max={1} step={0.01} value={settings.humanize} onChange={(e) => set({ humanize: Number(e.target.value) })} />
        <span className="val">{Math.round(settings.humanize * 100)}%</span></div>
      <div className="row end" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={busy} onClick={run}>{busy ? "Tuning…" : "Apply PulseTune ⚗"}</button>
      </div>
    </div>
  );
}
