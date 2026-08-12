/**
 * Lightweight, mechanical fact-check: flags specific numbers (percentages,
 * counts, money, years) in generated prose that do not appear anywhere in the
 * trend's `sourceSummaries`, so a human reviewer sees a concrete warning
 * instead of trusting the script blindly.
 *
 * Deliberately NOT an LLM call — this is a numeric cross-reference, not a
 * truth check. It catches "the model wrote a specific figure the sources never
 * gave it" (the exact pattern measured against DeepSeek/Mistral/Groq output —
 * see docs/LICENSING.md §3.2a), not "the figure is factually wrong". A number
 * that IS in the sources is never flagged even if miscited; a number that
 * ISN'T is flagged even if it happens to be true. Advisory only — it doesn't
 * block generation or touch validate.ts's pass/fail gate.
 *
 * Broadcast scripts are written for spoken delivery, so numbers usually
 * appear as words ("ninety percent", "forty-five per cent"), not digits — a
 * digit-only regex would miss almost every real claim in this pipeline's
 * output. Both forms are parsed to their numeric value and compared on value,
 * not text, so "90 percent" and "ninety percent" are treated as the same claim.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000, trillion: 1_000_000_000_000,
};
/** Words that may CONTINUE an already-started number run (a bare scale word like "trillion" must not START one — see below). */
const RUN_CONTINUE = new Set([...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALES), "and"]);

/** Converts a run of number words ("forty five", "four hundred million") to its value, or null if unparseable. */
function wordsToNumber(tokens: readonly string[]): number | null {
  let total = 0;
  let current = 0;
  let matched = false;
  for (const w of tokens) {
    if (w === "and") continue;
    if (w in ONES) {
      current += ONES[w]!;
      matched = true;
    } else if (w in TENS) {
      current += TENS[w]!;
      matched = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      matched = true;
    } else if (w in SCALES) {
      total += (current || 1) * SCALES[w]!;
      current = 0;
      matched = true;
    } else {
      return null;
    }
  }
  return matched ? total + current : null;
}

export interface NumericClaim {
  /** The matched phrase, as words (for display to the reviewer). */
  raw: string;
  /** Parsed numeric value, used for source comparison. */
  value: number;
}

/** LLM output often uses typographic hyphen/dash variants ("forty‑five") instead of ASCII "-". */
function normalizeHyphens(text: string): string {
  return text.replace(/[‐-―]/g, "-");
}

/** Checks whether a "%"/"percent"/"per cent" marker immediately follows a match, given the text right after it. */
function isPercentContext(trailing: string): boolean {
  return /^\s*(%|percent|percentage|per[\s-]*cent)/i.test(trailing);
}

/**
 * Extracts every digit-form and word-form number from text, each paired with
 * its numeric value.
 *
 * Skips 0 and 1 always, and skips single-digit values (2-9) unless they're a
 * percentage ("three per cent") — bare small numbers are usually grammatical
 * ("two competing pressures", "nine-tenths" parsed as bare "nine") rather than
 * a citable statistic, and flagging them is pure noise for the reviewer.
 */
export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  const normalized = normalizeHyphens(text);

  // Digit-form: "90%", "2050", "3,200", "$1.85 trillion" (scale word folded in).
  const digitPattern = /\d[\d,]*(\.\d+)?(\s?(thousand|million|billion|trillion))?/gi;
  for (const match of normalized.matchAll(digitPattern)) {
    const numPart = match[0].match(/\d[\d,]*(\.\d+)?/)![0];
    let value = Number(numPart.replace(/,/g, ""));
    const scaleWord = match[3]?.toLowerCase();
    if (scaleWord) value *= SCALES[scaleWord]!;
    if (!Number.isFinite(value) || value <= 1) continue;
    if (value < 10 && !isPercentContext(normalized.slice(match.index! + match[0].length, match.index! + match[0].length + 15))) continue;
    claims.push({ raw: match[0].trim(), value });
  }

  // Word-form: a run must START with a ones/tens word (so a bare "trillion" left
  // over after a digit match above — e.g. from "$1.85 trillion" — never starts
  // its own spurious claim), but may continue through scale words and "and".
  const tokens = normalized.toLowerCase().match(/[a-z]+/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (!(t in ONES) && !(t in TENS)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && RUN_CONTINUE.has(tokens[j]!)) j++;
    const run = tokens.slice(i, j);
    const value = wordsToNumber(run);
    i = j;
    if (value === null || value <= 1) continue;
    const next1 = tokens[j];
    const next2 = tokens[j + 1];
    const isPercent = next1 === "percent" || next1 === "percentage" || (next1 === "per" && next2 === "cent");
    if (value < 10 && !isPercent) continue;
    claims.push({ raw: run.join(" "), value });
  }

  return claims;
}

/** Every numeric value mentioned anywhere in the sources, for one comparison set across all segments. */
export function sourceNumberIndex(sourceSummaries: readonly string[]): Set<number> {
  const values = new Set<number>();
  for (const summary of sourceSummaries) {
    for (const claim of extractNumericClaims(summary)) values.add(claim.value);
  }
  return values;
}

/**
 * Numeric claims in `text` whose value appears nowhere in `sourceNumbers`.
 * Returns human-readable warning strings, one per unverified claim (deduped
 * by phrase so a repeated figure isn't flagged twice in one segment).
 */
export function checkSegmentClaims(text: string, sourceNumbers: ReadonlySet<number>): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const claim of extractNumericClaims(text)) {
    if (sourceNumbers.has(claim.value)) continue;
    if (seen.has(claim.raw)) continue;
    seen.add(claim.raw);
    warnings.push(`"${claim.raw}" does not appear in any source summary — verify before publishing.`);
  }
  return warnings;
}
