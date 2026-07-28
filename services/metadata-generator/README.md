# metadata-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Generates everything YouTube needs to publish the video besides the file
itself: **SEO title, description, tags, hashtags, chapters**, and the
mandatory synthetic-content disclosure flag.

> **Scope note:** thumbnail generation (`sharp` compositing from a keyframe +
> template) is **not built in this pass** — it wasn't part of this service's
> immediate scope, `assets/templates/` doesn't exist yet, and there's no
> keyframe still available this early in the pipeline (metadata-generator runs
> before `render`, per `docs/PIPELINE.md`'s step order, so it can't extract one
> from `render.mp4`). `metadataSchema` has no `thumbnailPath` field either —
> this was never fully speced into the data contract. `youtube-uploader` will
> need a thumbnail source solved before it can run; noted here rather than
> silently dropped.

## Title / description / tags / hashtags — LLM-generated

One JSON-mode call, **reusing script-generator's own multi-provider chain**
(`@ai-news/script-generator`'s `providers/registry.js`) rather than
duplicating a second LLM client stack. This means:

- The same dev-only guardrail applies: whichever provider is active logs a
  loud warning if its terms are `productionUse: "prototype-only"` (GitHub
  Models' free tier today) — see [`docs/LICENSING.md`](../../docs/LICENSING.md) §3.2.
- Adding or repricing a provider is one change, in one place, for both services.

Unlike script-generator, this is a **single call**, not two-phase: metadata
fields are short structured copy, not long-form narration, so there's no
length-rationing problem to work around. A failed parse or an over-length
title retries the *same* provider with corrective feedback; a provider-level
error (network, auth, rate limit) falls through to the next one in the chain
— the same split script-generator's own `generate.ts` already learned it
needed (see that file's comments).

Grounding: the prompt gives the model the script's own title, segment
headlines, and a short excerpt of each segment's narration — nothing else. It
is told explicitly not to invent claims beyond what's there.

## Chapters — mechanically derived, never LLM-authored

Chapters are a direct transform of already-known data (`script.json`'s
headlines + `segment-timing.json`'s real start times), and YouTube's chapter
format is a *parsing rule*, not a creative-writing task — so `chapters.ts`
computes them in code, and the E2E test asserts the written `metadata.json`'s
`chapters` field is **byte-identical** to a fresh, independent call to
`buildChapters()`, proving the LLM never touches this field.

YouTube's real requirements, both enforced here:
- the first chapter must sit at exactly `0:00` (forced, even though voiceover's
  own timing invariants already guarantee the first segment starts at 0 — belt
  and suspenders);
- consecutive chapters must be **at least 10 seconds apart** or YouTube won't
  register the later one as its own marker — segments closer than that merge
  into the previous chapter here rather than being rejected;
- **at least 3 chapters** are required for YouTube to render any of them; a
  video with fewer than that still gets a timestamp block written into the
  description (harmless — just non-functional on YouTube's end), with a
  warning logged rather than a failure.

The literal timestamp block (`formatChapterBlock`) is appended to the
LLM-written description — that block, not a separate API field, is what
YouTube actually parses into clickable chapters.

## Field-length validation — YouTube's REAL limits, not the schema's

`services/shared`'s `metadataSchema` bounds `tags` by **array length**
(`.max(500)`), which is a generic sanity cap, not YouTube's actual rule:
YouTube limits tags by their **combined character length** (~500 characters
comma-joined) — a video could easily have 500 short tags well under that
budget, or fail with far fewer long ones. `validate.ts` enforces the real
constraint (`YOUTUBE_TAGS_MAX_COMBINED_CHARS = 480`, leaving slack against the
exact 500 YouTube applies server-side), trimming tags from the end
deterministically if the model's list runs over — a length overflow doesn't
need the model's judgment to fix, unlike a bad title, so it isn't a retry
trigger.

Title (100 chars) and description (5000 chars) are also enforced for real,
with the assembled description **prioritizing the chapter block over the
free-text body** if truncation is ever needed — the chapters feature is
mechanically load-bearing; a few sentences of trimmed description prose is not.

## Output (`jobs/{jobId}/metadata.json`)
```json
{
  "jobId": "uuid",
  "title": "string",
  "description": "string (includes the chapter timestamp block)",
  "tags": ["string"],
  "hashtags": ["string (no leading #)"],
  "chapters": [{ "title": "string", "startSeconds": 0 }],
  "containsSyntheticMedia": true
}
```

`containsSyntheticMedia` is always `true` — every video this pipeline makes is
AI-narrated and AI-scripted. `youtube-uploader` reads this field to set
YouTube's mandatory altered/synthetic-content disclosure on upload (see that
service's README); this is the only place the value is decided.

## Tests

- `.smoke-test/test-metadata-generator.mts` — pure logic: chapter derivation
  (well-spaced segments, the 10-second merge rule, the forced-0:00 rule,
  missing-timing rejection), timestamp formatting, and the deterministic
  assembly/truncation path against deliberately oversized fixture input. No
  network; runs in a second.
- `.smoke-test/e2e-metadata-generator.mts` — full service through an in-process
  S3 store (s3rver): uploads `script.json` + `segment-timing.json`, runs
  `runMetadataGeneration`, generates **live** through the configured provider
  chain, then reads `metadata.json` back and checks it against YouTube's real
  field limits, confirms the chapters are byte-identical to an independent
  `buildChapters()` call, and confirms the compliance flag is set.
