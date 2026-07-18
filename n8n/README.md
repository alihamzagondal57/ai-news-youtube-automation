# n8n

Orchestration layer. Exported workflow JSON lives in `workflows/` (import into your n8n instance — self-hosted or n8n cloud).

- `workflows/manual-mode.json` — trigger: webhook/form with a `topic` input → writes `trend.json` directly (skips `trend-research`) → runs the rest of the pipeline sequentially via `workflow_dispatch` calls to this repo's GitHub Actions, polling job status in R2 between steps → calls `render-server` → `youtube-uploader`
- `workflows/auto-mode.json` — trigger: cron (e.g. daily) → runs `trend-research` first, then the same chain as manual mode
- `workflows/shared-error-handling.json` — reusable error-trigger workflow: on any step failure, notify (email/Telegram/Slack node — configure your own credential) and mark the job `failed` in the manifest so it doesn't silently retry into a broken state

## Why n8n calls GitHub Actions instead of doing the work itself
Keeps heavy/long-running logic (LLM calls, Whisper, ffmpeg) out of n8n's own execution environment and in versioned, testable code (`services/`) that also runs in CI. n8n's job here is sequencing, retries, and human-in-the-loop approval (e.g. pause for manual thumbnail/script review before render, if enabled).
