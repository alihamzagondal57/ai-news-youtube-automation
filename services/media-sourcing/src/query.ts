/**
 * `visualCue` is a sourcing INSTRUCTION written for a human/LLM
 * ("stock footage of the ECB building at dusk"), not a search query. Stock
 * search engines (Pexels, Pixabay) match against tags/titles, not sentences, so
 * the leading "stock footage of" framing actively hurts recall — it's noise the
 * candidate's tags will never contain.
 */
const FRAMING_PREFIX =
  /^(aerial |wide |close[- ]up |drone |establishing |b-?roll )*(stock )?(footage|video|shot|clip|photo|image)s?\s+(of|showing|depicting)\s+/i;

/** Strips the sourcing-instruction framing, keeping the actual subject. */
export function buildSearchQuery(visualCue: string): string {
  const stripped = visualCue.trim().replace(FRAMING_PREFIX, "").replace(/^(the|a|an)\s+/i, "");
  // Cap length: an overlong query over-constrains a tag-matching search engine
  // and can legitimately return zero results where a shorter one succeeds.
  const words = stripped.split(/\s+/).filter(Boolean);
  return (words.length > 0 ? words : visualCue.split(/\s+/)).slice(0, 8).join(" ");
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "at", "on", "and", "or", "to", "for", "with",
  "its", "is", "are", "into", "over", "near", "during", "showing", "depicting",
]);

/** Significant keyword tokens used to score candidate relevance. */
export function extractKeywords(visualCue: string): string[] {
  return buildSearchQuery(visualCue)
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w-]/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
