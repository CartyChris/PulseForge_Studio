# AI OS Integration Guide

PulseForge is standalone-first. Everything host-specific flows through one typed
interface, so embedding the studio in the AI OS later means implementing a single
adapter — the audio engine, project system, instruments, editing, and AI command
layer need **zero changes**.

## The seam

`src/host/adapter.ts` defines:

```ts
interface HostPlatformAdapter {
  getEnvironment(): Promise<HostEnvironment>;
  getTheme(): Promise<StudioTheme>;
  getSecret(providerId: string): Promise<string | null>;
  setSecret?(providerId: string, value: string): Promise<void>;
  importFiles(options?: ImportOptions): Promise<ImportedFile[]>;
  exportFiles(files: ExportedFile[]): Promise<void>;
  selectProjectDirectory?(): Promise<ProjectDirectoryHandle | null>;
  openExternalURL(url: string): Promise<void>;
  notify(notification: StudioNotification): void;
}
```

`StandaloneHostAdapter` (same file) is the browser implementation the app uses
today: `<input type=file>` imports, download-anchor exports, toast notifications,
and — deliberately — `getSecret() → null`, because in standalone mode secrets live
in the local backend, never the frontend.

`integrations/aios-adapter/index.ts` contains **`AIOSHostAdapter`** — a complete,
typed, documented implementation against an `AIOSBridge` interface that the AI OS
must inject. It is intentionally not wired up; it compiles against the same
`HostPlatformAdapter` contract.

## Embedding steps

1. **Provide the bridge.** In the AI OS webview/iframe host, expose an object
   satisfying `AIOSBridge` (see the file — environment, theme, secrets vault,
   file pickers, URL opener, notifier). Via `postMessage` RPC, a preload script,
   or module injection — your call; the adapter only needs the promises to resolve.
2. **Install the adapter before mount.** In `src/main.tsx`:

   ```ts
   import { setHost } from "./host/adapter";
   import { AIOSHostAdapter } from "../integrations/aios-adapter";
   if (window.__AIOS_BRIDGE__) setHost(new AIOSHostAdapter(window.__AIOS_BRIDGE__));
   ```

   Nothing else changes: every import/export/notify/secret call in the app already
   routes through `getHost()`.
3. **Decide where the backend lives.** Options, in order of least work:
   - Keep the local Fastify service and point the studio at it (status quo).
   - Let the AI OS supply keys via `getSecret()` and proxy provider calls itself —
     the backend accepts per-request keys from the host adapter path.
   - Replace `/api` with AI OS-native services implementing `AI_API_REFERENCE.md`
     (the frontend's only coupling is that HTTP surface + SSE).
4. **Theme.** `getTheme()` returns mode + accent; the studio reads it at boot.
   Map AI OS theming there.
5. **Programmatic control (optional).** The window-scoped `__pulseforge` surface
   (used by the e2e suite) exposes the store, validated command dispatch, composition
   insertion, offline render, and project load/save — all through the same validated
   paths as the UI. An AI OS agent can drive the studio through it without any
   privileged bypass.

## Invariants to preserve

- Don't hand the frontend raw provider keys even in AI OS mode; implement
  `getSecret` against the OS vault and keep provider calls server-side/OS-side.
- AI edits must stay `DawCommand[]`-shaped (validated, reversible). Resist the
  temptation to give agents direct store access.
- The audio engine assumes a user gesture unlocks the AudioContext — keep a real
  click/tap in the embedding flow before expecting sound.

## Files that matter

- `src/host/adapter.ts` — the contract + standalone implementation
- `integrations/aios-adapter/index.ts` — the AI OS adapter + bridge contract
- `AI_API_REFERENCE.md` — the backend surface if you re-home it
- `e2e/studio.spec.ts` — examples of driving the studio programmatically
