import { describe, it, expect } from "vitest";
import { base64ToArrayBuffer } from "./base64";

describe("base64ToArrayBuffer", () => {
  it("round-trips binary audio bytes (incl. 0x00 and 0xFF), data-URL prefix and line breaks", () => {
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x7f]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect([...new Uint8Array(base64ToArrayBuffer(b64))]).toEqual([...bytes]);
    expect([...new Uint8Array(base64ToArrayBuffer(`data:audio/wav;base64,${b64.slice(0, 4)}\n${b64.slice(4)}`))]).toEqual([...bytes]);
  });
});
