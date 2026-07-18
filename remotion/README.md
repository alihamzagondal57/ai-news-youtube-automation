# remotion

**Runtime:** Node/TypeScript (Remotion, server-side rendering — no browser canvas) · **Runs on:** the Oracle Cloud render VM, invoked by `infra/render-server`

The actual video assembly: takes every artifact a job has produced (`voiceover.wav`, `captions.json`, `media-manifest.json`, `music.mp3`, `sfx/*`) and composes the final broadcast-style news video.

## Structure
- `src/Root.tsx` — registers the `NewsVideo` composition, duration/fps/dimensions driven by job data (`calculateMetadata`)
- `src/compositions/NewsVideo.tsx` — top-level timeline: intro stinger → segments (B-roll + lower-third + captions) → outro
- `src/components/`
  - `captions/` — word-synced, karaoke-style highlight text driven by `captions.json`
  - `ticker/` — scrolling breaking-news ticker (bottom-third, looping headlines)
  - `transitions/` — segment-to-segment transitions (`@remotion/transitions`: wipe, slide, fade)
  - `lower-thirds/` — animated name/headline bars
  - `motion-graphics/` — intro stinger, breaking-news bumper, outro CTA
- `src/audio/` — voiceover + music ducking (music drops under narration via `<Sequence>` volume envelopes), SFX cue placement

## Rendering
- 4K (3840×2160), 30fps, H.264 via `@remotion/renderer` `renderMedia` (server-side, **not** `remotion render` against a browser canvas in the traditional sense — Remotion still uses headless Chromium internally per-frame, but orchestrated by our Node render-server so it can run unattended on the VM)
- Concurrency tuned to the VM's core count (see `infra/render-server`)
- Output written to `jobs/{jobId}/render.mp4` and pushed to R2

## Local dev
```bash
cd remotion
npm install
npm run preview   # Remotion Studio, preview compositions with a sample job fixture
```
