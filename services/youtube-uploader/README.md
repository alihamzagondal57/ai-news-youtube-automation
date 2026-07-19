# youtube-uploader

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions (final pipeline step)

Uploads the rendered 4K video via **YouTube Data API v3** (resumable upload), then sets metadata (title/description/tags), uploads the custom thumbnail, adds it to the channel's uploads playlist, and optionally schedules publish time instead of publishing immediately.

Runs **only after the review gate approves the job** (`review-state.json.status === "approved"` — see [`docs/REVIEW-DASHBOARD.md`](../../docs/REVIEW-DASHBOARD.md)); it is never the step immediately after render.

Auth uses a long-lived OAuth2 refresh token (`YOUTUBE_REFRESH_TOKEN`) generated once via `scripts/youtube-oauth-setup.ts` (interactive, run locally — never in CI).

## Synthetic-content disclosure (required on every upload)

Every video this pipeline produces uses a synthetic voice and an AI-written script, so the uploader **must** set YouTube's altered/synthetic-content disclosure on `videos.insert`:

```jsonc
// videos.insert request body
{
  "status": {
    "containsSyntheticMedia": true   // maps from metadata.json.containsSyntheticMedia (default true)
  }
}
```

`status.containsSyntheticMedia` is a real YouTube Data API v3 field (added 2024-10-30) and disclosure has been mandatory since 2025-05-21. This is a compliance requirement, not optional — the uploader sets it on **every** upload and must fail loudly rather than upload without it. The value is carried in `metadata.json` (`containsSyntheticMedia`, `metadataSchema` in `services/shared`) so the contract is explicit end-to-end.

## Input
`jobs/{jobId}/render.mp4`, `jobs/{jobId}/metadata.json`, `jobs/{jobId}/thumbnail.png`, `jobs/{jobId}/review-state.json` (must be `approved`)

## Output
`jobs/{jobId}/youtube-result.json` — video ID, URL, upload status, quota units consumed (upload costs 1600 units of the 10,000/day default quota — capped at ~6 uploads/day per project).
