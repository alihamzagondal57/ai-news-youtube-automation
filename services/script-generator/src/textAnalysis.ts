/**
 * Deterministic text measures backing the original-insight enforcement.
 *
 * Kept separate from validate.ts so the thresholds can be unit-tested against
 * crafted inputs (verbatim copy, light paraphrase, genuine analysis) rather
 * than only against live model output.
 */

/** Words carrying no topical signal — excluded when measuring novelty. */
const STOPWORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","as","at",
  "be","because","been","before","being","below","between","both","but","by","can","did","do",
  "does","doing","down","during","each","few","for","from","further","had","has","have","having",
  "he","her","here","hers","him","his","how","i","if","in","into","is","it","its","itself","just",
  "me","more","most","my","no","nor","not","now","of","off","on","once","only","or","other","our",
  "out","over","own","s","same","she","should","so","some","such","t","than","that","the","their",
  "them","then","there","these","they","this","those","through","to","too","under","until","up",
  "very","was","we","were","what","when","where","which","while","who","whom","why","will","with",
  "you","your","been","also","said","says","would","could","may","might","new","one","two","after",
]);

/** Lowercased alphanumeric word tokens. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((t) => t.length > 0);
}

/** Content-bearing tokens only (stopwords and pure numbers removed). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t) && t.length > 2);
}

/** Contiguous n-token sequences. */
export function shingles(tokens: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

/**
 * Longest run of consecutive tokens shared with any source, in tokens.
 *
 * This is the verbatim-lifting measure: paraphrase breaks long runs, while
 * copy-paste leaves them intact regardless of how much surrounding text is
 * original. Reported in absolute tokens rather than as a ratio so a short
 * lifted clause inside a long segment is still caught.
 */
export function longestSharedRun(text: string, sources: readonly string[]): number {
  const textTokens = tokenize(text);
  if (textTokens.length === 0) return 0;

  let longest = 0;
  for (const source of sources) {
    const sourceTokens = tokenize(source);
    // Grow n while a shared run of that length still exists; stop at the first
    // length with no match, since longer runs are impossible past that point.
    for (let n = 1; n <= Math.min(textTokens.length, sourceTokens.length); n++) {
      const sourceSet = shingles(sourceTokens, n);
      const textSet = shingles(textTokens, n);
      let found = false;
      for (const s of textSet) {
        if (sourceSet.has(s)) {
          found = true;
          break;
        }
      }
      if (!found) break;
      // Must be a maximum across sources, not an assignment: a later source
      // that shares only a single common word would otherwise clobber a long
      // run already found against an earlier one.
      longest = Math.max(longest, n);
    }
  }
  return longest;
}

/**
 * Fraction of the text's content words that appear nowhere in the sources.
 *
 * Low novelty means the segment is built almost entirely from source
 * vocabulary — restatement rather than analysis — even when it has been
 * reworded enough to break long verbatim runs.
 */
export function novelContentRatio(text: string, sources: readonly string[]): number {
  const textTokens = contentTokens(text);
  if (textTokens.length === 0) return 0;
  const sourceVocab = new Set(sources.flatMap((s) => contentTokens(s)));
  const novel = textTokens.filter((t) => !sourceVocab.has(t));
  return novel.length / textTokens.length;
}

/**
 * Fraction of the claimed insight's content words that actually appear in the
 * spoken text.
 *
 * This is what stops the insight field from being a rubber stamp: a model can
 * assert "adds context about prior rate decisions" while writing none of it,
 * and only this check notices. It is a lexical overlap measure — it verifies
 * the declared analysis is present in the narration, not that the analysis is
 * correct or worthwhile.
 */
export function insightCoverage(insight: string, text: string): number {
  const insightTokens = contentTokens(insight);
  if (insightTokens.length === 0) return 0;
  const textVocab = new Set(contentTokens(text));
  const covered = insightTokens.filter((t) => textVocab.has(t));
  return covered.length / insightTokens.length;
}

/** Approximate spoken word count (what estSeconds and the runtime envelope are derived from). */
export function wordCount(text: string): number {
  return tokenize(text).length;
}
