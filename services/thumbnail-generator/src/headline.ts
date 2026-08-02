import type { Script } from "@ai-news/shared";

export interface ThumbnailHeadline {
  text: string;
  /** 1080p-reference px for the Thumbnail composition's headline treatment. */
  fontSizePx: number;
}

/**
 * Hard cap so an unusually long segment headline never overflows the plate
 * even at the smallest font tier — ThumbnailHeadline also line-clamps to 3
 * lines in CSS, but that's a rendering-time backstop, not a substitute for
 * picking a sane length up front.
 */
const MAX_HEADLINE_CHARS = 90;

/**
 * Font size steps downward as the headline gets longer, so a short punchy
 * headline reads huge (matches how real news thumbnails set type) while a
 * long one still fits without visibly overflowing its plate. Ordered
 * ascending by maxChars; the first tier the text fits under wins.
 */
const FONT_SIZE_TIERS: ReadonlyArray<{ maxChars: number; fontSizePx: number }> = [
  { maxChars: 28, fontSizePx: 112 },
  { maxChars: 42, fontSizePx: 96 },
  { maxChars: 60, fontSizePx: 80 },
  { maxChars: 90, fontSizePx: 68 },
];

/**
 * Thumbnail headline is `script.segments[0].headline` — the opening segment's
 * short on-screen label (scriptSegmentSchema.headline), the SAME text already
 * burned into the video's own lower-third. Using it here (rather than
 * script.title, which is a longer editorial title) is what makes the
 * thumbnail read as "this video," not a generic recolour.
 */
export function deriveThumbnailHeadline(script: Pick<Script, "segments">): ThumbnailHeadline {
  const raw = script.segments[0]?.headline?.trim();
  if (!raw) {
    throw new Error("script.segments[0].headline is empty — cannot derive a thumbnail headline");
  }
  return fitHeadline(raw);
}

/** Pure text-fitting logic, split out from deriveThumbnailHeadline so it's testable without a Script fixture. */
export function fitHeadline(raw: string): ThumbnailHeadline {
  const normalized = raw.trim().replace(/\s+/g, " ");
  const text =
    normalized.length > MAX_HEADLINE_CHARS
      ? `${normalized.slice(0, MAX_HEADLINE_CHARS - 1).trimEnd()}…`
      : normalized;
  const tier = FONT_SIZE_TIERS.find((t) => text.length <= t.maxChars) ?? FONT_SIZE_TIERS[FONT_SIZE_TIERS.length - 1];
  return { text, fontSizePx: tier.fontSizePx };
}
