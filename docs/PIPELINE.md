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
├── render.mp4                # from remotion, via render-server
├── thumbnail.png             # from thumbnail-generator (real render.mp4 frame, or a themed still if render.mp4 isn't there yet)
├── renders/                   # targeted-re-render cache: per-chunk video + the continuous audio track
│   ├── segment-*.mp4          #   video-only chunks, one per segment
│   ├── outro.mp4              #   video-only outro chunk
│   └── audio.wav              #   full-timeline audio, rendered once and reused
├── script-structure.json      # the script skeleton this job was written against (sticky once chosen)
├── theme.json                 # the visual theme this job renders with (sticky once chosen)
├── voice.json                 # the narrator voice this job is spoken in (sticky once chosen)
├── review-state.json          # from review-dashboard: approval status, voice/style/clip/theme choices
└── youtube-result.json        # from youtube-uploader
```

Reusable style/voice presets live outside the per-job tree at `presets/{presetId}.json` (`stylePresetSchema`). Rotation history lives at `state/theme-rotation.json`, `state/script-structure-rotation.json`, and `state/voice-rotation.json` — the three independent variety axes (look, shape, voice), all driven by the same shared `rotate()` helper. `state/media-usage.json` is a related but separate mechanism: a soft, graceful-degrade exclusion list (not a strict rotation) that steers media-sourcing away from stock clips used recently on other jobs — see `services/media-sourcing/README.md`.

### Script structure selection
Each video is written against one of 13 script skeletons (`services/shared/src/script-structure`), varying opening move, throughline, segment count/depth, analysis placement, and outro — so consecutive videos don't share a shape, only a format. This is the counterpart to theme rotation: themes vary the *look*, structures vary the *script*, and the inauthentic-content policy penalises sameness in both.

Resolution mirrors theme selection exactly — manual override (`review-state.json.structureId`) → the structure already recorded for this job (`script-structure.json`) → auto-rotation excluding the last 4. Both rotations share one implementation (`services/shared/src/rotation`), so the no-recent-repeats guarantee is verified in one place.

Stickiness matters for a different reason here than for themes: re-running a failed `script-generator` step is the normal retry path, and re-rolling the skeleton mid-retry would produce a structurally different script than downstream steps were told about. A structure override regenerates the script and therefore **everything downstream** — the most expensive override in the pipeline. Full design: [`services/script-generator/README.md`](../services/script-generator/README.md).

### Theme selection
Every video gets one of 18 visual themes (`services/shared/src/theme`), so consecutive uploads don't look like the same template re-run — which is what YouTube's inauthentic-content policy penalises. render-server resolves the theme in priority order:

1. **Manual override** — `review-state.json.themeId`, set from the review dashboard.
2. **The theme already recorded for this job** — `jobs/{jobId}/theme.json`.
3. **Auto-rotation** — picks from the catalog excluding the last few used (`state/theme-rotation.json`), then records the pick.

Step 2 makes the theme **sticky per job**, and that is load-bearing rather than an optimisation: a targeted re-render reuses cached chunks, so re-rolling the theme would re-skin the video while stale-looking chunks were spliced back in. Rotation happens once per job, not once per render. A theme change (override) re-skins everything and therefore requires a **full** re-render, never a targeted one.

Rotation state is read-modify-write without a lock. The pipeline renders one video at a time on a single on-demand VM, so this is safe; genuinely concurrent jobs could pick the same theme, which costs variety but breaks nothing.

## Step order
1. **trend-research** (auto mode only) → `trend.json`
2. **script-generator** → `script.json`
3. **voiceover** → `voiceover.wav`, `segment-timing.json`
4. **caption-sync** → `captions.json`
5. **media-sourcing** → `media/`
6. **metadata-generator** → `metadata.json`
7. **render** (Remotion, on the GCP Compute Engine VM via render-server) → `render.mp4`
8. **thumbnail-generator** → `thumbnail.png` (a representative frame from `render.mp4`, composed with the job's own theme tokens and the opening segment's headline — see [`services/thumbnail-generator/README.md`](../services/thumbnail-generator/README.md))
9. **review** (human approval gate, review-dashboard) → `review-state.json` — pipeline parks here until `status: "approved"`
10. **youtube-uploader** → `youtube-result.json`

The **review gate** (step 9) is where the pipeline stops for a human. The review dashboard reads `render.mp4` plus the upstream artifacts and lets the operator swap a clip, change the voice, or restyle the on-screen text, writing choices to `review-state.json`. On approve, the dashboard's `POST /approve` both flips `review-state.json.status` and (if `N8N_APPROVAL_WEBHOOK_URL` is configured) POSTs the new state to n8n's `release-on-approval` workflow, which resumes and triggers `youtube-uploader`. Full design: [`REVIEW-DASHBOARD.md`](REVIEW-DASHBOARD.md), [`../n8n/README.md`](../n8n/README.md).

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
- validates its input against the Zod schema in `services/shared/schemas` (every service in this pipeline is Node/TypeScript — there is no Python/pydantic component)
- is idempotent — re-running a step overwrites just that step's artifact, so a failed job can resume from the failed step instead of restarting from scratch

**`job.json` is owned by n8n, not by the individual services.** Each service stays a stateless, independently-testable unit — it reads/writes only its own artifact and never touches `job.json`. The n8n workflow (`n8n/workflows/manual-mode.json`) creates the initial `job.json` when a job starts and advances `currentStep`/`status` itself after each step succeeds (or marks it `failed` via `shared-error-handling.json` if one doesn't) — this is what the review dashboard's job list (`currentStep === "review"`) and `youtube-uploader`'s own gate ultimately key off. See [`../n8n/README.md`](../n8n/README.md).
