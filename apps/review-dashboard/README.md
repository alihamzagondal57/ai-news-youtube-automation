# review-dashboard

**Runtime:** Node/TypeScript (Fastify API) + static PWA frontend · **Trigger:** run locally by the operator

The human review + approval gate between `render` and `youtube-uploader`. See
[`docs/REVIEW-DASHBOARD.md`](../../docs/REVIEW-DASHBOARD.md) for the full design
and rationale (why it's a local-first installable PWA, how the gate works, and the
targeted-re-render flow).

## Responsibilities
- List jobs parked at the review gate (`job.json.currentStep === "review"`).
- Show the rendered video scene-by-scene with per-segment chapter markers.
- Offer per-scene **clip swaps** (3–4 alternatives from `media-sourcing`),
  **voice** selection (Edge-TTS voice library, with preview), and **text overlay
  styling** (captions/ticker/lower-third), savable as reusable presets.
- Persist all choices to `jobs/{jobId}/review-state.json` (`reviewStateSchema`).
- Trigger targeted re-renders / re-gen and reflect the updated preview.
- On approve, set `review-state.json.status = "approved"` to release the job.

## Layout
```
apps/review-dashboard/
├── frontend/   PWA — review UI, manifest.json, service worker, app icons
└── server/     Fastify — R2 reads + presigned URLs, re-gen triggers, review-state writes
```

## Deployment
Local-first: runs on `localhost` (a PWA secure context, so it's installable on
desktop with nothing hosted). The same build is designed to deploy to Cloudflare
Pages + a Worker later for remote/mobile access, without code changes.

> Status: contract stub — not yet implemented. Built after the render pipeline
> per the build order in the root README.
