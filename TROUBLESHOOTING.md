# Troubleshooting

## The app won't start

1. **Node.js missing or old** — the launcher needs Node 20+. Install from
   https://nodejs.org, then re-run `Start PulseForge.command`.
2. **First run takes a while** — `npm install` runs once; let it finish.
3. **"port 7800 is in use by another app"** — another program owns the port.
   Run with a different one: `PF_PORT=7900 npm run start`.
   If it's a *previous PulseForge* still running, the launcher detects that and
   simply opens the existing instance instead.
4. **Blank page** — hard-reload (⌘⇧R). If `dist/` is corrupt, `npm run build` again.
5. Still stuck? `npm run verify` prints exactly which stage fails.

## No sound

- Press **Play** once after loading — browsers keep audio suspended until a user
  gesture (on iPhone this is mandatory).
- Check the transport: **PAT** mode plays the current Channel Rack pattern;
  **SONG** mode plays the Playlist arrangement — an empty Playlist in SONG mode is
  legitimately silent.
- Check channel/track mutes and mixer master fader; the master meter should move
  when anything is audible.
- macOS System Settings → Sound → Output: confirm the right device.

## Recording problems

- **No mic permission prompt**: Safari/Chrome → site settings → allow Microphone,
  then reload.
- **Input meter dead**: pick the correct device in Recording → Input; unplug/replug
  USB interfaces; check macOS input volume.
- **Echo/feedback warning**: you're monitoring through speakers — use headphones or
  disable monitoring.
- **Recordings feel late**: run the Latency Calibration wizard (Recording tab);
  the measured offset is applied to newly recorded takes.
- **On iPhone over LAN**: `getUserMedia` requires HTTPS or localhost. Playback and
  editing work over `http://<mac-ip>:7800`; recording needs the Mac itself (or put
  the server behind an HTTPS tunnel).

## iPhone / iPad

- Start with `PF_HOST=0.0.0.0 npm run start` on the Mac, then browse to
  `http://<mac-ip>:7800` (find the IP in System Settings → Wi-Fi → Details).
- Tap once anywhere/press Play to unlock audio.
- Add to Home Screen for a full-screen studio (safe-area insets are handled).
- Storage on iOS uses the IndexedDB fallback automatically (no OPFS writes on
  Safari) — projects and samples persist per-browser.

## AI features

- **Provider test fails**: check the key (Providers panel → Test), your network,
  and for Ollama that `ollama serve` is running on the configured base URL.
- **"No API key configured"**: set the key in the UI or export the env var, then
  restart the backend.
- **Generation stuck**: cancel from the job card (jobs are abortable); check the
  backend terminal for redacted provider errors.
- **Nothing AI-ish works but the DAW is fine**: that's by design — the studio never
  requires AI. Check `GET /api/health` and the Providers panel.

## Projects & storage

- **"Recovered unsaved changes from autosave"**: normal after a crash or closed tab —
  the newer autosave was loaded; Save to make it the real version.
- **Project won't open**: it's validated on load; a corrupt save falls back to the
  last good autosave checkpoint automatically.
- **Clearing browser site data deletes projects** (they live in IndexedDB/OPFS).
  Export portable `.pfproj` archives for anything you care about.
- **Imported ZIP rejected**: the importer refuses path-traversal entries and
  non-audio payloads — re-zip the pack cleanly.

## Performance

- Prefer Chrome/Safari over heavily-extended browser profiles.
- Close the Audio Editor's giant waveforms when arranging huge songs.
- Raise the export sample rate only when you need it; 44.1 kHz is standard.
- The engine status readout (top bar, e.g. `48.0k · 5ms`) shows the context sample
  rate and output latency; if latency looks wrong, replug the audio device.

## Everything is slow / the Mac app build fails to sign (iCloud-synced folder)
If this folder lives in **Desktop** or **Documents** with iCloud Drive "Desktop & Documents" turned on,
macOS File Provider sits between Node and every file: type-checks and first test runs can take minutes,
and `codesign` refuses any app bundle built inside the folder ("resource fork, Finder information, or
similar detritus not allowed").
- `npm run build:desktop` already packages in your temp folder and copies only the finished `.dmg` into
  `release/`, so it works anyway.
- `npm run start` runs the backend as a single bundled file (faster to start than `tsx`).
- For a much faster dev loop, move the project to a non-synced folder such as `~/Developer`.

