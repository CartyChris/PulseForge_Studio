/** Left browser: drum kits, factory sounds, instruments, patterns, project assets,
 * audio import and sample-pack import (folder/ZIP via backend safety checks). */
import { useRef, useState } from "react";
import { useStudio } from "../state/store";
import { DRUM_KITS } from "../engine/kits";
import { FACTORY_SAMPLES } from "../engine/kits";
import { INSTRUMENT_PRESETS } from "../engine/instruments";
import { engine } from "../engine/engine";
import { getDrumBuffer } from "../engine/graph";
import { previewFactorySample, factorySampleAsset, importAudioData, isAudioFile, ensureAssetLoaded, deleteAssetBlobs } from "../audio/assets";
import { getHost } from "../host/adapter";
import { api, base64FromArrayBuffer, arrayBufferFromBase64 } from "../api";

export function Browser() {
  const { project, selection, select, update, addAsset, dispatch, toast, setTab } = useStudio();
  const [open, setOpen] = useState<Record<string, boolean>>({ kits: true, assets: true });
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const q = query.toLowerCase();

  const preview = (fn: () => (() => void) | null) => {
    stopRef.current?.();
    stopRef.current = fn();
  };

  const importAudioFiles = async () => {
    const files = await getHost().importFiles({ accept: [".wav", ".mp3", ".aac", ".m4a", ".ogg", ".flac", ".aif", ".aiff"], multiple: true });
    let ok = 0;
    for (const f of files) {
      if (!isAudioFile(f)) { toast(`Skipped ${f.name} (not audio)`, "error"); continue; }
      try {
        const asset = await importAudioData(f.name, f.data, "import");
        addAsset(asset);
        ok++;
      } catch (e) {
        toast(`${f.name}: ${e}`, "error");
      }
    }
    if (ok) toast(`Imported ${ok} audio file${ok > 1 ? "s" : ""}`, "success");
  };

  const importPack = async () => {
    const files = await getHost().importFiles({ accept: [".zip"], multiple: false });
    if (!files[0]) return;
    setImporting(true);
    try {
      const b64 = base64FromArrayBuffer(files[0].data);
      const inspection = await api.inspectPack(b64);
      if (inspection.unsafe.length) {
        toast(`Pack contains ${inspection.unsafe.length} unsafe paths — they will be skipped`, "error");
      }
      const audioCount = inspection.entries.filter((e) => e.kind === "audio").length;
      if (!audioCount) throw new Error("No audio files found in this ZIP");
      if (!confirm(`"${files[0].name}" contains ${audioCount} audio files (${inspection.entries.filter((e) => e.kind === "ignored").length} ignored non-audio files). Import?`)) {
        setImporting(false);
        return;
      }
      const { files: extracted } = await api.extractPack(b64);
      const packName = files[0].name.replace(/\.zip$/i, "");
      let ok = 0;
      for (const f of extracted) {
        if (!isAudioFile({ name: f.path })) continue;
        try {
          const folder = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : packName;
          const asset = await importAudioData(f.path.split("/").pop()!, arrayBufferFromBase64(f.dataBase64), "import", {
            tags: ["pack", packName, ...folder.split("/").filter(Boolean)].slice(0, 6),
            licenseNote: `From pack "${packName}" — check the pack's own license terms.`,
          });
          addAsset(asset);
          ok++;
        } catch {}
      }
      toast(`Imported ${ok} samples from ${packName}`, "success");
    } catch (e) {
      toast(`Pack import failed: ${e}`, "error");
    }
    setImporting(false);
  };

  const importFolder = () => {
    const input = document.createElement("input");
    input.type = "file";
    (input as any).webkitdirectory = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])].filter((f) => isAudioFile(f));
      if (!files.length) return toast("No audio files in that folder", "error");
      let ok = 0;
      for (const f of files.slice(0, 500)) {
        try {
          const folderTag = (f as any).webkitRelativePath?.split("/")[0] ?? "folder";
          const asset = await importAudioData(f.name, await f.arrayBuffer(), "import", { tags: ["pack", folderTag] });
          addAsset(asset);
          ok++;
        } catch {}
      }
      toast(`Imported ${ok} samples`, "success");
    };
    input.click();
  };

  const dragPayload = (payload: object) => (e: React.DragEvent) => {
    e.dataTransfer.setData("application/pulseforge", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const filteredAssets = project.assets.filter((a) =>
    !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)),
  );
  const favorites = filteredAssets.filter((a) => a.favorite);

  return (
    <>
      <div className="panel-header">
        <span>Browser</span>
        <span className="row" style={{ gap: 4 }}>
          <button className="mini-btn" title="Import audio files" onClick={importAudioFiles}>+ audio</button>
          <button className="mini-btn" title="Import a sample pack ZIP (inspected before extraction)" onClick={importPack} disabled={importing}>{importing ? "…" : "+ zip"}</button>
          <button className="mini-btn" title="Import a folder of samples" onClick={importFolder}>+ folder</button>
        </span>
      </div>
      <input className="search-box" placeholder="Search samples & tags…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search library" />
      <div className="panel-body">
        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("kits")}>{open.kits ? "▾" : "▸"} Drum Kits</div>
          {open.kits && DRUM_KITS.map((kit) => (
            <div key={kit.id}>
              <div className="tree-item" style={{ paddingLeft: 14, fontWeight: 600 }} title={kit.description}>{kit.name}</div>
              {kit.sounds.filter((s) => !q || s.name.toLowerCase().includes(q)).map((s) => (
                <div key={s.id} className="tree-item" draggable
                  onDragStart={dragPayload({ kind: "drum", kitId: kit.id, soundId: s.id })}
                  onClick={() => preview(() => engine.previewBuffer(getDrumBuffer(kit.id, s.id)))}
                  title={`${s.name} — click to preview, use Channel Rack to add`}>
                  <span>{s.name}</span>
                  <span className="actions">
                    <button className="mini-btn" title="Add as channel" onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "createChannel", name: s.name, instrument: { type: "drum-sound", kitId: kit.id, soundId: s.id } });
                      toast(`${s.name} added to rack`, "success");
                    }}>+rack</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("factory")}>{open.factory ? "▾" : "▸"} Factory Sounds <span className="faint small">(synthesized)</span></div>
          {open.factory && [...new Set(FACTORY_SAMPLES.map((s) => s.category))].map((cat) => (
            <div key={cat}>
              <div className="tree-item" style={{ paddingLeft: 14, fontWeight: 600 }}>{cat}</div>
              {FACTORY_SAMPLES.filter((s) => s.category === cat && (!q || s.name.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)))).map((s) => (
                <div key={s.id} className="tree-item"
                  onClick={() => preview(() => previewFactorySample(s.id))}
                  title={`${s.name} — click to preview`}>
                  <span>{s.name}</span>
                  <span className="actions">
                    <button className="mini-btn" title="Add to project assets (usable in Playlist/Sampler)" onClick={async (e) => {
                      e.stopPropagation();
                      const asset = await factorySampleAsset(s.id);
                      addAsset(asset);
                      toast(`"${s.name}" added to project assets`, "success");
                    }}>+lib</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("instruments")}>{open.instruments ? "▾" : "▸"} Instruments</div>
          {open.instruments && INSTRUMENT_PRESETS.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => (
            <div key={p.id} className="tree-item" title={`${p.name} (${p.category})`}>
              <span>{p.name}</span>
              <span className="actions">
                <button className="mini-btn" onClick={() => {
                  dispatch({ type: "createChannel", name: p.name, instrument: { type: "synth", synthId: p.engineId, presetId: p.id, params: p.params } });
                  toast(`${p.name} added — open Piano Roll to play it`, "success");
                }}>+rack</button>
              </span>
            </div>
          ))}
        </div>

        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("patterns")}>{open.patterns ? "▾" : "▸"} Patterns</div>
          {open.patterns && project.patterns.map((p) => (
            <div key={p.id} className={`tree-item`} draggable
              onDragStart={dragPayload({ kind: "pattern", patternId: p.id })}
              onClick={() => select({ patternId: p.id })}
              title="Drag into the Playlist to arrange"
              style={selection.patternId === p.id ? { color: "var(--ember)" } : undefined}>
              <span>▦ {p.name}</span>
            </div>
          ))}
        </div>

        {favorites.length > 0 && (
          <div className="tree-group">
            <div className="tree-title" onClick={() => toggle("favs")}>{open.favs ? "▾" : "▸"} ★ Favorites</div>
            {open.favs && favorites.map((a) => <AssetRow key={a.id} id={a.id} />)}
          </div>
        )}

        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("assets")}>{open.assets ? "▾" : "▸"} Project Assets <span className="faint small">({project.assets.length})</span></div>
          {open.assets && filteredAssets.map((a) => <AssetRow key={a.id} id={a.id} />)}
          {open.assets && !filteredAssets.length && <div className="tree-item faint">no assets{q ? " match" : " yet — import audio above"}</div>}
        </div>

        <div className="tree-group">
          <div className="tree-title" onClick={() => toggle("more")}>{open.more ? "▾" : "▸"} ⇩ Get More Sounds</div>
          {open.more && (
            <>
              {([
                ["Freesound", "https://freesound.org", "free · check per-sound CC license"],
                ["SampleRadar (MusicRadar)", "https://www.musicradar.com/news/tech/free-music-samples-royalty-free-loops-hits-and-multis-to-download", "free · royalty-free"],
                ["99Sounds", "https://99sounds.org", "free · royalty-free"],
                ["Pixabay SFX", "https://pixabay.com/sound-effects/", "free · Pixabay license"],
                ["Cymatics Free Packs", "https://cymatics.fm/pages/free-download-vault", "free vault · email signup"],
                ["Splice", "https://splice.com", "paid subscription"],
                ["Loopmasters", "https://www.loopmasters.com", "paid packs"],
              ] as const).map(([name, url, note]) => (
                <div key={name} className="tree-item" title={`${note} — opens in your browser`} style={{ cursor: "pointer" }}
                  onClick={() => getHost().openExternalURL(url)}>
                  <span>↗ {name}</span><span className="faint" style={{ fontSize: 9 }}>{note.split(" · ")[0]}</span>
                </div>
              ))}
              <div className="tree-item" style={{ cursor: "pointer", color: "var(--ember)" }}
                onClick={() => setTab("resources")}
                title="Full Resource Hub: license notes, custom resources, pack importer">
                <span>⚙ Resource Hub & Pack Importer…</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  function AssetRow({ id }: { id: string }) {
    const a = project.assets.find((x) => x.id === id)!;
    const isLoop = a.durationSec > 1.5 && a.bpmEstimate != null;
    return (
      <div className="tree-item" draggable
        onDragStart={dragPayload({ kind: "asset", assetId: a.id })}
        onClick={async () => {
          const buf = await ensureAssetLoaded(a);
          if (buf) preview(() => engine.previewBuffer(buf));
        }}
        title={`${a.name} · ${a.durationSec.toFixed(2)}s · ${a.source}${a.bpmEstimate ? ` · ~${a.bpmEstimate}BPM` : ""}${a.licenseNote ? `\n${a.licenseNote}` : ""}\nDrag to Playlist; click to preview`}
        style={selection.assetId === a.id ? { color: "var(--ember)" } : undefined}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isLoop ? "∞" : "•"} {a.name}
          {a.source === "ai" && <span className="faint"> ⚡AI</span>}
          {a.source === "recording" && <span className="faint"> ●rec</span>}
        </span>
        <span className="actions">
          <button className="mini-btn" title={a.favorite ? "Unfavorite" : "Favorite"} onClick={(e) => {
            e.stopPropagation();
            update((p) => ({ ...p, assets: p.assets.map((x) => (x.id === a.id ? { ...x, favorite: !x.favorite } : x)) }));
          }}>{a.favorite ? "★" : "☆"}</button>
          <button className="mini-btn" title="Open in Audio Editor" onClick={(e) => {
            e.stopPropagation();
            select({ assetId: a.id });
            setTab("audio-editor");
          }}>✎</button>
          <button className="mini-btn" title="Delete asset" onClick={async (e) => {
            e.stopPropagation();
            const usedBy = project.clips.filter((c) => c.assetId === a.id).length;
            if (!confirm(`Delete "${a.name}"?${usedBy ? ` It is used by ${usedBy} clip(s), which will go silent.` : ""}`)) return;
            update((p) => ({ ...p, assets: p.assets.filter((x) => x.id !== a.id), clips: p.clips.filter((c) => c.assetId !== a.id) }));
            await deleteAssetBlobs(a);
          }}>✕</button>
        </span>
      </div>
    );
  }
}
