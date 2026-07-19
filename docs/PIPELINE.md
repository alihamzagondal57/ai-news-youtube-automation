# Pipeline data contract

Every run gets a `jobId` (UUID). All artifacts for that run live under `jobs/{jobId}/` in the shared R2 bucket, so any stateless step (GitHub Actions runner or the render VM) can pick up exactly where the previous one left off.

```
jobs/{jobId}/
├── job.json              # manifest: status, current step, timestamps, mode (manual|auto)
├── trend.json             # from trend-research (auto) or written directly by n8n (manual)
├── script.json             # from script-generator
├── voiceover.wav           # from voiceover
├── segment-timing.json     # from voiceover
├── captions.json            # from caption-sync
├── media/
│   ├── clip-*.mp4
│   ├── media-manifest.json
│   ├── music.mp3
│   └── sfx/*.mp3
├── metadata.json            # from metadata-generator (incl. containsSyntheticMedia disclosure flag)
├── thumbnail.png             # from metadata-generator
├── render.mp4                # from remotion, via render-server
├── renders/                   # targeted-re-render cache: per-chunk video + the continuous audio track
│   ├── segment-*.mp4          #   video-only chunks, one per segment
│   ├── outro.mp4              #   video-only outro chunk
│   └── audio.wav              #   full-timeline audio, rendered once and reused
├── review-state.json          # from review-dashboard: approval status, voice/style/clip choices
└── youtube-result.json        # from youtube-uploader
```

Reusable style/voice presets live outside the per-job tree at `presets/{presetId}.json` (`stylePresetSchema`).

## Step order
1. **trend-research** (auto mode only) → `trend.json`
2. **script-generator** → `script.json`
3. **voiceover** → `voiceover.wav`, `segment-timing.json`
4. **caption-sync** → `captions.json`
5. **media-sourcing** → `media/`
6. **metadata-generator** → `metadata.json`, `thumbnail.png`
7. **render** (Remotion, on the GCP Compute Engine VM via render-server) → `render.mp4`
8. **review** (human approval gate, review-dashboard) → `review-state.json` — pipeline parks here until `status: "approved"`
9. **youtube-uploader** → `youtube-result.json`

The **review gate** (step 8) is where the pipeline stops for a human. The review dashboard reads `render.mp4` plus the upstream artifacts and lets the operator swap a clip, change the voice, or restyle the on-screen text, writing choices to `review-state.json`. n8n waits on `review-state.json.status` and only advances to `youtube-uploader` on `"approved"`. Full design: [`REVIEW-DASHBOARD.md`](REVIEW-DASHBOARD.md).

### Targeted re-render
A clip swap changes one segment, so re-encoding the whole 4K timeline is wasteful. `POST /render` accepts an optional `changedSegmentIds: number[]`; render-server then rebuilds only the affected chunks and reuses the rest from the per-segment cache in `jobs/{jobId}/renders/`.

**How A/V sync is preserved.** The timeline is partitioned into contiguous chunks (one per segment, plus the outro) that tile it exactly — a gap would drop frames and an overlap would duplicate them, either desyncing everything downstream, so the partition is validated as an invariant before anything renders. Each chunk is rendered **video-only** at absolute frame ranges, and the **audio is rendered once for the entire timeline and muxed on at the end**. Audio is never cut, re-encoded, or concatenated at a boundary, so stitching has no mechanism to introduce drift. Video chunks are joined with ffmpeg's concat demuxer using stream copy (no re-encode, no generation loss). Because Remotion renders absolute frame indices deterministically, frame *F* rendered inside a chunk is identical to frame *F* of a full render — which is what keeps burned-in captions locked to the voiceover.

**Invalidation is wider than the changed segment.** The composition cross-fades segment backgrounds, mounting each one `TRANSITION_FRAMES` early and holding it that long past its end, so a swapped clip is already fading in during the *previous* segment's frames and still fading out during the *next* one's. Invalidation therefore covers `[startFrame - TRANSITION_FRAMES, endFrame + TRANSITION_FRAMES)` — exactly the `<Sequence>` mount window, which is a provable bound on what a segment can affect. In practice one clip swap re-renders three chunks. Re-rendering only the segment's own range leaves a stale clip visible in the crossfade; `.smoke-test/smoke-test-stitch.mts` asserts against that as an explicit negative control.

A **voice** change instead alters every segment's timing (new TTS audio), so it re-runs `voiceover` → `caption-sync` → a **full** re-render — it must not be sent as `changedSegmentIds`. A **style-only** change re-renders from the same inputs with new style props.

### Synthetic-content disclosure
`metadata.json` carries `containsSyntheticMedia` (defaults `true`). `youtube-uploader` maps it onto the video resource's `status.containsSyntheticMedia` field on `videos.insert`, satisfying YouTube's mandatory altered/synthetic-content disclosure (required since 2025-05-21). This is not optional for this pipeline — every video qualifies (synthetic voice + AI-written script).

Steps 2–6 depend only on `script.json` timing, not on each other's outputs, so `voiceover`→`caption-sync` must run sequentially (captions need the rendered audio) but `media-sourcing` can run in parallel with `voiceover`/`caption-sync` once `script.json` exists — n8n's workflow fans this out.

Every step:
- reads only from `jobs/{jobId}/`
- validates its input against the Zod/pydantic schema in `services/shared/schemas`
- updates `job.json`'s `status` and `currentStep` before exiting (success or failure)
- is idempotent — re-running a step overwrites just that step's artifact, so a failed job can resume from the failed step instead of restarting from scratch
