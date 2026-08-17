# review-dashboard

**Runtime:** Node/TypeScript (Fastify API) + static PWA frontend · **Trigger:** run locally by the operator

The human review + approval gate between `render` and `youtube-uploader`. See
[`docs/REVIEW-DASHBOARD.md`](../../docs/REVIEW-DASHBOARD.md) for the full design
and rationale (why it's a local-first installable PWA, how the gate works, and the
targeted-re-render flow).

## Responsibilities
- List jobs parked at the review gate (`job.json.currentStep === "review"`).
- Show the rendered video scene-by-scene with per-segment chapter markers.
- Offer per-scene **clip swaps** (from `media-sourcing`'s own pre-fetched
  alternatives), **voice** selection (Kokoro + SAPI-fallback voice library,
  with preview), and **text overlay styling** (captions/ticker/lower-third).
- Persist all choices to `jobs/{jobId}/review-state.json` (`reviewStateSchema`).
- On approve, set `review-state.json.status = "approved"` — the single event
  `youtube-uploader` gates on before it will run.
- Surface **fact-check warnings** per segment (script-generator's
  `factCheck.ts` output, carried on `script.json`'s `segment.factCheckWarnings`)
  — an amber banner on any flagged segment plus a summary count on the
  Decision panel. Mechanical, not an LLM call: a number/percentage/year in the
  segment that never appears in the trend's `sourceSummaries`. Advisory only —
  it does not block approval, it just makes an unverified claim visible before
  a human clicks Approve.

## Layout
```
apps/review-dashboard/
├── frontend/   PWA — review UI, manifest.json, service worker, app icons
└── server/     Fastify — R2 reads + presigned URLs, review-state read/write
```

## Running locally
```bash
# terminal 1 — API (reads/writes R2 via @ai-news/shared's JobStore)
npm run dev --workspace=@ai-news/review-dashboard-server   # http://127.0.0.1:4000

# terminal 2 — PWA (dev server proxies /api to the port above)
npm run dev --workspace=@ai-news/review-dashboard-frontend # http://127.0.0.1:5173
```
Requires the same R2 env vars as every other service (`.env` — see
`.env.example`). `localhost` is a PWA "secure context", so Chrome/Edge show the
**Install** button once the built app (`npm run build` in `frontend/`) is served.

## API (server)
| Route | What it does |
|---|---|
| `GET /api/jobs` | Jobs currently parked at the review gate |
| `GET /api/jobs/:jobId` | Full detail: segments, current/alternative clips (presigned), theme/voice, `render.mp4`/`thumbnail.png` (presigned), `review-state.json` |
| `GET /api/themes` | The 18-theme catalog (swatch colours, for the theme picker) |
| `GET /api/voices` | The voice library, flagging which have a preview sample |
| `GET /api/voices/:voiceId/sample` | Streams that voice's sample `.wav` |
| `PATCH /api/jobs/:jobId/review-state` | Set `voiceId`/`themeId`/`structureId`/`stylePresetId`/`style` |
| `PUT /api/jobs/:jobId/clip-override` | `{segmentId, file}` — swap a segment's clip for one of its own alternatives |
| `DELETE /api/jobs/:jobId/clip-override/:segmentId` | Revert a clip swap |
| `POST /api/jobs/:jobId/approve` | Sets `status = "approved"` — releases the job |
| `POST /api/jobs/:jobId/reject` | Sets `status = "rejected"` |

## What actually applies an override
Setting a clip/style/theme override here writes `review-state.json`; a
**re-render** is what makes it visible in `render.mp4` (this dashboard doesn't
trigger one itself — re-run `render-server`'s `/render`, targeted for a clip
swap via `changedSegmentIds`, full for a voice/theme change). `render-server`'s
`reviewOverrides.ts` + `buildInputProps.ts` read and apply `clipOverrides`/
`style`; theme resolution (`themeSelection.ts`) already did. Voice changes are
applied further upstream, by `voiceover` itself re-running.

## Deployment
Local-first: runs on `localhost` (a PWA secure context, so it's installable on
desktop with nothing hosted). The same build is designed to deploy to Cloudflare
Pages + a Worker later for remote/mobile access, without code changes.

## Tests
- `.smoke-test/test-render-overrides.mts` — proves render-server actually
  applies a clip-swap and a style override (real rendered pixels, not just
  prop plumbing) — the mechanism this dashboard's edits rely on.
- `.smoke-test/e2e-review-dashboard.mts` — boots the real Fastify server
  against an in-process S3 store, exercises the full API (list, detail, clip
  override, style patch, theme patch), and proves **approve genuinely
  unblocks `youtube-uploader`**: the real `runYoutubeUpload` throws before
  approval and succeeds after, with no mocking of the approval gate itself.
