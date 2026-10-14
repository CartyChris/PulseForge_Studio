/** AI Sound Lab: audio generation jobs (tracked, cancellable, SSE-updated),
 * import results into the library, chop/layer workflows, manual import path. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import { api, subscribeJobs, type JobInfo, type ProviderInfo } from "../api";
import { importAudioData } from "../audio/assets";
import { renderRegionToChannelData } from "../audio/export";
import { assetFromChannelData } from "../audio/assets";
import { ProviderSetup } from "./AIAssistant";
import { StemExtractor } from "./StemExtractor";

const KIND_PRESETS = [
  ["Drum sample", "punchy kick drum, tight low end", "sound", 2],
  ["Sound effect", "sci-fi laser zap", "sound", 2],
  ["Riser", "white noise riser building tension, 4 seconds", "sound", 4],
  ["Impact", "cinematic impact hit with sub boom", "sound", 3],
  ["Atmosphere", "warm vinyl crackle ambience", "sound", 8],
  ["Loop", "melodic synth loop, 120 bpm", "music", 8],
  ["Vocal phrase", "female vocal singing 'oh yeah' melodically", "speech", 3],
  ["Spoken tag", "deep voice saying 'PulseForge'", "speech", 2],
  ["Texture", "granular shimmering texture", "sound", 6],
] as const;

export function SoundLab() {
  const { project, addAsset, dispatch, toast, setFlags, select, setTab } = useStudio();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [kind, setKind] = useState<"sound" | "music" | "speech">("sound");
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [imported, setImported] = useState<Record<string, string>>({}); // jobId -> assetId

  useEffect(() => {
    api.providers().then((r) => {
      setProviders(r.providers);
      const audio = r.providers.find((p) => p.kind === "audio" && p.configured);
      if (audio) setProviderId((prev) => prev || audio.id);
    }).catch(() => {});
    api.jobs().then((r) => setJobs(r.jobs)).catch(() => {});
    const unsub = subscribeJobs((job) => {
      setJobs((js) => {
        const i = js.findIndex((j) => j.id === job.id);
        if (i >= 0) return js.map((j) => (j.id === job.id ? job : j));
        return [job, ...js];
      });
      setFlags({ aiBusy: job.status === "running" });
    });
    return unsub;
  }, [setFlags]);

  const audioProviders = providers.filter((p) => p.kind === "audio" || p.id === "manual-import");
  const provider = providers.find((p) => p.id === providerId);

  const generate = async () => {
    if (!provider) return toast("Pick an audio provider (or use Manual Import below)", "error");
    if (!prompt.trim()) return;
    try {
      setFlags({ cloudActive: true });
      await api.generateSound(provider.id, prompt.trim(), duration, kind);
      toast("Generation job started (this may cost provider credits)", "info");
    } catch (e) {
      toast(String(e), "error");
    }
    setFlags({ cloudActive: false });
  };

  const importResult = async (job: JobInfo) => {
    if (!job.assetId) return;
    try {
      const res = await fetch(api.assetUrl(job.assetId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      const asset = await importAudioData(`AI ${job.prompt.slice(0, 32)}`, data, "ai", {
        licenseNote: job.licenseNote ?? "AI-generated — check your provider's usage license.",
        tags: ["ai", job.kind.replace("generate-", "")],
        aiMeta: { providerId: job.providerId, model: job.model, prompt: job.prompt, jobId: job.id, createdAt: job.createdAt },
      });
      addAsset(asset);
      setImported((m) => ({ ...m, [job.id]: asset.id }));
      toast(`"${asset.name}" saved to library`, "success");
      return asset;
    } catch (e) {
      toast(`Import failed: ${e}`, "error");
    }
  };

  const manualImport = async () => {
    const { getHost } = await import("../host/adapter");
    const files = await getHost().importFiles({ accept: [".wav", ".mp3", ".m4a", ".ogg", ".flac"], multiple: true });
    for (const f of files) {
      try {
        const asset = await importAudioData(f.name, f.data, "ai", {
          licenseNote: "Imported from an external AI service — verify that service's license terms.",
          tags: ["ai", "manual-import"],
        });
        addAsset(asset);
        toast(`"${asset.name}" imported`, "success");
      } catch (e) {
        toast(String(e), "error");
      }
    }
  };

  /** Resample the current loop region (layered result) into a new sample. */
  const resampleRegion = async () => {
    if (!(project.loop.endTick > project.loop.startTick)) {
      return toast("Set a loop region in the Playlist first — it defines what gets resampled", "error");
    }
    toast("Rendering loop region…");
    const res = await renderRegionToChannelData(project, project.loop.startTick, project.loop.endTick);
    if (!res) return;
    if (!res.nonSilent) return toast("Rendered region was silent — nothing to save", "error");
    const asset = await assetFromChannelData("Resampled region", res.channelData, res.sampleRate, "render", { tags: ["resample"] });
    addAsset(asset);
    toast(`"${asset.name}" created — chop it in the Audio Editor`, "success");
  };

  return (
    <div className="ai-pane">
      <div className="ai-scroll">
        <div className="card" style={{ maxWidth: 760, marginBottom: 14 }}>
          <h3>Generate a sound</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
            {KIND_PRESETS.map(([label, pr, k, d]) => (
              <button key={label} className="btn small" onClick={() => { setPrompt(pr); setKind(k); setDuration(d); }}>{label}</button>
            ))}
          </div>
          <div className="row">
            <select className="sel" value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Audio provider">
              <option value="">— audio provider —</option>
              {audioProviders.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? " ✓" : ""}</option>)}
            </select>
            <select className="sel" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="sound">sound/FX</option>
              <option value="music">music/loop</option>
              <option value="speech">speech/vocal</option>
            </select>
            <input className="num-input" type="number" min={0.5} max={120} value={duration} onChange={(e) => setDuration(Number(e.target.value))} title="Duration (seconds)" />
            <span className="dim small">sec</span>
            <button className="btn small" onClick={() => setSetupOpen(true)}>⚙</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <textarea style={{ flex: 1, minHeight: 44 }} className="search-box" placeholder="Describe the sound…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <button className="btn primary" onClick={generate} disabled={!prompt.trim() || provider?.id === "manual-import"}>Generate</button>
          </div>
          <p className="faint small">Generations call your configured provider and may use paid credits — nothing is sent until you click Generate. The cloud light in the top bar shows active uploads.</p>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn small" onClick={manualImport} title="For services without an API: generate on their site, download, import here">Manual import (no API)</button>
            <button className="btn small" onClick={resampleRegion} title="Render the loop region (your layered AI + manual sounds) into a new sample">Resample loop region</button>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 760, marginBottom: 14 }}>
          <h3>Stem Extractor — split a song into layers</h3>
          <StemExtractor />
        </div>

        <h3 className="section">Jobs</h3>
        {!jobs.length && <p className="dim small">No generation jobs yet.</p>}
        {jobs.map((job) => (
          <div className="job-card" key={job.id} style={{ maxWidth: 760 }}>
            <div className="row">
              <strong className="small">{job.kind}</strong>
              <span className="dim small">{job.providerId}{job.model ? ` · ${job.model}` : ""} · {job.durationSec ?? "?"}s</span>
              <div className="spacer" />
              <span className="small mono" style={{ color: job.status === "completed" ? "var(--green)" : job.status === "failed" ? "var(--red)" : "var(--dim)" }}>{job.status}</span>
            </div>
            <div className="dim small" style={{ margin: "4px 0" }}>“{job.prompt.slice(0, 140)}”</div>
            {job.status === "running" && <div className="progress"><div className="fill" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>}
            {job.error && <div className="small" style={{ color: "var(--red)" }}>{job.error.slice(0, 200)}</div>}
            {job.licenseNote && job.status === "completed" && <div className="faint small">{job.licenseNote}</div>}
            <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 5 }}>
              {(job.status === "running" || job.status === "queued") && (
                <button className="btn small danger" onClick={() => api.cancelJob(job.id).catch(() => {})}>Cancel</button>
              )}
              {job.status === "failed" && (
                <button className="btn small" onClick={() => api.generateSound(job.providerId, job.prompt, job.durationSec ?? 5, "sound").then(() => toast("Retrying…"))}>Retry</button>
              )}
              {job.status === "completed" && job.assetId && (
                <>
                  <audio controls src={api.assetUrl(job.assetId)} style={{ height: 28 }} />
                  {!imported[job.id] ? (
                    <button className="btn small primary" onClick={() => importResult(job)}>Save to Library</button>
                  ) : (
                    <>
                      <button className="btn small" onClick={() => { select({ assetId: imported[job.id]! }); setTab("audio-editor"); }}>Open in Editor / Chop</button>
                      <button className="btn small" onClick={() => {
                        const track = project.tracks.find((t) => t.kind === "audio") ?? project.tracks[0];
                        if (!track) return toast("Add a track in the Playlist first", "error");
                        dispatch({ type: "placeAudioClip", trackId: track.id, assetId: imported[job.id]!, startTick: 0 });
                        toast("Added to Playlist — layer it with your beat", "success");
                      }}>Add to Playlist</button>
                      <button className="btn small" onClick={() => {
                        dispatch({ type: "createChannel", name: `AI ${job.prompt.slice(0, 18)}`, instrument: { type: "sampler", assetId: imported[job.id]!, params: {} as any } });
                        toast("Sampler instrument created", "success");
                      }}>As Sampler</button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <p className="faint small" style={{ maxWidth: 700 }}>
          Workflow: generate → save to library → chop in the Audio Editor (slices → Drum Rack) → layer in the Playlist →
          set a loop region and “Resample loop region” to bounce your combined layers into one new sample.
        </p>
      </div>
      {setupOpen && <ProviderSetup providers={providers} onClose={() => { setSetupOpen(false); api.providers().then((r) => setProviders(r.providers)); }} />}
    </div>
  );
}
