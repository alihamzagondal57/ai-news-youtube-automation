import type { Script } from "@ai-news/shared";

/**
 * Fixed style suffix biasing FLUX.1 [schnell] toward a usable news thumbnail
 * background rather than an abstract/artistic render: photorealistic (not
 * illustration/painting), dramatic enough to read at postage-stamp size, and
 * explicitly free of in-image text/watermarks/logos — the headline itself is
 * composited on top afterward (ThumbnailHeadline), so any text the model
 * renders on its own would just collide with, or duplicate, that layer.
 */
const STYLE_SUFFIX =
  "professional news photography, dramatic cinematic lighting, high detail, no text, no watermark, no logos";

/**
 * `visualCue` (scriptSegmentSchema) is already a concrete visual description
 * written for stock-footage SEARCH (e.g. "stock footage of the ECB
 * building") — the search-engine framing ("stock footage of", "b-roll of")
 * reads oddly to an image model, which wants the subject stated directly.
 */
const SEARCH_FRAMING_PREFIXES: RegExp[] = [
  /^stock footage of\s+/i,
  /^footage of\s+/i,
  /^b-roll of\s+/i,
  /^stock photo of\s+/i,
  /^photo of\s+/i,
];

function stripSearchFraming(text: string): string {
  for (const prefix of SEARCH_FRAMING_PREFIXES) {
    if (prefix.test(text)) return text.replace(prefix, "").trim();
  }
  return text;
}

/**
 * Derives a FLUX.1 [schnell] prompt from the script so the thumbnail
 * background is genuinely relevant to the video's subject, not generic.
 *
 * Subject comes from the opening segment's `visualCue`, not `insight`:
 * visualCue is already concrete, visual language purpose-built for exactly
 * this ("what should be shown"), while `insight` is abstract analytical prose
 * ("the specific original analysis this segment adds") — feeding that
 * directly to a fast, distilled text-to-image model tends to produce muddier
 * results than a short, concrete description. `headline` is used only as a
 * fallback for the rare case `visualCue` is empty.
 */
export function buildImagePrompt(script: Pick<Script, "title" | "segments">): string {
  const segment = script.segments[0];
  const rawVisualCue = segment?.visualCue?.trim();
  const rawHeadline = segment?.headline?.trim();
  const rawTitle = script.title?.trim();

  const subject = rawVisualCue ? stripSearchFraming(rawVisualCue) : rawHeadline || rawTitle;
  if (!subject) {
    throw new Error(
      "Could not derive an image prompt subject from script.json (segments[0].visualCue, headline, and title are all empty)",
    );
  }

  return `${subject}, ${STYLE_SUFFIX}`;
}
