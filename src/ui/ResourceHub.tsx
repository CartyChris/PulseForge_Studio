/** Sample Pack Resource Hub: curated legal sources + custom entries + pack import. */
import { useEffect, useState } from "react";
import { useStudio } from "../state/store";
import { getHost } from "../host/adapter";
import { idb } from "../storage/db";

interface Resource {
  id: string;
  name: string;
  description: string;
  contentType: string;
  url: string;
  license: string;
  custom?: boolean;
}

const BUILTIN: Resource[] = [
  { id: "freesound", name: "Freesound", description: "Huge community library of samples & field recordings.", contentType: "One-shots, loops, field recordings", url: "https://freesound.org", license: "Mixed licenses per sound (CC0, CC-BY, CC-BY-NC) — check each download and credit where required." },
  { id: "sampleradar", name: "MusicRadar SampleRadar", description: "Thousands of free sample packs from MusicRadar.", contentType: "Genre packs, drum kits, loops", url: "https://www.musicradar.com/news/tech/free-music-samples-royalty-free-loops-hits-and-multis-to-download", license: "Free for use in your music; redistribution of the samples themselves is not allowed." },
  { id: "99sounds", name: "99Sounds", description: "Curated free sound libraries by independent designers.", contentType: "FX, cinematic, drums, textures", url: "https://99sounds.org", license: "Free for commercial and non-commercial music; see each pack's readme." },
  { id: "pixabay", name: "Pixabay Sound Effects", description: "Royalty-free sound effects & music.", contentType: "SFX, ambience, music", url: "https://pixabay.com/sound-effects/", license: "Pixabay Content License — free to use, no attribution required, some restrictions on standalone redistribution." },
  { id: "looperman", name: "Looperman", description: "Community loops & acapellas.", contentType: "Loops, acapellas", url: "https://www.looperman.com", license: "Loops are free to use in your tracks; acapellas often require credit/permission — read each item's terms." },
  { id: "archive-audio", name: "Internet Archive — Audio", description: "Public domain & openly licensed recordings.", contentType: "Historic recordings, field audio", url: "https://archive.org/details/audio", license: "Varies per item — many public domain, always verify the item's rights statement." },
];

export function ResourceHub() {
  const { toast } = useStudio();
  const [custom, setCustom] = useState<Resource[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", contentType: "", url: "", license: "" });

  useEffect(() => {
    idb.get<Resource[]>("kv", "customResources").then((r) => setCustom(r ?? []));
  }, []);

  const saveCustom = async (list: Resource[]) => {
    setCustom(list);
    await idb.put("kv", list, "customResources");
  };

  const all = [...BUILTIN, ...custom];

  return (
    <div className="hub">
      <div className="row" style={{ marginBottom: 12, maxWidth: 900 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Sample Pack Resource Hub</h2>
          <p className="dim small" style={{ margin: "4px 0 0" }}>
            Places to find sounds legally. <strong>“Free” does not always mean copyright-free</strong> — every site and even
            every pack can carry different license terms. The license notes below are reminders, not legal advice.
          </p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add Custom Resource</button>
      </div>

      <div className="hub-grid">
        {all.map((r) => (
          <div className="card" key={r.id}>
            <h3>{r.name}{r.custom && <span className="faint small"> · custom</span>}</h3>
            <p className="dim small">{r.description}</p>
            <p className="small"><span className="faint">Content:</span> {r.contentType}</p>
            <p className="warn small">{r.license}</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <button className="btn small" onClick={() => getHost().openExternalURL(r.url).catch((e) => toast(String(e), "error"))}>Open Website</button>
              <button className="btn small" onClick={() => {
                toast("Use the Browser panel (left) → “+ zip” or “+ folder” to import what you downloaded", "info");
              }}>Import Downloaded Pack</button>
              {r.custom && (
                <button className="btn small danger" onClick={() => saveCustom(custom.filter((x) => x.id !== r.id))}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 900 }}>
        <h3>How pack import works</h3>
        <ul className="dim small">
          <li>ZIPs are inspected before extraction — path-traversal entries are rejected, executables and unrelated files are ignored.</li>
          <li>Folder structure becomes tags, so “DrumPack/Kicks/kick01.wav” is searchable as “kicks”.</li>
          <li>Waveform previews, loop/one-shot detection and BPM estimates are generated automatically (local analysis).</li>
          <li>Each imported sample keeps a license note naming its source pack.</li>
          <li>Drag any imported sample into the Playlist, or add it to the Drum Rack / a Sampler from the Audio Editor.</li>
        </ul>
      </div>

      {adding && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAdding(false)}>
          <div className="modal">
            <h2>Add Custom Resource</h2>
            {(["name", "description", "contentType", "url", "license"] as const).map((f) => (
              <div className="field" key={f}><label>{f}</label>
                <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  placeholder={f === "url" ? "https://…" : f === "license" ? "e.g. CC-BY 4.0 — attribution required" : ""} /></div>
            ))}
            <div className="row end">
              <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn primary" disabled={!form.name || !form.url} onClick={() => {
                saveCustom([...custom, { ...form, id: `custom_${Date.now()}`, custom: true }]);
                setAdding(false);
                setForm({ name: "", description: "", contentType: "", url: "", license: "" });
              }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
