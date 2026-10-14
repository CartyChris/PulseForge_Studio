# Your First Song in PulseForge Studio

A step-by-step walkthrough from blank project to exported WAV. ~15 minutes.

## 1. Launch & create a project
1. Double-click **Start PulseForge.command** (or `npm run start`).
2. Click **Project ▾ → New Project…**, name it, pick a template (any tempo/kit
   works — you can change everything after), click **Create**.

## 2. Program a beat (Channel Rack tab)
1. You're on the **Channel Rack** tab by default.
2. Click **+ Add Channel**. In the left column, click a kit name's **"+ starter set"**
   button (e.g. Modern Hip-Hop) — adds Kick, Snare, Clap, Hats, Perc in one click.
3. Click step cells to turn them on/off:
   - Kick row: steps 1, 5, 9, 13 (a classic four-on-the-floor).
   - Snare/Clap row: steps 5, 13 (the backbeat).
   - Hat row: every other step for an 8th-note groove.
4. Right-click any lit step to adjust its **velocity**, **probability**, and
   **micro-timing** in a small popup.
5. Try the per-channel buttons on the right of each row: **E** (Euclidean rhythm),
   **R** (Randomize), **H** (Humanize), **V** (Variation) — instant groove ideas.
6. Press **Space** (or the ▶ button) to hear it loop. The **PAT** button (top left
   of transport) means you're hearing this pattern on repeat.

## 3. Add a melodic instrument
1. Look at the **left Browser panel** → click **Instruments** to expand it.
2. Hover any preset (e.g. **808 Bass** or **Studio Piano**) and click the **+rack**
   button that appears — it's added as a new Channel Rack row.
3. Click the **♪** icon on that channel's row (right side) to jump into the
   **Piano Roll** with it selected.

## 4. Write a melody or bassline (Piano Roll tab)
1. Tool is **Pencil** by default (top toolbar, ✏ icon). Click on the grid to drop
   notes — pitch = row, time = column, snapped to the grid.
2. **Drag** a note sideways/up-down to move it in time or pitch.
3. **Grab the right edge** of a note and drag to lengthen/shorten it.
4. **Right-click** a note to delete it.
5. Select notes and use the toolbar: **Quantize**, **Humanize**, **Legato**,
   **Arpeggiate**, **+8va/-8va** (octave), **+1/-1** (semitone), **Dup** (⌘D).
6. Pick a **Chord** from the dropdown before clicking to stamp full chords instead
   of single notes. Set **Key**/**Scale** to highlight in-key rows.
7. The bottom lane shows **Velocity** — switch it to **Pan** from its dropdown.

## 5. Arrange the song (Playlist tab)
1. Switch the transport toggle from **PAT** to **SONG** — now you're arranging.
2. In the left panel, expand **Patterns**, drag your pattern onto a Playlist track
   to place a clip. Drag it again later in the timeline for a second section.
3. Duplicate a clip (⌘D) for a chorus, drop in a different pattern for a verse,
   leave a gap or thin the pattern for a breakdown.
4. Drag audio files (**+ audio** button, left panel) onto their own track for extra
   layers. Trim by dragging clip edges; split with the scissors/Split action;
   fade in/out by dragging the little fade handles at clip corners.
5. Add **Markers**/section labels to name your Intro/Verse/Chorus/Outro.

## 6. Mix it (Mixer tab)
1. Each channel/track gets its own strip: **volume fader**, **pan knob**, **M**/**S**
   (mute/solo), and an **effect slot list**.
2. Click **+ effect** on a strip to add EQ, Compressor, Reverb, Delay, etc. — every
   knob on the effect is live and editable.
3. Drag a fader while the song plays to hear the balance change in real time.

## 7. Record a vocal (Recording tab) — optional
1. Pick your input device, watch the input meter to confirm signal.
2. Turn on **count-in** and **metronome**, arm the track, hit **Record**.
3. Trim/comp your best take, then apply a vocal preset (e.g. **Clean Rap**) from
   the preset list for an instant EQ/gate/compression chain.
4. Drag the finished take into the Playlist like any audio clip.

## 8. Export your song
1. **Project ▾ → Export…**
2. Choose **Full song (WAV)**, pick a sample rate/bit depth (44.1kHz/16-bit is
   fine to start), optionally enable **Normalize**.
3. Click **Export** — the file downloads when rendering finishes.
4. **Project ▾ → Save** (or ⌘S) to keep the project itself for later editing.

---

## 💡 Tips
- **Layer instruments early.** Don't stop at drums — add a piano or pad chord
  underneath your beat (Instruments panel → +rack) even before you have a melody;
  it instantly makes a loop feel like a song.
- **PAT vs SONG** trips people up: PAT always loops just the rack pattern, even if
  your Playlist is empty. Flip to SONG to hear the real arrangement.
- **Right-click is your friend** — steps, notes, and clips all have deeper options
  hiding behind a right-click.
- **Use Euclidean (E) on hats/percussion** for instant interesting rhythms instead
  of hand-programming every step.
- **Save often** (⌘S) — autosave has your back too, but manual saves are instant.
- **Command Palette (⌘K)** finds any action by typing, faster than hunting menus.

---

## 🤖 Using the AI features (all optional)

Everything above works with zero AI. When you want help:

1. **Connect a provider**: AI Assistant tab → Providers → pick one (Anthropic,
   OpenAI, Gemini, OpenRouter, an OpenAI-compatible endpoint, or local **Ollama** —
   Ollama needs no API key at all) → paste your key → **Test**.
2. **AI Assistant tab** — type what you want ("write a chorus melody over my
   chords", "make the drums punchier"). The AI shows a **preview plan** of exact
   changes; you **Accept**, **Modify**, or **Reject** — nothing changes until you
   approve. Every AI change lands in normal Undo history.
   - Toggle **Reversible Autopilot** if you want AI edits to apply automatically
     (still fully undoable; it still can't delete your source audio, spend money,
     or upload anything without asking first).
3. **Compose a full section**: ask for "an alternate chorus" or "a full song
   draft" — you can insert the whole thing, just the drums, just the notes, or
   as an alternate version to compare.
4. **Sound Lab tab** — describe a sound ("dark riser", "vinyl crackle loop") and
   generate audio (needs an audio-capable provider like ElevenLabs). Every
   generation is a tracked job you can cancel/retry; once done you can chop it,
   reverse it, pitch it, layer it with your beat, and drop it in the Playlist.
5. **Ask for mix feedback**: "how's my mix?" in the AI Assistant gives suggestions
   labeled as opinions, with A/B preview before you commit to any change.

**Tip:** start with **Ollama** (free, local, no key) to try the AI workflow
risk-free before connecting a paid provider.

---

## 🚀 Advanced — explore later
- **Sample slicing**: import a loop, slice it into pieces (Audio Editor tab),
  rearrange the slices, send them to a Drum Rack.
- **Automation clips**: automate a filter sweep or volume fade over time in the
  Playlist.
- **Sidechain ducking**: make the bass duck under the kick for that pumping feel
  (Mixer → channel routing).
- **Take comping**: record multiple vocal takes and comp the best phrases from
  each (Recording tab → take lanes).
- **Sample Pack Resource Hub**: import your own sample packs (ZIP/folder) — see
  the Resources tab.
- **Stem export**: export each mixer channel as its own WAV for use in another DAW.
- **MIDI import/export**: bring in melodies from other software, or export yours.
- **Experimental pitch assist**: basic pitch correction on vocals — clearly
  labeled experimental, not a full Auto-Tune replacement.
