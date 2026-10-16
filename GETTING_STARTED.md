# Your First Song in PulseForge Studio 2.0

Two paths: let the **AI Producer** make a finished beat in a minute and tweak it, or build
everything by hand, step by step (~15 minutes). You can mix both freely.

**Where things are.** The left **nav rail** has every section: Home, AI Producer, Beat,
Melody, Song, Record, Mix, Sounds, Connect (Intermediate adds Instrument, Audio, Sound Lab and
AI Chat). Pick **Beginner**, **Intermediate** or **Expert** on first launch, or any time from the
top bar. Levels only change how much is on screen; no feature is ever removed. Press `?` for
all shortcuts, or ⌘K to search every action.

## 0. The fast way: the AI Producer
1. Launch the **Mac app** (or double-click **Start PulseForge.command**, or `npm run start`).
2. On **Home**, click a genre tile (Trap, Drill, Afrobeats, Lo-Fi… 16 genres), or type a beat:
   *"moody drill beat with strings and a sliding 808, 142 bpm in F# minor"* → **Make it**.
3. Watch the five stages: **Plan → Write the music → Arrange → Mix & master → Review**. The mix
   stage renders a test section, measures loudness and tone, and adjusts until it measures
   right. You get a song with real mixer tracks, not a flat audio file.
4. **Play song**, **New variation**, or type a change: *"faster"*, *"darker"*, *"more swing"*,
   *"no melody"*, *"longer"*, *"another version"*. Every step is undoable (⌘Z).
5. Jump into **Beat / Melody / Song / Mix** to edit anything by hand, then **Export WAV**.

No AI connected? The **offline producer** makes complete beats on its own. Connect your AI on
the **Connect** page for smarter plans and a producer review (see the AI section below).

## 1. Create a project (by hand)
1. Click **Project ▾ → New Project…** in the top bar, name it, pick a template, click **Create**.

## 2. Program a beat (Beat page)
1. Open **Beat**. The top row is **drum pads**: click them, or press keys **1–8**, to hear sounds.
2. Pick a **Kit** (22 kits) and, to start from a genre groove, a **Groove** in the page header.
3. Click step cells to turn them on/off:
   - Kick row: steps 1, 5, 9, 13 (four-on-the-floor).
   - Snare/Clap row: steps 5, 13 (the backbeat).
   - Hat row: every other step for an 8th-note groove.
4. Right-click any lit step to adjust its **velocity**, **probability** and **micro-timing**.
5. Drag **Swing** for groove. At Intermediate, each row also has **E** (Euclidean),
   **H** (Humanize), **V** (Variation) and **F** (Fill); Expert adds the rest.
6. Press **Space** to loop it. In Beginner the top bar switches to **Pattern** mode on this page
   for you, so you hear the pattern you're editing.

## 3. Add a melodic instrument
1. Open **Sounds** (or the left Browser panel at Intermediate/Expert) → **Instruments**.
2. Click **+rack** on any preset (e.g. **808 Bass**, **Grand Piano (Salamander)**, **Strings**):
   it's added as a new row on the Beat page.

## 4. Write a melody or bassline (Melody page)
1. Open **Melody**. Pick the part and the **pattern** in the toolbar (♪ marks patterns that
   already have notes for that part).
2. Click the grid to drop notes (pencil ✏ is the default tool). Drag to move, grab a note's
   right edge to lengthen, right-click to delete.
3. Toolbar: **Quantize**, **Dup**, **+8va/-8va**; Intermediate adds ghost notes, humanize,
   legato, arpeggiate, strum, harmonize; more behind **More tools**.
4. Pick a **Chord** before clicking to stamp full chords. Set **Key**/**Scale** to highlight
   in-key rows.
5. The bottom lane shows **Velocity**; switch it to **Pan** from its dropdown.

## 5. Arrange the song (Song page)
1. Open **Song**. In Beginner the top bar switches to **Song** mode here, so Play plays the
   whole arrangement (Intermediate/Expert: flip **Pattern / Song** yourself).
2. Double-click an empty lane to place the selected pattern; drag clips to move, drag their
   edges to trim, ⌘D to duplicate.
3. **+ Audio Track** for audio layers; split with the scissors; fade with the clip-corner handles.
4. **+ Marker** / **+ Section** to name your Intro/Verse/Hook/Outro.

## 6. Mix it (Mix page)
1. **Quick Mix** sliders: Loudness, Drums, Bass, Music, Space. **Loudness** drives the master
   limiter, so it gets louder without clipping.
2. **Auto-mix** renders a section, measures loudness and tone, and sets the levels (undoable).
3. Below is the full mixer: per strip **volume**, **pan**, **M/S**, and **+ effect** (26 effect
   types). Drag faders while the song plays to hear the balance change.

## 7. Record a vocal (Record page): optional
1. Pick your input device and watch the input meter.
2. Turn on **count-in** and **metronome**, hit **Record**. Wear headphones.
3. Comp your best take, then apply a vocal preset (e.g. **Clean Rap**) for an instant chain.
4. Drag the take into the Song like any audio clip.

## 8. Export your song
1. **Project ▾ → Export…**
2. Choose **Full song (WAV)**, a sample rate/bit depth (44.1 kHz/16-bit is fine), optionally
   **Normalize**.
3. Click **Export**. **Project ▾ → Save** (⌘S) keeps the project for later editing.

---

## 💡 Tips
- **Layer early.** Add a piano or pad under your beat before you have a melody; a loop
  instantly feels like a song.
- **Pattern vs Song**: Pattern always loops the pattern you're editing; Song plays the
  arrangement. Beginner switches for you per page.
- **Right-click is your friend**: steps, notes and clips all have deeper options.
- **Euclidean (E) on hats/percussion** gives interesting rhythms instantly.
- **Command palette (⌘K)** finds any action by typing; ⌥1…⌥9 jumps between sections.

---

## 🤖 Using AI (all optional)

Everything above works with zero AI. To connect your own:

1. **Connect page.** The Mac app finds the AI CLIs you already use: **Claude Code**, **Codex**,
   **Kimi Code**, **Grok**. It runs them answer-only (tools off, empty sandbox folder, your
   existing login; tokens are never read). Press **Test**, then **Use**, or leave the producer on
   **Auto**, which tries your connected AIs in order and skips any that fail (the Connect page
   shows why, e.g. "not logged in"). You can also:
   - sign in to **OpenRouter** with one click (OAuth): hundreds of models on one bill,
   - paste API keys: Anthropic, OpenAI, Gemini, xAI, Moonshot/Kimi, Z.ai GLM (API or Coding
     Plan), DeepSeek, Mistral, Groq, Together, or any OpenAI-/Anthropic-compatible endpoint,
   - use local models: **Ollama** or **LM Studio** (free, no key).
2. **AI Producer**: with an AI connected, plans are smarter, *"change it"* requests understand
   more, and the **Producer review** suggests mixer fixes (applied automatically only if you turn
   on auto-apply; always undoable).
3. **AI Chat** (Intermediate): ask for edits ("write a chorus melody over my chords", "make the
   drums punchier"). You see a **preview plan** and Accept, Modify or Reject; every change is in
   Undo history. **Reversible Autopilot** applies edits automatically (still undoable).
4. **Sound Lab** (Intermediate): describe a sound ("dark riser", "vinyl crackle loop") and
   generate it with an audio provider (ElevenLabs, Fish Audio…). Results land in your library.

---

## 🚀 Advanced: explore later
- **Sample slicing**: import a loop, slice it (Audio page), send slices to the pads.
- **Automation clips**: filter sweeps and volume fades over time in the Song.
- **Sidechain ducking**: duck the bass under the kick (Mix → channel routing). The AI Producer
  sets this up for genres that use it.
- **Take comping**: record several takes and comp the best phrases (Record → take lanes).
- **Sample packs**: import ZIPs/folders from the Resources page (Expert) or Sounds.
- **Stem export**: export each mixer channel as its own WAV.
- **MIDI import/export**: bring melodies in from other software, or export yours.
- **PulseTune**: pitch correction for vocals (Audio page).
