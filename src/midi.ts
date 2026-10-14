/** Standard MIDI File read/write (format 0/1). Pure TS, no deps. */
import type { Note } from "../shared/project";
import { newId } from "../shared/project";
import { PPQ } from "../shared/time";

// ---------- write ----------
function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

export function notesToMidi(notes: Note[], bpm: number, name = "PulseForge"): ArrayBuffer {
  interface Ev { tick: number; bytes: number[] }
  const events: Ev[] = [];
  for (const n of notes) {
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: Math.round(n.startTick), bytes: [0x90, n.pitch, vel] });
    events.push({ tick: Math.round(n.startTick + n.lengthTicks), bytes: [0x80, n.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick);

  const track: number[] = [];
  // track name
  track.push(0x00, 0xff, 0x03, name.length, ...[...name].map((c) => c.charCodeAt(0)));
  // tempo
  const usPerQuarter = Math.round(60_000_000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  let lastTick = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff,
  ];
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff];
  return new Uint8Array([...header, ...trackHeader, ...track]).buffer;
}

// ---------- read ----------
export interface ParsedMidi {
  notes: Note[];
  bpm: number | null;
  name: string;
}

export function parseMidi(data: ArrayBuffer): ParsedMidi {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== "MThd") throw new Error("Not a MIDI file");
  const numTracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error("SMPTE time division not supported");
  const scale = PPQ / division;

  let pos = 14;
  const notes: Note[] = [];
  let bpm: number | null = null;
  let name = "";

  for (let t = 0; t < numTracks && pos + 8 <= bytes.length; t++) {
    if (String.fromCharCode(...bytes.subarray(pos, pos + 4)) !== "MTrk") break;
    const len = view.getUint32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    let tick = 0;
    let running = 0;
    const open = new Map<number, { tick: number; velocity: number }>();

    const readVlq = () => {
      let v = 0;
      while (p < end) {
        const b = bytes[p++]!;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };

    while (p < end) {
      tick += readVlq();
      let status = bytes[p]!;
      if (status < 0x80) status = running;
      else { p++; running = status; }
      const type = status & 0xf0;
      if (status === 0xff) {
        const metaType = bytes[p++]!;
        const metaLen = readVlq();
        if (metaType === 0x51 && metaLen === 3) {
          const us = (bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]!;
          bpm = Math.round((60_000_000 / us) * 10) / 10;
        } else if (metaType === 0x03 && !name) {
          name = String.fromCharCode(...bytes.subarray(p, p + metaLen));
        }
        p += metaLen;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVlq();
      } else if (type === 0x90 || type === 0x80) {
        const pitch = bytes[p++]!;
        const vel = bytes[p++]!;
        if (type === 0x90 && vel > 0) {
          open.set(pitch, { tick, velocity: vel });
        } else {
          const start = open.get(pitch);
          if (start) {
            open.delete(pitch);
            notes.push({
              id: newId("n"),
              pitch,
              startTick: Math.round(start.tick * scale),
              lengthTicks: Math.max(1, Math.round((tick - start.tick) * scale)),
              velocity: start.velocity / 127,
              pan: 0,
              probability: 1,
            });
          }
        }
      } else if (type === 0xc0 || type === 0xd0) {
        p += 1;
      } else {
        p += 2;
      }
    }
    pos = end;
  }
  return { notes, bpm, name };
}
