# youtube-uploader

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions (final pipeline step)

Uploads the rendered 4K video via **YouTube Data API v3** (resumable upload), then sets metadata (title/description/tags), uploads the custom thumbnail, adds it to the channel's uploads playlist, and optionally schedules publish time instead of publishing immediately.

Auth uses a long-lived OAuth2 refresh token (`YOUTUBE_REFRESH_TOKEN`) generated once via `scripts/youtube-oauth-setup.ts` (interactive, run locally — never in CI).

## Input
`jobs/{jobId}/render.mp4`, `jobs/{jobId}/metadata.json`, `jobs/{jobId}/thumbnail.png`

## Output
`jobs/{jobId}/youtube-result.json` — video ID, URL, upload status, quota units consumed (upload costs 1600 units of the 10,000/day default quota — capped at ~6 uploads/day per project).
