/** Base64 → ArrayBuffer for audio the hosted (serverless) backend returns inline. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
