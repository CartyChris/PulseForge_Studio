/** Stem Extractor — AI-powered stem separation (vocals / drums / bass / other).
 * Provider-powered via the backend (e.g. Replicate-hosted Demucs). The user's audio
 * is UPLOADED to the provider: this panel discloses that explicitly before sending.
 * Results come back as separate assets, optionally placed on new Playlist tracks. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import { api, base64FromArrayBuffer, subscribeJobs, type ProviderInfo, type JobInfo } from "../api";
import { ensureAssetLoaded, importAudioData } from "../audio/assets";
import { encodeWav } from "../../shared/wav";

const STEM_COLORS: Record<string, string> = { vocals: "#ff7bd5", drums: "#ffd166", bass: "#e8663c", other: "#4cc2ff", guitar: "#8ef58a", piano: "#7b6cff" };

export function StemExtractor({ targetAssetId }: { targetAssetId?: string }) {
  const { project, dispatch, addAsset, setFlags, toast, setTab, select } = useStudio();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState("");
  const [assetId, setAssetId] = useState(targetAssetId ?? "");
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [addTracks, setAddTracks] = useState(true);

  const stemProviders = providers.filter((p) => p.capabilities.includes("stem-separation"));

  useEffect(() => {
    api.providers().then(({ providers }) => {
      setProviders(providers);
      const first = providers.find((p) => p.capabilities.includes("stem-separation") && p.configured);
      if (first) setProviderId(first.id);
    }).catch(() => {});
  }, []);

  // live job updates over the existing SSE stream — resubscribes only when the job id
  // changes, so progress ticks don't tear down and rebuild the EventSource
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    return subscribeJobs((j) => { if (j.id === jobId) setJob(j); });
  }, [jobId]);

  const chosen = assetId || targetAssetId || "";

  const start = async () => {
    const asset = project.assets.find((a) => a.id === chosen);
    if (!asset) return toast("Pick an audio asset to split first", "error");
    if (!providerId) return toast("Configure a stem-separation provider first (AI Assistant → Providers → Replicate)", "error");
    if (!consent) return toast("Tick the upload-consent box first — your audio leaves this machine", "error");
    try {
      setFlags({ cloudActive: true, aiBusy: true });
      const buf = await ensureAssetLoaded(asset);
      if (!buf) throw new Error("Could not load asset audio");
      const chans: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      const wav = encodeWav(chans, buf.sampleRate, 16);
      const { job } = await api.separateStems(providerId, base64FromArrayBuffer(wav), "audio/wav", asset.name);
      setJob(job);
      toast("Stem separation started — this can take a few minutes", "info");
    } catch (e) {
      toast(`Stem separation failed to start: ${e}`, "error");
    } finally {
      setFlags({ cloudActive: false, aiBusy: false });
    }
  };

  const importStems = async () => {
    if (!job?.stems) return;
    setImporting(true);
    const src = project.assets.find((a) => a.id === chosen);
    try {
      for (const [stemName, backendId] of Object.entries(job.stems)) {
        const res = await fetch(api.assetUrl(backendId));
        if (!res.ok) throw new Error(`Download ${stemName}: HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const asset = await importAudioData(`${src?.name ?? "audio"} — ${stemName}`, data, "ai", {
          licenseNote: job.licenseNote ?? "Separated stems of your own audio — the provider's terms apply.",
        });
        addAsset(asset);
        if (addTracks) {
          dispatch({ type: "createTrack", name: `Stem: ${stemName}`, kind: "audio", color: STEM_COLORS[stemName.toLowerCase()] ?? "#8a93a6" });
          const track = useStudio.getState().project.tracks.at(-1)!;
          dispatch({ type: "placeAudioClip", trackId: track.id, assetId: asset.id, startTick: 0 });
        }
      }
      toast(`${Object.keys(job.stems).length} stems imported${addTracks ? " and placed on new tracks" : ""}`, "success");
      if (addTracks) setTab("playlist");
      else { select({ assetId: undefined }); }
      setJob(null);
    } catch (e) {
      toast(`Stem import failed: ${e}`, "error");
    }
    setImporting(false);
  };

  return (
    <div>
      <p className="faint small" style={{ marginTop: 0 }}>
        Split a song or recording into separate layers — vocals, drums, bass, instruments —
        using an AI model via your connected provider. <strong style={{ color: "var(--yellow)" }}>
        Your audio is uploaded to the provider for processing.</strong> Quality depends on the
        model you configure (Demucs-family models work well).
      </p>

      {!targetAssetId && (
        <div className="field"><label>Audio to split</label>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">— select an asset —</option>
            {project.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
      )}

      <div className="field"><label>Provider</label>
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">— pick a stem-capable provider —</option>
          {stemProviders.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? "" : " (not configured)"}</option>)}
        </select>
        {!stemProviders.some((p) => p.configured) && (
          <span className="faint small">Set up Replicate in AI Assistant → Providers: paste your API token and a stem-separation model version hash (from the model's page on replicate.com).</span>
        )}
      </div>

      <label className="row small" style={{ padding: "4px 0" }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I understand this uploads my audio to the selected provider
      </label>
      <label className="row small" style={{ padding: "4px 0" }}>
        <input type="checkbox" checked={addTracks} onChange={(e) => setAddTracks(e.target.checked)} />
        Place stems on new Playlist tracks automatically
      </label>

      {!job && (
        <div className="row end" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={start} disabled={!chosen || !consent}>Split into Stems</button>
        </div>
      )}

      {job && (
        <div className="job-card" style={{ marginTop: 10 }}>
          <div className="row">
            <strong className="small">{job.prompt}</strong>
            <div className="spacer" />
            <span className="dim small">{job.status}</span>
          </div>
          <div className="progress"><div className="fill" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          {job.status === "running" && (
            <button className="btn small danger" onClick={async () => { await api.cancelJob(job.id).catch(() => {}); setJob(null); }}>Cancel</button>
          )}
          {job.status === "failed" && (
            <>
              <p className="small" style={{ color: "var(--red)" }}>{job.error}</p>
              <button className="btn small" onClick={() => setJob(null)}>Dismiss</button>
            </>
          )}
          {job.status === "completed" && job.stems && (
            <>
              <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                {Object.keys(job.stems).map((s) => (
                  <span key={s} className="fx-chip" style={{ borderColor: STEM_COLORS[s.toLowerCase()] ?? "var(--line)", fontSize: 11, padding: "3px 8px" }}>{s}</span>
                ))}
              </div>
              {job.licenseNote && <p className="faint small">{job.licenseNote}</p>}
              <div className="row end">
                <button className="btn small" onClick={() => setJob(null)}>Discard</button>
                <button className="btn small primary" disabled={importing} onClick={importStems}>
                  {importing ? "Importing…" : "Import Stems into Project"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
