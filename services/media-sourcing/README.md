# media-sourcing

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Reads each segment's `visualCue` from `script.json` and sources matching
**copyright-safe** stock footage from **both** Pexels and Pixabay, ranks the
merged pool by relevance/orientation/duration/resolution, and downloads the
best clip **plus 3–4 runner-up alternatives** per segment — for every segment,
including the opening and outro (render-server maps a clip onto every entry in
`script.segments`, not just the body).

## Why both providers, ranked together

Searching only one source caps quality at whatever that library happens to have
for a given topic. Every segment queries **Pexels and Pixabay concurrently**,
merges the results into one pool, and scores them with a single provider-neutral
function — the winner is whichever clip actually fits best, regardless of
source. `test-media-sourcing.mts` asserts real runs draw from both providers
across a manifest, not one silently dominating.

### Scoring (`src/rank.ts`)

| Signal | Weight | Why |
|---|---|---|
| Keyword relevance vs. tags | 0.55 | An off-topic clip is useless no matter how well-formed. |
| Duration ≥ segment length | 0.20 | **Higher than usual for stock footage.** The render composites each clip as a static full-segment background with no looping (`remotion/src/components/media/SegmentBackground.tsx`) — a clip shorter than its segment freezes on its last frame for the remainder, a visible defect, not a minor gap. *(Actually looping/holding short clips against long segments is tracked as a separate follow-up; this scoring just biases toward the least-bad outcome today.)* |
| Landscape orientation | 0.15 | Matches the 16:9 render frame; portrait needs more aggressive `objectFit: cover` cropping. |
| Resolution (≥1920px best) | 0.10 | Render composites at up to 4K via `objectFit: cover`; stock footage is rarely native 4K anyway (see `.smoke-test/smoke-test-4k.mts`), so 1080p is the real ceiling, not a compromise. |

`visualCue` is a sourcing **instruction** ("stock footage of the ECB building"),
not a search query — `src/query.ts` strips that framing before hitting either
API, since a tag-matching search engine gets *worse* recall from the literal
sentence. Pexels' `tags` field is frequently empty in practice (verified
live), so its page-URL slug (a human-written description) is folded in as a
second source of matchable text.

## Copyright-safety

Both licenses were verified in [`docs/LICENSING.md`](../../docs/LICENSING.md):
**free for commercial/monetized use, no attribution required.** Every stored
asset (primary and every alternative) carries a `MediaLicense` record —
`source`, a `licenseType` description, and the asset's own page URL as
permanent proof of sourcing. `licenseType` text is asserted to mention
"commercial" for both sources (`test-media-sourcing.mts`).

What the license does **not** clear — identifiable people, logos/trademarks,
buildings that carry separate property rights — is an editorial constraint on
*which* footage to prefer, not something a per-asset field can encode; see
`docs/LICENSING.md` §3.4 for the operating rules.

## Dedupe — same or near-identical clip never reused

Two layers, both in `src/dedupe.ts`:

- **Exact + near-duplicate, within a job:** never allowed to degrade. A
  candidate is skipped if it's the literal same asset (`provider:id`) already
  picked for an earlier segment in this job, or a **near-duplicate** — same
  uploader on the same provider with ≥60% tag overlap (`nearDuplicateTagOverlap`),
  the common case of one videographer uploading a burst of near-identical takes.
  Showing the same footage twice in one video is a visible defect, so this check
  is never relaxed even if it leaves a segment with fewer alternatives than
  requested.
- **Channel-wide, across jobs:** `state/media-usage.json` (same shape/location
  pattern as the theme/structure/voice rotation state) tracks recently-used
  asset keys. New selections avoid them — **but this degrades gracefully**: if
  honoring the exclusion would leave too few candidates for a segment, it's
  dropped rather than starving the segment of footage. Variety across videos
  matters less than a segment actually having usable footage.

`e2e-media-sourcing.mts` proves the channel-wide layer against two real, live
jobs: a second job querying the same subject as the first is steered away from
the first job's exact pick.

## Output (`jobs/{jobId}/media/`)

- `clip-{segmentId}.mp4` — the selected clip
- `clip-{segmentId}-alt{1..N}.mp4` — runner-up alternatives (`MEDIA_ALTERNATIVES_COUNT`, default 4), downloaded in full so the review dashboard's clip-swap can apply one instantly with no live re-query
- `media-manifest.json`:
```json
{
  "jobId": "uuid",
  "clips": [
    {
      "segmentId": 0,
      "file": "clip-0.mp4",
      "license": { "source": "pexels", "licenseType": "Pexels License — free for commercial use, no attribution required", "url": "https://www.pexels.com/video/.../" },
      "alternatives": [
        { "file": "clip-0-alt1.mp4", "license": { "source": "pixabay", "licenseType": "...", "url": "..." } }
      ]
    }
  ],
  "music": null,
  "sfx": []
}
```

`music`/`sfx` are deliberately out of scope for this pass — `buildInputProps`
already treats a null music track as silence (`musicSrc: ""`), so nothing
downstream breaks. Sourcing background music/SFX (the README stub's original
"Pixabay Audio API / YouTube Audio Library mirror" note) is a separate,
not-yet-verified concern — worth re-checking whether Pixabay actually exposes a
public audio-search API before building against it.

## Reliability

Both provider calls go through a shared retry/backoff (`src/providers/http.ts`):
429/5xx responses retry with exponential backoff (honoring `Retry-After` when
present); a genuine 4xx (bad key, malformed query) fails immediately. One
provider failing for a segment doesn't fail the job — the other's results are
used alone, with a warning logged. **Zero** candidates from *both* providers for
a segment throws: a segment with no footage at all is a hard failure, not
something to degrade past.

Every downloaded file is re-validated with `ffprobe` (`src/download.ts`) before
upload — confirms it's a real, decodable video with plausible dimensions/
duration, catching the rare case of a provider serving a broken rendition.

## Tests

- `.smoke-test/test-media-sourcing.mts` — pure logic: query building, the
  scoring function's weighting behavior, near-duplicate detection, dedupe's
  graceful-degrade-only-when-necessary rule, and license record shape. No
  network; runs in a second.
- `.smoke-test/e2e-media-sourcing.mts` — real Pexels + Pixabay API calls, real
  downloads, no mocking. Runs two live jobs through an in-process S3 store:
  the first sources footage for 3 segments and gets verified end-to-end
  (manifest shape, both-providers-used, no in-manifest duplicates, every
  downloaded clip ffprobed as valid, and the manifest accepted by
  render-server's **own** `buildInputProps` + `buildChunkPlan`); the second
  re-queries the first segment's exact subject to prove channel-wide dedupe
  steers it to a different pick. Requires `PEXELS_API_KEY` and
  `PIXABAY_API_KEY` in `.env`.
