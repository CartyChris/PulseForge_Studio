#!/usr/bin/env node
/**
 * Sampled-instrument pipeline: download → verify → decode → process → public/samples.
 *
 *   node scripts/fetch-samples.mjs --raw <download-dir> [--out public/samples] [--rate 44100] [--offline]
 *
 * Sources (the only hosts this script talks to):
 *   - Salamander Grand Piano V2 (CC-BY 3.0, Alexander Holm) — mp3 set at https://tonejs.github.io/audio/salamander/
 *   - VSCO 2 Community Edition (CC0 1.0, Versilian Studios) — https://github.com/sgossner/VSCO-2-CE
 *     (tree via api.github.com, files + SFZ mappings via raw.githubusercontent.com)
 *
 * Downloaded files are treated as untrusted DATA: they are only parsed (WAV/SFZ text) or
 * copied (mp3, after a magic-byte check) — never executed. Downloads are cached in --raw and
 * verified against the git blob sha1 from the GitHub tree, so re-runs are idempotent and offline-capable
 * (--offline uses only the cache + a cached tree.json).
 *
 * Processing per VSCO sample: decode (PCM 8/16/24/32-bit int, 32/64-bit float, WAVE_FORMAT_EXTENSIBLE),
 * downmix to mono, resample (windowed sinc) to --rate, trim leading silence, cap length with a cosine
 * fade-out, per-instrument peak normalise to -1 dBFS, write 16-bit PCM WAV. Note → MIDI mapping comes
 * from the library's own SFZ files (pitch_keycenter), because folder note names use mixed octave conventions.
 * No dependencies beyond Node ≥18 (global fetch).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

// ---------------- args ----------------
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const RAW = arg("raw", null);
if (!RAW) {
  console.error("usage: node scripts/fetch-samples.mjs --raw <download-cache-dir> [--out public/samples] [--rate 44100] [--offline]");
  process.exit(2);
}
const RAW_DIR = path.resolve(RAW);
const OUT_DIR = path.resolve(arg("out", path.join(REPO, "public", "samples")));
const RATE = Number(arg("rate", "44100"));
const OFFLINE = args.includes("--offline");
const BUDGET_BYTES = 45 * 1024 * 1024;

const VSCO_REPO = "sgossner/VSCO-2-CE";
const VSCO_BRANCH = "master";
const VSCO_SFZ_BRANCH = "SFZ";
const VSCO_HOME = "http://vis.versilstudios.net/vsco-community.html";
const VSCO_LICENSE = "CC0-1.0";
const VSCO_ATTRIBUTION = "VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell); sample cutting by Elan Hickler/Soundemote. CC0 1.0 — credit requested, not required. " + VSCO_HOME;
const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander/";
const SALAMANDER_LICENSE = "CC-BY-3.0";
const SALAMANDER_ATTRIBUTION = "Salamander Grand Piano V2 (Yamaha C5) by Alexander Holm, licensed CC BY 3.0 (http://creativecommons.org/licenses/by/3.0/). mp3 edition as hosted by Tone.js (https://tonejs.github.io/audio/salamander/).";

/**
 * VSCO instrument recipes. Each source = one SFZ file; `keyMin/keyMax` restrict which keycenters a
 * source contributes (used to splice cello below violins etc). `max` = samples kept, spread evenly.
 * `capSec` = processed length cap; `fadeSec` = fade-out at the cap.
 */
const VSCO_INSTRUMENTS = [
  { id: "strings-ensemble", name: "Strings Ensemble", category: "Strings", max: 10, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "CelloEnsSusVib", keyMax: 54 }, { sfz: "ViolinEnsSusVib", keyMin: 55 }], notes: "Cello section below G3, violin section from G3 up; sustain with vibrato." },
  { id: "violin", name: "Solo Violin", category: "Strings", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "SViolinVib" }], notes: "Solo violin arco with vibrato." },
  { id: "cello", name: "Cello Section", category: "Strings", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "CelloEnsSusVib" }], notes: "Cello section sustain with vibrato." },
  { id: "pizzicato", perc: true, name: "Pizzicato Strings", category: "Strings", max: 10, capSec: 1.5, fadeSec: 0.2,
    sources: [{ sfz: "CelloEnsPizz", keyMax: 54 }, { sfz: "ViolinEnsPizz", keyMin: 55 }], notes: "Cello pizz below G3, violin section pizz above." },
  { id: "harp", perc: true, name: "Concert Harp", category: "Strings", max: 12, capSec: 3.5, fadeSec: 0.5,
    sources: [{ sfz: "Harp" }], notes: "Plucked concert harp, mf." },
  { id: "flute", name: "Flute", category: "Woodwinds", max: 10, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "FluteSusVib" }], notes: "Flute sustain with vibrato." },
  { id: "clarinet", name: "Clarinet", category: "Woodwinds", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "ClarinetSus" }], notes: "Clarinet long sustain." },
  { id: "oboe", name: "Oboe", category: "Woodwinds", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "OboeSusVib" }], notes: "Oboe sustain with vibrato." },
  { id: "trumpet", name: "Trumpet", category: "Brass", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "TrumpetSus" }], notes: "Trumpet sustain." },
  { id: "french-horn", name: "French Horn", category: "Brass", max: 10, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "FHornSus" }], notes: "F horn sustain." },
  { id: "trombone", name: "Trombone", category: "Brass", max: 9, capSec: 3.5, fadeSec: 0.35,
    sources: [{ sfz: "TromboneSus" }], notes: "Tenor trombone sustain." },
  { id: "glockenspiel", perc: true, name: "Glockenspiel", category: "Mallets", max: 6, capSec: 3.0, fadeSec: 0.4,
    sources: [{ sfz: "Glockenspiel" }], notes: "Mapped at written pitch as in the library's SFZ (instrument sounds two octaves higher)." },
  { id: "marimba", perc: true, name: "Marimba", category: "Mallets", max: 10, capSec: 2.2, fadeSec: 0.3,
    sources: [{ sfz: "Marimba" }], notes: "Outrigger mallets, loud hits." },
  { id: "xylophone", perc: true, name: "Xylophone", category: "Mallets", max: 8, capSec: 1.4, fadeSec: 0.25,
    sources: [{ sfz: "Xylophone" }], notes: "Mapped at written pitch as in the library's SFZ." },
  { id: "timpani", perc: true, name: "Timpani", category: "Orchestral", max: 5, capSec: 3.5, fadeSec: 0.5,
    sources: [{ sfz: "Timpani" }], notes: "Five tuned timpani hits; repitched between drums." },
];

/** Composite instruments that reuse already-processed files (no extra bytes). */
const COMPOSITES = [
  { id: "brass-section", name: "Brass Section", category: "Brass",
    parts: [{ from: "trombone", keyMax: 52 }, { from: "french-horn", keyMin: 53, keyMax: 64 }, { from: "trumpet", keyMin: 65 }],
    notes: "Range-split section: trombone (low), French horn (mid), trumpet (high)." },
];

// ---------------- helpers ----------------
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiToName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const midiToFileName = (m) => midiToName(m).replace("#", "s");
const rel = (p) => path.relative(OUT_DIR, p).split(path.sep).join("/");
const log = (...a) => console.log(...a);
const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });

function gitBlobSha(buf) {
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

async function fetchBuf(url, attempts = 3) {
  if (OFFLINE) throw new Error(`offline: ${url} not cached`);
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "pulseforge-fetch-samples" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Download to cache unless a valid copy is present. `validate(buf)` returns true when acceptable. */
async function cached(file, url, validate) {
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    if (!validate || validate(buf)) return buf;
  }
  const buf = await fetchBuf(url);
  if (validate && !validate(buf)) throw new Error(`downloaded file failed validation: ${url}`);
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, buf);
  return buf;
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const vscoRawUrl = (p, branch = VSCO_BRANCH) => `https://raw.githubusercontent.com/${VSCO_REPO}/${branch}/${encPath(p)}`;
const vscoPageUrl = (p) => `https://github.com/${VSCO_REPO}/blob/${VSCO_BRANCH}/${encPath(p)}`;

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ---------------- WAV decode / encode ----------------
function decodeWav(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o, n) => String.fromCharCode(...buf.subarray(o, o + n));
  if (buf.length < 12 || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = str(off, 4);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") {
      let tag = dv.getUint16(off + 8, true);
      const channels = dv.getUint16(off + 10, true);
      const sampleRate = dv.getUint32(off + 12, true);
      const bits = dv.getUint16(off + 22, true);
      if (tag === 0xfffe && size >= 40) tag = dv.getUint16(off + 8 + 24, true); // extensible: subformat GUID
      fmt = { tag, channels, sampleRate, bits };
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = Math.min(size, buf.length - dataOff);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error("missing fmt chunk");
  if (dataOff < 0) throw new Error("missing data chunk");
  const { tag, channels, sampleRate, bits } = fmt;
  if (!(channels >= 1 && channels <= 8) || !(sampleRate >= 8000 && sampleRate <= 384000)) throw new Error(`implausible fmt ${channels}ch ${sampleRate}Hz`);
  const bps = bits / 8;
  if (![1, 2, 3, 4, 8].includes(bps)) throw new Error(`unsupported bit depth ${bits}`);
  const isFloat = tag === 3;
  if (!isFloat && tag !== 1) throw new Error(`unsupported format tag ${tag}`);
  if (isFloat && bps !== 4 && bps !== 8) throw new Error(`unsupported float width ${bits}`);
  const frames = Math.floor(dataLen / (bps * channels));
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (f * channels + c) * bps;
      let v;
      if (isFloat) v = bps === 4 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
      else if (bps === 1) v = (dv.getUint8(o) - 128) / 128;
      else if (bps === 2) v = dv.getInt16(o, true) / 32768;
      else if (bps === 3) {
        let raw = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        v = raw / 8388608;
      } else v = dv.getInt32(o, true) / 2147483648;
      acc += Number.isFinite(v) ? v : 0;
    }
    mono[f] = acc / channels;
  }
  return { sampleRate, channels, bits, isFloat, data: mono };
}

function encodeWav16(data, sampleRate) {
  const out = Buffer.alloc(44 + data.length * 2);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + data.length * 2, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }
  return out;
}

// ---------------- DSP ----------------
/** Windowed-sinc (Blackman, 32 zero crossings each side) resampler; anti-aliased when downsampling. */
function resample(x, fromRate, toRate) {
  if (fromRate === toRate) return x;
  const ratio = toRate / fromRate;
  const outLen = Math.floor(x.length * ratio);
  const y = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio) * 0.97;
  const half = 32;
  const width = half / cutoff;
  for (let i = 0; i < outLen; i++) {
    const t = i / ratio;
    const c = Math.floor(t);
    let acc = 0, wsum = 0;
    const lo = Math.max(0, Math.ceil(t - width)), hi = Math.min(x.length - 1, Math.floor(t + width));
    for (let k = lo; k <= hi; k++) {
      const d = t - k;
      const arg = d * cutoff;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      const wn = 0.5 + 0.5 * (d / width); // 0..1 across the window
      const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * wn) + 0.08 * Math.cos(4 * Math.PI * wn);
      const w = sinc * win;
      acc += x[k] * w;
      wsum += w;
    }
    y[i] = wsum !== 0 ? acc / wsum : x[c] ?? 0;
  }
  return y;
}

function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}

/** Trim leading silence (−50 dB re peak, 3 ms pre-roll), cap length, fade in 2 ms / fade out `fadeSec`. */
function shape(x, rate, capSec, fadeSec) {
  const peak = peakOf(x);
  if (peak <= 1e-6) throw new Error("source sample is silent");
  const thr = peak * Math.pow(10, -50 / 20);
  let start = 0;
  while (start < x.length && Math.abs(x[start]) < thr) start++;
  start = Math.max(0, start - Math.round(0.003 * rate));
  // trailing silence (−70 dB re peak) also goes
  const thrEnd = peak * Math.pow(10, -70 / 20);
  let end = x.length;
  while (end > start + 1 && Math.abs(x[end - 1]) < thrEnd) end--;
  end = Math.min(end, start + Math.round(capSec * rate));
  const y = x.slice(start, end);
  const fi = Math.min(y.length, Math.round(0.002 * rate));
  for (let i = 0; fadeSec > 0 && i < fi; i++) y[i] *= i / fi;
  const fo = Math.min(y.length, Math.round(fadeSec * rate));
  for (let i = 0; fadeSec > 0 && i < fo; i++) y[y.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  return y;
}

/** Rough pitch estimate (normalised autocorrelation, 60–2500 Hz) for the mapping sanity report. */
function estimateHz(x, rate) {
  const n = Math.min(4096, x.length - 1);
  const off = Math.min(Math.max(0, x.length - n - 1), Math.round(0.12 * rate));
  const seg = x.subarray(off, off + n);
  const minLag = Math.floor(rate / 2500), maxLag = Math.min(n - 1, Math.floor(rate / 60));
  let best = -1, bestLag = 0;
  const r = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < n; i++) { num += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
    r[lag] = num / Math.sqrt(e1 * e2 + 1e-12);
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > best) { best = r[lag]; bestLag = lag; }
  }
  // prefer the first peak within 90% of the best (avoids octave-down picks)
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= best * 0.9) { bestLag = lag; break; }
  }
  return bestLag ? { hz: rate / bestLag, clarity: best } : null;
}

// ---------------- SFZ ----------------
function parseSfz(text) {
  const regions = [];
  let defaultPath = "";
  let cur = null;
  const flush = () => { if (cur && cur.sample) regions.push(cur); cur = null; };
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("<")) {
      flush();
      if (line.startsWith("<region>")) cur = {};
      const rest = line.replace(/^<[^>]+>/, "").trim();
      if (!rest) continue;
    }
    const m = /^([a-z_]+)=(.*)$/.exec(line.replace(/^<[^>]+>\s*/, ""));
    if (!m) continue;
    const [, k, v] = m;
    if (k === "default_path") defaultPath = v.trim().replace(/\\/g, "/");
    else if (cur) cur[k] = v.trim();
  }
  flush();
  return regions.map((r) => ({
    sample: r.sample.replace(/\\/g, "/"),
    path: (defaultPath + r.sample.replace(/\\/g, "/")).replace(/^\/+/, ""),
    key: Number(r.pitch_keycenter ?? r.key),
    lovel: Number(r.lovel ?? 0),
    hivel: Number(r.hivel ?? 127),
    volumeDb: Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0,
  })).filter((r) => Number.isInteger(r.key) && r.key >= 0 && r.key <= 127);
}

const d_volume = (r) => (Number.isFinite(r.volumeDb) ? r.volumeDb : 0);

function pickSpread(sorted, max) {
  if (sorted.length <= max) return sorted;
  const out = [];
  for (let i = 0; i < max; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

// ---------------- main ----------------
async function main() {
  mkdirp(RAW_DIR);
  mkdirp(OUT_DIR);
  log(`raw cache: ${RAW_DIR}\noutput:    ${OUT_DIR}\nrate:      ${RATE} Hz${OFFLINE ? " (offline)" : ""}`);

  const manifest = {
    version: 1,
    generatedBy: "scripts/fetch-samples.mjs",
    sampleRate: RATE,
    sources: {
      salamander: { name: "Salamander Grand Piano V2", license: SALAMANDER_LICENSE, licenseUrl: "http://creativecommons.org/licenses/by/3.0/", url: SALAMANDER_BASE, licenseEvidence: SALAMANDER_BASE + "README" },
      vsco2ce: { name: "VSCO 2 Community Edition", license: VSCO_LICENSE, licenseUrl: `https://github.com/${VSCO_REPO}/blob/${VSCO_BRANCH}/LICENSE`, url: `https://github.com/${VSCO_REPO}`, homepage: VSCO_HOME, licenseEvidence: `https://raw.githubusercontent.com/${VSCO_REPO}/${VSCO_BRANCH}/LICENSE` },
    },
    instruments: [],
  };
  const report = [];

  // ---- Salamander (kept as mp3) ----
  {
    const names = [];
    for (let m = 21; m <= 108; m += 3) names.push(m); // A0..C8 in minor thirds
    const outDir = path.join(OUT_DIR, "salamander");
    mkdirp(outDir);
    const isMp3 = (b) => b.length > 1024 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
    const notes = {};
    const files = {};
    await pool(names, 4, async (m) => {
      const fname = `${midiToFileName(m)}.mp3`;
      const url = SALAMANDER_BASE + fname;
      const buf = await cached(path.join(RAW_DIR, "salamander", fname), url, isMp3);
      const dest = path.join(outDir, fname);
      fs.writeFileSync(dest, buf);
      notes[midiToName(m)] = rel(dest);
      files[rel(dest)] = { sourceUrl: url, bytes: buf.length };
    });
    if (Object.keys(notes).length !== 30) throw new Error(`salamander: expected 30 files, got ${Object.keys(notes).length}`);
    manifest.instruments.push({
      id: "grand-piano", name: "Grand Piano (Salamander)", category: "Piano",
      license: SALAMANDER_LICENSE, attribution: SALAMANDER_ATTRIBUTION, sourceUrl: SALAMANDER_BASE,
      notes: sortNotes(notes), files: sortObj(files), release: 1.0,
      description: "Yamaha C5 grand, one velocity layer per minor third (Tone.js mp3 edition).",
    });
    log(`grand-piano: 30 mp3 files`);
  }

  // ---- VSCO tree (for blob shas) ----
  const treeFile = path.join(RAW_DIR, "vsco", "tree.json");
  let tree;
  if (fs.existsSync(treeFile)) tree = JSON.parse(fs.readFileSync(treeFile, "utf8"));
  else {
    tree = JSON.parse((await fetchBuf(`https://api.github.com/repos/${VSCO_REPO}/git/trees/${VSCO_BRANCH}?recursive=1`)).toString("utf8"));
    if (!Array.isArray(tree.tree)) throw new Error("unexpected tree response");
    mkdirp(path.dirname(treeFile));
    fs.writeFileSync(treeFile, JSON.stringify(tree));
  }
  const blobs = new Map(tree.tree.filter((t) => t.type === "blob").map((t) => [t.path, t]));
  // license file must still say CC0 — refuse to proceed otherwise
  const licBlob = blobs.get("LICENSE");
  const lic = await cached(path.join(RAW_DIR, "vsco", "LICENSE"), vscoRawUrl("LICENSE"), (b) => !licBlob || gitBlobSha(b) === licBlob.sha);
  if (!/CC0 1\.0 Universal/.test(lic.toString("utf8"))) throw new Error("VSCO LICENSE is no longer CC0 1.0 — stop and re-check the license");

  const processed = new Map(); // instrumentId -> [{key, file}]
  for (const inst of VSCO_INSTRUMENTS) {
    // 1. collect candidate regions from each SFZ source
    const chosen = new Map(); // key -> region
    for (const src of inst.sources) {
      const sfzText = (await cached(path.join(RAW_DIR, "vsco", "sfz", `${src.sfz}.sfz`), vscoRawUrl(`${src.sfz}.sfz`, VSCO_SFZ_BRANCH), (b) => b.length > 50)).toString("utf8");
      // "mf" = the velocity layer whose range is centred closest to velocity 80 (a layer that merely
      // touches 80 at its top edge — e.g. timpani 0..80 — is the soft layer, not mf)
      const dist = (r) => Math.abs((r.lovel + r.hivel) / 2 - 80);
      const regions = parseSfz(sfzText).filter((r) =>
        !/rr2/i.test(r.sample) && blobs.has(r.path) &&
        (src.keyMin === undefined || r.key >= src.keyMin) && (src.keyMax === undefined || r.key <= src.keyMax));
      for (const r of regions) {
        const prev = chosen.get(r.key);
        if (!prev || dist(r) < dist(prev)) chosen.set(r.key, r);
      }
    }
    const keys = pickSpread([...chosen.keys()].sort((a, b) => a - b), inst.max);
    if (keys.length < 3) throw new Error(`${inst.id}: only ${keys.length} usable regions`);
    // 2. download + decode
    const outDir = path.join(OUT_DIR, "vsco", inst.id);
    fs.rmSync(outDir, { recursive: true, force: true });
    mkdirp(outDir);
    const decoded = await pool(keys, 4, async (key) => {
      const r = chosen.get(key);
      const blob = blobs.get(r.path);
      const buf = await cached(path.join(RAW_DIR, "vsco", "files", r.path), vscoRawUrl(r.path), (b) => gitBlobSha(b) === blob.sha);
      const wav = decodeWav(buf);
      // crop in the source domain first (cheap), then resample, then trim/fade precisely
      const pre = shape(wav.data, wav.sampleRate, inst.capSec + 0.05, 0);
      const shaped = shape(resample(pre, wav.sampleRate, RATE), RATE, inst.capSec, inst.fadeSec);
      // apply the library's own per-region balance (SFZ volume=dB) before instrument-wide normalisation
      const regionGain = Math.pow(10, d_volume(r) / 20);
      for (let i = 0; i < shaped.length; i++) shaped[i] *= regionGain;
      return { key, r, wav, shaped, srcBytes: buf.length };
    });
    // 3. level each note toward the instrument's median loudness (recordings differ by up to ~15 dB
    //    between notes and between spliced sources, which makes a keyboard-played sampler lumpy);
    //    correction is clamped to ±12 dB, then the whole instrument is peak-normalised to -1 dBFS.
    const loudness = (x) => {
      const a = Math.round((inst.perc ? 0 : 0.1) * RATE), b = Math.min(x.length, Math.round((inst.perc ? 0.3 : 1.5) * RATE));
      let sum = 0;
      for (let i = a; i < b; i++) sum += x[i] * x[i];
      return Math.sqrt(sum / Math.max(1, b - a));
    };
    const levels = decoded.map((d) => loudness(d.shaped));
    const median = [...levels].sort((a, b) => a - b)[Math.floor(levels.length / 2)];
    decoded.forEach((d, i) => {
      const corr = Math.min(4, Math.max(0.25, median / Math.max(1e-9, levels[i]))); // ±12 dB
      for (let k = 0; k < d.shaped.length; k++) d.shaped[k] *= corr;
    });
    const peak = Math.max(...decoded.map((d) => peakOf(d.shaped)));
    const gain = Math.pow(10, -1 / 20) / peak;
    const notes = {}, files = {};
    const list = [];
    for (const d of decoded) {
      for (let i = 0; i < d.shaped.length; i++) d.shaped[i] *= gain;
      const fname = `${midiToFileName(d.key)}.wav`;
      const dest = path.join(outDir, fname);
      fs.writeFileSync(dest, encodeWav16(d.shaped, RATE));
      notes[midiToName(d.key)] = rel(dest);
      files[rel(dest)] = { sourceUrl: vscoRawUrl(d.r.path), sourcePage: vscoPageUrl(d.r.path), sourceSha1: blobs.get(d.r.path).sha, sourceFormat: `${d.wav.bits}-bit ${d.wav.isFloat ? "float" : "PCM"} ${d.wav.channels}ch ${d.wav.sampleRate} Hz`, durationSec: +(d.shaped.length / RATE).toFixed(3) };
      list.push({ key: d.key, file: rel(dest) });
      const est = estimateHz(d.shaped, RATE);
      if (est) {
        const det = 69 + 12 * Math.log2(est.hz / 440);
        report.push({ inst: inst.id, key: d.key, note: midiToName(d.key), detected: det.toFixed(2), diff: (det - d.key).toFixed(2), clarity: est.clarity.toFixed(2) });
      }
    }
    processed.set(inst.id, list);
    manifest.instruments.push({
      id: inst.id, name: inst.name, category: inst.category,
      license: VSCO_LICENSE, attribution: VSCO_ATTRIBUTION,
      sourceUrl: `https://github.com/${VSCO_REPO}/tree/${VSCO_BRANCH}/${encPath(path.dirname(chosen.get(keys[0]).path))}`,
      sfz: inst.sources.map((s) => vscoRawUrl(`${s.sfz}.sfz`, VSCO_SFZ_BRANCH)),
      notes: sortNotes(notes), files: sortObj(files), release: inst.capSec <= 1.5 ? 0.25 : 0.6,
      description: inst.notes,
    });
    log(`${inst.id}: ${keys.length} samples [${keys.map(midiToName).join(" ")}] gain ${(20 * Math.log10(gain)).toFixed(1)} dB`);
  }

  for (const comp of COMPOSITES) {
    const notes = {}, files = {};
    const srcUrls = [];
    for (const part of comp.parts) {
      const src = manifest.instruments.find((i) => i.id === part.from);
      for (const { key, file } of processed.get(part.from) ?? []) {
        if ((part.keyMin !== undefined && key < part.keyMin) || (part.keyMax !== undefined && key > part.keyMax)) continue;
        notes[midiToName(key)] = file;
        files[file] = src.files[file];
      }
      srcUrls.push(src.sourceUrl);
    }
    manifest.instruments.push({
      id: comp.id, name: comp.name, category: comp.category,
      license: VSCO_LICENSE, attribution: VSCO_ATTRIBUTION, sourceUrl: srcUrls.join(" "),
      notes: sortNotes(notes), files: sortObj(files), release: 0.6, description: comp.notes,
    });
    log(`${comp.id}: ${Object.keys(notes).length} samples (reused) [${Object.keys(sortNotes(notes)).join(" ")}]`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // the app imports this copy (Vite dev cannot import JSON from public/); keep both in sync
  fs.writeFileSync(path.join(REPO, "src", "engine", "sample-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // ---- budget + sanity report ----
  let total = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size; } };
  walk(OUT_DIR);
  log(`\nTOTAL ${OUT_DIR}: ${(total / 1024 / 1024).toFixed(2)} MB (budget 45 MB)`);
  const suspicious = report.filter((r) => Number(r.clarity) > 0.8 && Math.abs(Number(r.diff) - Math.round(Number(r.diff) / 12) * 12) > 0.7);
  log(`pitch check: ${report.length} estimates, ${suspicious.length} non-octave mismatches (clarity>0.8)`);
  for (const r of suspicious) log(`  ? ${r.inst} ${r.note}: detected ${r.detected} (diff ${r.diff}, clarity ${r.clarity})`);
  const octaveOff = report.filter((r) => Number(r.clarity) > 0.8 && Math.abs(Number(r.diff)) > 6);
  for (const r of octaveOff) log(`  octave-offset ${r.inst} ${r.note}: diff ${r.diff} (clarity ${r.clarity})`);
  fs.writeFileSync(path.join(RAW_DIR, "pitch-report.json"), JSON.stringify(report, null, 2));
  if (total > BUDGET_BYTES) {
    console.error(`OVER BUDGET: ${(total / 1024 / 1024).toFixed(2)} MB > 45 MB — re-run with --rate 32000 or lower per-instrument max`);
    process.exit(1);
  }
}

function sortNotes(notes) {
  const toMidi = (n) => { const m = /^([A-G]#?)(-?\d)$/.exec(n); return m ? NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12 : 0; };
  return Object.fromEntries(Object.entries(notes).sort((a, b) => toMidi(a[0]) - toMidi(b[0])));
}
function sortObj(o) { return Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0]))); }

main().catch((e) => { console.error("fetch-samples failed:", e?.stack ?? e); process.exit(1); });
