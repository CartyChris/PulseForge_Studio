# Sample Pack Guide

## Importing your own sounds

Three buttons at the top of the left Browser panel:

- **+ audio** — import individual audio files (WAV, MP3, AAC, M4A, OGG; FLAC/AIFF
  where the browser can decode them).
- **+ zip** — import a sample-pack ZIP. Contents are **inspected before extraction**:
  path-traversal entries (`../`, absolute paths) are rejected, executables and
  non-audio files are ignored, pack folder structure is preserved.
- **+ folder** — import a whole folder of samples (structure preserved as tags).

Every import gets waveform previews, one-shot/loop detection, BPM estimation, and
searchable name/tag indexing. Star samples to favorite them. Drag any sample onto
the Playlist, a Drum Rack channel, or a Sampler instrument — or use the per-sample
buttons for the same actions.

## Resource Hub (Resources tab)

Curated, *editable* directory of legitimate sources for free sounds:

- **Freesound** — huge community library; licenses vary per sound (CC0/CC-BY/CC-BY-NC).
- **MusicRadar SampleRadar** — large royalty-free collections for music production.
- **99Sounds** — free packs from sound designers; check each pack's terms.
- **Pixabay Sound Effects** — royalty-free SFX under the Pixabay license.

Each entry shows content type, a license reminder, **Open Website**, and
**Import Downloaded Pack** (jumps straight into the ZIP importer). **Add Custom
Resource** lets you save your own sources with license notes.

> ⚠ "Free to download" is not "free of obligations." Licenses differ per site and
> often per individual sound: some require attribution, some forbid commercial use.
> PulseForge stores a source/license note with every imported pack — fill it in;
> future-you will thank present-you.

## How imports are stored

Audio lives in the browser's Origin Private File System (falling back to IndexedDB
when OPFS is unavailable, e.g. iOS Safari). Portable project exports (`.pfproj`)
copy every referenced sample into the archive so projects travel whole.

## Sampler quick reference

Drop a sample on a Sampler channel and you get: root-note assignment with pitch
tracking, start/end and loop points, ADSR, filter, gain/pan, polyphony or mono with
portamento, reverse, and velocity response — all editable in the Instrument tab.
