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
├── metadata.json            # from metadata-generator
├── thumbnail.png             # from metadata-generator
├── render.mp4                # from remotion, via render-server
└── youtube-result.json        # from youtube-uploader
```

## Step order
1. **trend-research** (auto mode only) → `trend.json`
2. **script-generator** → `script.json`
3. **voiceover** → `voiceover.wav`, `segment-timing.json`
4. **caption-sync** → `captions.json`
5. **media-sourcing** → `media/`
6. **metadata-generator** → `metadata.json`, `thumbnail.png`
7. **render** (Remotion, on the Oracle VM via render-server) → `render.mp4`
8. **youtube-uploader** → `youtube-result.json`

Steps 2–6 depend only on `script.json` timing, not on each other's outputs, so `voiceover`→`caption-sync` must run sequentially (captions need the rendered audio) but `media-sourcing` can run in parallel with `voiceover`/`caption-sync` once `script.json` exists — n8n's workflow fans this out.

Every step:
- reads only from `jobs/{jobId}/`
- validates its input against the Zod/pydantic schema in `services/shared/schemas`
- updates `job.json`'s `status` and `currentStep` before exiting (success or failure)
- is idempotent — re-running a step overwrites just that step's artifact, so a failed job can resume from the failed step instead of restarting from scratch
