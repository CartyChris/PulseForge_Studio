# Security & Privacy

## Threat model

A local, single-user music app whose only sensitive assets are (1) provider API keys,
(2) the user's audio/projects, and (3) whatever a hostile ZIP or a hostile AI
response might try to do. Everything below maps to a mitigation in code.

## Credentials

- Keys live **only in the backend**: env vars or `~/.pulseforge/secrets.json`
  written with mode `600`. The frontend never receives key material; `/api/providers`
  returns booleans (`hasKey`), never values. Verified in e2e: the providers payload
  is asserted to contain no `sk-`-style strings, and the built bundle is grepped in
  the verification report.
- All backend logging passes through `redactSecrets()` which masks stored key
  values and common key shapes before anything is printed.

## AI boundaries

- **No code execution.** Model output is parsed as data and validated with Zod:
  compositions against the composition schema, edits against the DAW command schema.
  Unknown command types, out-of-range values, or unknown target IDs fail validation
  and the whole plan is rejected — atomically, nothing partially applied (covered by
  an e2e test).
- **Undo everything.** Applied plans enter the same undo history as manual edits.
- **Reversible Autopilot limits** (enforced in the command layer, not by prompt):
  no source-audio deletion, no provider spending without a confirmation dialog, no
  audio upload without a visible disclosure dialog, no filesystem paths — commands
  only address project entities by ID.
- **Cloud disclosure.** Audio leaves the machine only through the explicit
  analyze-audio flow, which names the provider and requires confirmation; the
  transport bar shows a cyan cloud light during any provider request.

## File handling

- **ZIP safety**: archives are inspected before extraction; entries with `..`,
  absolute paths, symlink-style names, executable extensions, or absurd sizes are
  rejected/ignored (unit-tested traversal cases).
- **Filenames** are sanitized to a flat safe charset before touching OPFS/IndexedDB.
- **Size & MIME limits** on imports and on backend request bodies; request timeouts
  and job cancellation (AbortController) on all provider calls.
- **Pack downloads** happen only on explicit user action, with a size cap, and the
  bytes are handed to the same inspected-import path.

## Recording & privacy

- Recording requires the browser's mic permission; while any capture is live a red
  mic light is shown in the transport bar — there is no background recording path.
- Dry recordings are preserved locally; nothing is uploaded unless you explicitly
  use a cloud analysis/generation feature.
- The backend binds `127.0.0.1` by default. `PF_HOST=0.0.0.0` (LAN/phone use) is
  opt-in and logged loudly at startup.

## Rate limiting & DoS hygiene

Per-route rate limits, body-size caps (packs use a higher, still-bounded limit),
SSE connection cleanup on disconnect, and bounded job history.

## Reporting

This is a local app; if you find an issue, open one in your project tracker of
choice and fix forward — there is no server fleet to coordinate a disclosure with.
