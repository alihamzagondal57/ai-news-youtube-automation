# thumbnail-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions (after `render`)

Composes `jobs/{jobId}/thumbnail.png`: an AI-generated, topic-relevant
background image (FLUX.1 [schnell]), the job's own visual theme, and the
opening segment's on-screen headline — so the thumbnail reads as *this
video*, not a generic template.

## Why this is its own step, not part of metadata-generator

`docs/PIPELINE.md` originally pencilled `thumbnail.png` in as a
metadata-generator output. That doesn't work: metadata-generator runs
**before** `render` (step 6 vs step 7), so there's no keyframe to build from
yet — see that service's own README. thumbnail-generator runs as its own step
immediately **after** `render` instead (step 8 in the pipeline).

## Background: a 3-tier fallback, not a single source

`resolveBackground()` in `index.ts` tries, in order, and never fails the job
outright:

1. **AI-generated topic image** (`imageGen.ts`) — FLUX.1 [schnell] via
   Hugging Face's Inference Providers, from a prompt built off the script
   itself (`prompt.ts`). The primary path, and the reason this exists.
2. **A real frame from `render.mp4`** (`frame.ts`) — the previous design,
   kept as the fallback rather than deleted. Runs when AI generation is
   unavailable.
3. **The theme's own gradient** — `ThemedBackdrop`'s built-in fallback for
   empty media, kicks in automatically when neither of the above worked
   (e.g. running before `render.mp4` exists at all).

### Why AI generation is expected to fail sometimes — on purpose

This pipeline runs on Hugging Face's **free monthly credit only** ($0.10,
"subject to change" — covers roughly 30 images at FLUX.1-schnell's typical
per-provider cost, with zero margin for a retry), **with no payment method
configured**. That was an explicit choice, not an oversight — see
`docs/LICENSING.md` §3.6 for the full licensing/cost writeup. `imageGen.ts`
therefore treats "generation unavailable" (missing token, exhausted credit,
rate limit, provider error) as an ordinary, expected outcome: it never
throws, just reports why, and `index.ts` logs a `warn` and drops to tier 2.
If volume ever grows past what the free credit covers, adding a payment
method is a config change (same `HUGGINGFACE_API_TOKEN`, same code — HF just
starts billing it) — not a code change.

## Design: reuse the Remotion theme system, don't reimplement it

Rather than compositing text over an image with a second, parallel styling
system, this service renders a real Remotion still
([`remotion/src/compositions/Thumbnail.tsx`](../../remotion/src/compositions/Thumbnail.tsx))
through the same bundle → `selectComposition` → `renderStill` pipeline
render-server and the theme-catalog contact-sheet smoke test already use:

- The background is `ThemedBackdrop`, unmodified — the same component the
  actual video uses for segment backgrounds, scrim included. It doesn't care
  whether the image it's given came from FLUX, a video frame, or a stock
  clip; given nothing, its existing gradient-fallback branch (already
  written for segments with no sourced footage) produces a themed still.
- Colours and fonts come from `theme.palette` / `theme.fonts`
  (`services/shared/src/theme`) — the same tokens every themed video is built
  from. Whichever of the 18 themes a job's auto-rotation landed on
  (`jobs/{jobId}/theme.json`, sticky per job — see `docs/PIPELINE.md`) is what
  its thumbnail uses too.
- One new component,
  [`ThumbnailHeadline`](../../remotion/src/components/themed/ThumbnailHeadline.tsx),
  is a static (non-animated), oversized headline treatment — deliberately
  **one** layout rather than `ThemedLowerThird`'s six theme-specific variants:
  a thumbnail is judged at postage-stamp size in a results grid, where the
  palette and fonts are what actually reads, not a bespoke structural variant.

## AI image prompt (`prompt.ts`)

Built from the script so the background is genuinely relevant to *this*
video's subject, not a generic news backdrop:

- **Subject** comes from `script.segments[0].visualCue` — the opening
  segment's B-roll sourcing instruction (`scriptSegmentSchema.visualCue`,
  e.g. `"stock footage of the ECB building"`), stripped of its
  search-engine framing ("stock footage of", "b-roll of", …) since that
  phrasing was written for a stock-footage search box, not an image model.
  Falls back to the opening headline, then the script title, if `visualCue`
  is ever empty.
- **Not `insight`.** `visualCue` is concrete, purpose-built visual language;
  `insight` (`scriptSegmentSchema.insight`) is abstract analytical prose —
  "the specific original analysis this segment adds" — and feeding that
  directly to a fast, distilled (1–4 step) text-to-image model tends to
  produce muddier results than a short, concrete description. Considered
  using it and deliberately didn't.
- A fixed style suffix biases FLUX toward a usable photographic background:
  *"professional news photography, dramatic cinematic lighting, high
  detail, no text, no watermark, no logos"* — the no-text/watermark/logo
  part matters because `ThumbnailHeadline` composites its own text on top
  afterward, and diffusion models are notoriously bad at legible in-image
  text anyway.

No width/height is requested from the API: `ThemedBackdrop`'s
`<Img objectFit: "cover">` already scales/crops whatever size comes back into
the 1280×720 canvas, the same mechanism that already handles stock clips and
extracted video frames of arbitrary size.

## Headline text

`script.segments[0].headline` — the opening segment's short on-screen label
(`scriptSegmentSchema.headline`, e.g. `"ECB Holds Rates Steady"`), **not**
`script.title`. That's the same text already burned into the video's own
lower-third, which is what makes the thumbnail read as this video's actual
opening beat rather than a separately-authored blurb.

`headline.ts`'s `fitHeadline()` truncates an unusually long headline (90-char
cap, since the schema doesn't itself bound headline length) and steps the font
size down across four tiers so longer text stays legible without visibly
overflowing its plate; `ThumbnailHeadline` also line-clamps to 3 lines in CSS
as a rendering-time backstop.

## Representative frame (tier-2 fallback)

Rather than depending on `segment-timing.json` for a specific cut point,
`frame.ts` grabs a frame at a fixed fraction (12%) of `render.mp4`'s total
duration, clamped into `[1.5s, 8s]` — far enough in to skip the intro
stinger's fade-from-black opening, close enough to the start to be
representative, with no dependency on the segment timeline.

## Output (`jobs/{jobId}/thumbnail.png`)

1280×720 PNG — YouTube's recommended thumbnail resolution, matching the same
dimensions the theme catalog's own `ThemePreview` review stills already
render at.

## Tests

- `.smoke-test/test-thumbnail-headline.mts` — pure logic: headline
  truncation, the four font-size tiers, whitespace normalization, and
  `pickRepresentativeTimestamp`'s clamping across short/typical/very-long
  videos. No I/O; runs in a second.
- `.smoke-test/test-thumbnail-prompt.mts` — pure logic: `buildImagePrompt`'s
  search-framing-prefix stripping and the visualCue → headline → title
  fallback chain. No I/O; runs in a second.
- `.smoke-test/e2e-thumbnail-generator.mts` — full service through an
  in-process S3 store (s3rver), including a **real, live call to FLUX.1
  [schnell]** via Hugging Face (not mocked — same rigor as
  `e2e-metadata-generator.mts`'s real LLM call; this is safe to call for
  real, unlike a real YouTube upload) producing an actual generated
  thumbnail image, plus the tier-2 (video frame) and tier-3 (gradient)
  fallback paths and the theme-differentiation check from before this
  feature.
