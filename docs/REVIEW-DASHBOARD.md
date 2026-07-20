# Review dashboard & approval gate

The pipeline does **not** auto-publish. After a video renders, it parks at a
human review gate. A lightweight web dashboard lets the operator watch the video
scene-by-scene, make targeted changes (swap a clip, change the voice, restyle the
text overlays), and only then approve it for upload. Approval is the single event
that releases a job to `youtube-uploader`.

This exists for two reasons: quality control (catch a bad clip or an awkward line
before it's public) and the fact that the modular artifact layout
([`docs/PIPELINE.md`](PIPELINE.md)) already makes every stage's output
individually editable — the review layer is just a UI over that.

## Where it lives

**A local-first web app** — a new workspace, `apps/review-dashboard/`, that runs
on the operator's own machine and is an **installable PWA**. Not an n8n form, not
a hosted SaaS.

Why local-first:

- **Zero hosting, zero new accounts.** `localhost` is a PWA "secure context", so
  Chrome/Edge show the **Install** prompt and the app runs standalone (no browser
  chrome, its own icon) with nothing deployed. This matches the project's
  cost-conscious posture — no extra service to pay for or secure right now.
- **It already needs a small backend anyway.** The dashboard has to read job
  artifacts from R2, hand the browser short-lived presigned URLs for the preview
  video and candidate clips, write `review-state.json`, and trigger re-gen
  actions. That's a small Node/Fastify server co-located with the frontend in the
  same workspace.
- **It's portable by design.** The frontend is static and the backend is a thin
  API, so the exact same build later deploys to **Cloudflare Pages + a Worker**
  (which sit natively next to R2) if remote/mobile access is ever wanted — without
  code changes. Local-first now, hostable later.

```
apps/review-dashboard/
├── frontend/     PWA: scene-by-scene review UI, manifest.json, service worker, icons
└── server/       Fastify API: R2 reads + presigned URLs, triggers re-gen, writes review-state.json
```

### PWA specifics

- `manifest.json` with `display: "standalone"`, a maskable app icon (192/512px),
  theme + background color matching the channel branding.
- A service worker that precaches the app shell so the dashboard opens instantly
  and survives a flaky connection. Job data and media are **network-first** (never
  cache stale previews); the app shell is **cache-first**.
- Installable on Windows desktop via the Chrome/Edge address-bar Install button;
  the same manifest covers mobile "Add to home screen" if the app is later hosted.

## The gate in the pipeline

```
render  ──▶  review (parked)  ──▶  youtube-uploader
                  │
        review dashboard reads/writes
        jobs/{jobId}/review-state.json
```

1. When render finishes, n8n sets `job.json.currentStep = "review"` and **stops**
   — it does not proceed to upload.
2. The dashboard lists every job whose `currentStep` is `review`. Opening one
   reads `script.json`, `segment-timing.json`, `media-manifest.json`, the rendered
   `render.mp4`, and any existing `review-state.json`.
3. The operator reviews and edits (below). Edits write `review-state.json` and may
   enqueue a targeted re-gen; the preview updates when the re-render lands.
4. On **Approve**, the dashboard sets `review-state.json.status = "approved"`.
   n8n is waiting on that (webhook resume or poll) and releases the job to
   `youtube-uploader`.

`review-state.json` is the typed contract for all of this
(`reviewStateSchema` in `services/shared`). It carries the review status, the
selected voice, the chosen text style (or a reference to a saved preset), and the
per-segment clip overrides.

## Review & edit features

### 1. Scene-by-scene review
The rendered video is shown with per-segment chapter markers derived from
`segment-timing.json`, so the reviewer can jump straight to any scene and see its
script text, assigned clip, and the voice used.

### 2. Swap a clip (targeted re-render)
For any segment, "Swap clip" calls `media-sourcing` in **alternatives mode** with
that segment's `visualCue` keywords, which returns 3–4 candidate stock clips
(preview thumbnails). The operator picks one; the choice is recorded as a
`clipOverride` in `review-state.json` and `media-manifest.json` is updated for
that segment only. This triggers a **targeted re-render**: render-server
re-renders just the affected segment's frame range and stitches it back into the
existing `render.mp4` (per-segment intermediate renders are cached under
`jobs/{jobId}/renders/segment-{id}.mp4`), rather than re-encoding the whole video.
See "Targeted re-render" in [`docs/PIPELINE.md`](PIPELINE.md).

### 3. Voice library
A curated set of Edge-TTS voices (multiple male/female voices and accents — e.g.
`en-GB`, `en-US`, `en-IE`). The operator previews a short sample and selects a
voice per-video, or sets a default via a saved preset. Because changing the voice
changes the narration audio and therefore **all** segment timings, a voice change
re-runs `voiceover` → `caption-sync` → a **full** re-render (not a targeted one).
The selected voice is stored as `review-state.json.voiceId`.

### 4. Theme override
Each video is auto-assigned one of 18 visual themes, avoiding recent picks so
consecutive uploads don't look like one template re-run. The dashboard shows the
assigned theme and lets the operator pick a different one, written to
`review-state.json.themeId`. Because a theme changes the palette, typography,
ticker, lower-third, transitions and motion graphics all at once, switching it
requires a **full** re-render — not a targeted one. Selection and stickiness are
described in [`docs/PIPELINE.md`](PIPELINE.md).

### 5. Text overlay styling
Caption font/size/color, ticker style, and lower-third style are user-configurable
(`renderStyleSchema`), applied at render time by the Remotion composition. Any
unset field falls back to the channel default, so the default look is unchanged.
Styling can be set per-video or saved as a named **preset** (`stylePresetSchema`,
stored at `presets/{presetId}.json`) and reused across videos. A style-only change
needs just a re-render — no upstream re-gen.

## What this requires elsewhere (build-order notes)

- **render-server**: targeted re-render is **implemented** — `changedSegmentIds`
  on the render request, a per-segment chunk cache in `jobs/{jobId}/renders/`,
  and an ffmpeg stitch step (see "Targeted re-render" in
  [`docs/PIPELINE.md`](PIPELINE.md)). Still to do: reading `review-state.json` to
  apply `voiceId`/`style`/`clipOverrides` instead of taking them as call args.
- **The Remotion composition** must accept the style props from `renderStyleSchema`
  and fall back to channel defaults.
- **media-sourcing** gains an "alternatives" mode returning N candidates for a
  single `visualCue` instead of committing one.
- **n8n** gains the park-and-wait-for-approval gate between render and upload.

These are captured here so the services can be built to this contract; the
dashboard itself comes after the render pipeline in the build order.
