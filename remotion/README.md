# remotion

**Runtime:** Node/TypeScript (Remotion, server-side rendering — no browser canvas) · **Runs on:** the on-demand GCP render VM, invoked by `infra/render-server`

The actual video assembly: takes every artifact a job has produced (`voiceover.wav`, `captions.json`, per-segment stock clips, `music.wav`, ticker headlines) and composes the final broadcast-style news video.

## Structure
- `src/Root.tsx` — registers the `NewsVideo` composition; `defaultProps` is the local dev fixture, real jobs override every prop via `renderMedia({ inputProps })` in `infra/render-server`
- `src/compositions/NewsVideo.tsx` — assembles the timeline: intro stinger (overlaid on segment 1, doesn't displace it) → per-segment background + lower-third + breaking-news flash → word-synced captions (full-length, absolute-timed) → outro CTA. `calculateMetadata` derives `durationInFrames`/`fps`/`width`/`height` from the job's own `segments`/`resolution`/`fps` props.
- `src/types/newsVideoProps.ts` — the Zod schema `NewsVideo` actually consumes (mirrors `services/shared`'s pipeline schemas, but Remotion compositions must stay dependency-free of Node-only packages like the AWS SDK, so this is a small standalone schema rather than an import from `@ai-news/shared`)
- `src/components/`
  - `captions/` — word-synced, karaoke-style highlight text driven by `captionWords` (rolling window, active word highlighted)
  - `ticker/` — scrolling breaking-news ticker, pinned to the bottom edge, runs the full video
  - `transitions/` — `SegmentSlide`: a fade+slide crossfade between adjacent segment backgrounds. **Not** `@remotion/transitions`' `TransitionSeries` — that API shortens total sequence duration by the transition length, which would progressively desync the visual track from the voiceover audio (fixed-length, generated once by the `voiceover` step, and never touched by transition timing). `SegmentSlide` only ever extends a segment's `<Sequence>` bounds slightly into its neighbors, so captions/lower-thirds/audio stay locked to the segment timing that `voiceover`/`caption-sync` actually produced.
  - `lower-thirds/` — animated headline bar per segment, exact segment timing (no transition padding)
  - `motion-graphics/` — `IntroStinger`, `BreakingNewsBumper` (flash on segments flagged `breaking`), `OutroCTA`
  - `media/` — `SegmentBackground`: renders stock footage via `OffthreadVideo`, or an accent-colored gradient placeholder when a segment has no `mediaSrc` yet (keeps the composition renderable before `media-sourcing` exists)
- `src/audio/AudioMix.tsx` — voiceover at full volume throughout; background music ducked under it via a per-frame volume function, swelling only during the intro/outro (no narration) window

## Rendering
- Target: 4K (3840×2160), 30fps, H.264 — driven by `inputProps.resolution`/`fps`, not hardcoded (the local dev fixture renders at 720p for fast iteration; real jobs pass full 4K)
- Rendered via `@remotion/renderer`'s `renderMedia` from `infra/render-server`, not the CLI, so it can run unattended on the VM and report progress/errors back through the job manifest
- Output written to `jobs/{jobId}/render.mp4` and pushed to R2

## Local dev
```bash
cd remotion
npm install
npm run preview   # generates synthetic fixture audio, then opens Remotion Studio on the sample job
npm run render    # renders the sample job to out/render.mp4 (fast — 720p, ~15s)
```
`npm run fixture` (run automatically by both of the above) synthesizes tiny WAV files for the voiceover/music tracks with a pure-Node script (`sample-job/generate-fixture-audio.mjs`) — no ffmpeg or real TTS/stock-media dependency needed just to exercise the composition. Segments in the fixture have no `mediaSrc`, so they render as gradient placeholders instead of real footage; that's expected until `media-sourcing` exists.
