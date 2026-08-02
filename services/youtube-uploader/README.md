# youtube-uploader

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions (final pipeline step)

Uploads the rendered 4K video via **YouTube Data API v3** (resumable upload), then sets metadata (title/description/tags), uploads the custom thumbnail, adds it to the channel's uploads playlist, and optionally schedules publish time instead of publishing immediately.

Runs **only after the review gate approves the job** (`review-state.json.status === "approved"` — see [`docs/REVIEW-DASHBOARD.md`](../../docs/REVIEW-DASHBOARD.md)); it is never the step immediately after render.

Auth uses a long-lived OAuth2 refresh token (`YOUTUBE_REFRESH_TOKEN`) generated once via [`scripts/youtube-oauth-setup.ts`](scripts/youtube-oauth-setup.ts):

```bash
npm run youtube:oauth-setup --workspace=services/youtube-uploader
```

Interactive, run locally — **never in CI**. It opens a browser-driven consent
flow via a loopback redirect (`http://localhost:53682`), not the
`urn:ietf:wg:oauth:2.0:oob` out-of-band flow Google discontinued — the OAuth
client in Google Cloud must be of type **"Desktop app"**, which allows any
loopback redirect without pre-registering a port. Prints the refresh token to
paste into `.env` and into the `YOUTUBE_REFRESH_TOKEN` GitHub Actions secret.
See `docs/SETUP.md` §3.

The actual resumable-upload transport (chunked, retry-on-drop) is handled
inside `googleapis`/`google-auth-library` when `videos.insert` is given a
stream body — not hand-rolled here.

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

## Playlist

`videos.insert` already puts every upload into the channel's automatic
**"Uploads"** playlist — YouTube does this on its own, no extra API call.
`YOUTUBE_PLAYLIST_ID` (optional) additionally adds the video to one specific
*custom* playlist (e.g. a per-niche playlist); unset, this step is skipped
rather than erroring.

## Privacy / scheduling

Defaults to `YOUTUBE_PRIVACY_STATUS=private` — upload is a deliberate act in
this pipeline, not an automatic side effect of review approval; actually
publishing is a separate operator choice (flip the video to public/unlisted
in YouTube Studio, or set `YOUTUBE_PUBLISH_AT` to an RFC3339 timestamp before
running this step to have YouTube auto-publish it at that time — which
requires `privacyStatus: "private"` regardless of `YOUTUBE_PRIVACY_STATUS`,
enforced in `youtube.ts`).

## Quota accounting

`jobs/{jobId}/youtube-result.json`'s `quotaUnitsUsed` is the sum of each call's
*documented, fixed* Data API v3 cost (`src/quota.ts`) — not estimated:
`videos.insert` 1600, `thumbnails.set` 50, `playlistItems.insert` 50 (only if
`YOUTUBE_PLAYLIST_ID` is set). A default project's 10,000-unit daily quota
caps uploads at ~6/day on `videos.insert` cost alone. A partial failure (e.g.
the video uploads but setting the thumbnail then fails) still writes
`youtube-result.json` with `status: "failed"`, the real quota actually spent,
and an `error` message — that quota was consumed regardless of the failure,
so the record has to reflect it (`youtubeResultSchema` mirrors
`renderResultSchema`'s nullable-fields-on-failure shape for this reason).

## Input
`jobs/{jobId}/render.mp4`, `jobs/{jobId}/metadata.json`, `jobs/{jobId}/thumbnail.png`, `jobs/{jobId}/review-state.json` (must be `approved`)

## Output
`jobs/{jobId}/youtube-result.json` — video ID, URL, upload status, quota units consumed (upload costs 1600 units of the 10,000/day default quota — capped at ~6 uploads/day per project).

## Tests

- `.smoke-test/test-youtube-quota.mts` — pure logic: quota accounting
  (success, partial-failure, playlist-included/excluded) and the
  `publishAt`-forces-`private` rule. No I/O; runs in a second.
- `.smoke-test/e2e-youtube-uploader.mts` — full service through an in-process
  S3 store (s3rver): uploads real `render.mp4` / `thumbnail.png` fixtures +
  `metadata.json` + `review-state.json`, runs `runYoutubeUpload` with a
  **fake, request-recording YouTube client injected** in place of a real one,
  and asserts the real request bodies it built (title/description/tags,
  `containsSyntheticMedia`, `categoryId`, `privacyStatus`), the real quota
  math, and the real `youtube-result.json` written back — plus the
  review-gate rejection path (unapproved / missing `review-state.json`) and
  the partial-failure path (thumbnail call fails after the video upload
  succeeds). A fake client is the only honest way to test this: actually
  uploading to real YouTube in a test would spend real, non-refundable quota
  and publish a real video on a real channel.
