/** WAV encode/decode — pure TypeScript, runs in browser and Node (tests). */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  frames: number;
  durationSec: number;
}

export type BitDepth = 16 | 24 | 32; // 32 = IEEE float

export function encodeWav(channelData: Float32Array[], sampleRate: number, bitDepth: BitDepth = 16): ArrayBuffer {
  const channels = channelData.length;
  if (channels < 1) throw new Error("encodeWav: no channels");
  const frames = channelData[0]!.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c]![f] ?? 0));
      if (bitDepth === 16) {
        view.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        off += 2;
      } else if (bitDepth === 24) {
        const v = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(off, v & 0xff);
        view.setUint8(off + 1, (v >> 8) & 0xff);
        view.setUint8(off + 2, (v >> 16) & 0xff);
        off += 3;
      } else {
        view.setFloat32(off, sample, true);
        off += 4;
      }
    }
  }
  return buffer;
}

export function parseWavHeader(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);
  const str = (off: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("Not a WAV file");
  // walk chunks
  let off = 12;
  let sampleRate = 0, channels = 0, bitDepth = 0, dataSize = 0;
  while (off + 8 <= view.byteLength) {
    const id = str(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bitDepth = view.getUint16(off + 22, true);
    } else if (id === "data") {
      dataSize = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!sampleRate || !channels) throw new Error("Malformed WAV: missing fmt chunk");
  const frames = dataSize / (channels * (bitDepth / 8));
  return { sampleRate, channels, bitDepth, frames, durationSec: frames / sampleRate };
}

/** Decode WAV data chunk to float arrays (for tests / non-silence checks). */
export function decodeWavSamples(buffer: ArrayBuffer): { info: WavInfo; channelData: Float32Array[] } {
  const info = parseWavHeader(buffer);
  const view = new DataView(buffer);
  const str = (off: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };
  let off = 12;
  let dataOff = -1;
  while (off + 8 <= view.byteLength) {
    const id = str(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "data") { dataOff = off + 8; break; }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error("Malformed WAV: no data chunk");
  const out: Float32Array[] = Array.from({ length: info.channels }, () => new Float32Array(info.frames));
  const bps = info.bitDepth / 8;
  for (let f = 0; f < info.frames; f++) {
    for (let c = 0; c < info.channels; c++) {
      const o = dataOff + (f * info.channels + c) * bps;
      let v = 0;
      if (info.bitDepth === 16) v = view.getInt16(o, true) / 0x8000;
      else if (info.bitDepth === 24) {
        let raw = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        v = raw / 0x800000;
      } else v = view.getFloat32(o, true);
      out[c]![f] = v;
    }
  }
  return { info, channelData: out };
}

export function peakLevel(channelData: Float32Array[]): number {
  let peak = 0;
  for (const ch of channelData) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  return peak;
}
