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
  // 2026-10 additions — terms checked against each source's own licensing page
  { id: "philharmonia", name: "Philharmonia Orchestra Sound Samples", description: "Free recordings of every orchestral instrument by Philharmonia players, plus guitar, mandolin, banjo and lots of percussion.", contentType: "Orchestral one-shots & phrases", url: "https://philharmonia.co.uk/resources/sound-samples/", license: "Free to use, including in commercial releases. You may not sell or share the samples \"as is\" (as a sample pack or sampler instrument)." },
  { id: "wikimedia-audio", name: "Wikimedia Commons — Audio", description: "Freely licensed and public-domain recordings: field audio, historic records, instruments, speech.", contentType: "Recordings, field audio, instruments", url: "https://commons.wikimedia.org/wiki/Category:Audio_files", license: "Commons only accepts free licenses that allow commercial use (CC0, CC BY, CC BY-SA, public domain). Check each file's license for attribution / share-alike terms." },
  { id: "ccmixter", name: "ccMixter", description: "Community of remixers sharing a cappellas (\"pells\") and stems made to be remixed.", contentType: "A cappellas, stems, remix parts", url: "https://ccmixter.org", license: "Creative Commons, and it varies per upload: check each listing's license (some are non-commercial) and credit the artist (ccMixter publishes an attribution guide)." },
  { id: "openverse", name: "Openverse", description: "Search engine for openly licensed media across many collections.", contentType: "Audio & images search", url: "https://openverse.org", license: "Openverse only finds the media; licenses vary per item. Open each result at its source and follow that license." },
  { id: "vsco2", name: "VSCO 2 Community Edition", description: "Free orchestral sample library (strings, woodwinds, brass, percussion). Already built into PulseForge's instruments.", contentType: "Orchestral multisamples", url: "https://github.com/sgossner/VSCO-2-CE", license: "CC0 public domain: use freely, no attribution required (credit appreciated)." },
];

/** What every producer should know before sampling. Deliberately general: not legal advice. */
export const SAMPLING_TIPS = [
  "A recording has several rights: the composition (notes and lyrics), the performance, and the sound recording itself. Each can be owned separately.",
  "Old doesn't automatically mean free: many decades-old records are still protected (US sound recordings follow their own term rules under the Music Modernization Act).",
  "Safest sources: material that explicitly grants rights (CC0 / public domain, royalty-free packs) or audio you made, including PulseForge's own generated loops and starters.",
  "For a famous record, clear the sample (label + publisher) before releasing, or replay/re-create the part yourself.",
  "Keep a note of where every sample came from: the Browser stores a license note on each imported sound.",
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

      <details className="card" style={{ maxWidth: 900, marginBottom: 12, padding: "10px 14px" }}>
        <summary className="small"><b>Sampling legally: 5 things to know</b></summary>
        <ul className="small dim" style={{ lineHeight: 1.6, margin: "8px 0 0", paddingLeft: 18 }}>
          {SAMPLING_TIPS.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>

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
