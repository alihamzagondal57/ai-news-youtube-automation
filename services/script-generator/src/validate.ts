import type { ScriptStructure } from "@ai-news/shared/script-structure";
import { OPENING_WORDS, OUTRO_WORDS } from "@ai-news/shared/script-structure";
import type { GeneratedScript } from "./schema.js";
import { insightCoverage, longestSharedRun, novelContentRatio, wordCount } from "./textAnalysis.js";

/**
 * Thresholds for the compliance checks. Tuned against crafted fixtures in
 * test-script-validation.mts (verbatim copy, light paraphrase, genuine
 * analysis) rather than guessed — see that file for the calibration cases.
 */
export const THRESHOLDS = {
  /**
   * Longest run of consecutive tokens a segment may share with any source.
   * 8 tokens is roughly half a sentence: normal overlap on names, figures and
   * institutions stays well under it, while a lifted clause does not.
   */
  maxSharedRunTokens: 8,
  /**
   * Minimum fraction of a segment's content words that must appear nowhere in
   * the sources. Pure restatement scores near zero even after rewording.
   */
  minNovelContentRatio: 0.35,
  /** Minimum fraction of the declared insight's content words that must appear in the spoken text. */
  minInsightCoverage: 0.4,
  /** A declared insight shorter than this is a rubber stamp, not an analysis. */
  minInsightWords: 6,
  /** The insight itself must be original, not lifted — same run limit as the text. */
  maxInsightSharedRunTokens: 8,
} as const;

export interface ValidationIssue {
  /** Machine-readable so the retry prompt can address specific failures. */
  code:
    | "segment_count"
    | "segment_words"
    | "opening_words"
    | "outro_words"
    | "missing_insight"
    | "insight_too_short"
    | "insight_not_in_text"
    | "insight_lifted"
    | "verbatim_lifting"
    | "low_novelty"
    | "missing_field";
  segmentId?: number;
  message: string;
}

export interface ValidationInput {
  script: GeneratedScript;
  structure: ScriptStructure;
  /** The factual grounding the script was written from. */
  sourceSummaries: readonly string[];
}

/**
 * Checks a generated script against the structural brief it was written to and
 * against the original-insight requirement.
 *
 * What this can and cannot do, stated plainly: the structural checks are exact,
 * and the lifting/novelty checks reliably catch verbatim or lightly-reworded
 * restatement of the sources. None of it can judge whether the analysis is
 * *correct or worthwhile* — that is a human-review and LLM-judge question. What
 * it does guarantee is that a script which simply reads the news back cannot
 * pass, which is the specific monetization risk being defended against.
 */
export function validateScript(input: ValidationInput): ValidationIssue[] {
  const { script, structure, sourceSummaries } = input;
  const issues: ValidationIssue[] = [];
  const { segments } = structure;

  // ── Structural conformance to the brief ──────────────────────────────────
  if (script.segments.length < segments.minSegments || script.segments.length > segments.maxSegments) {
    issues.push({
      code: "segment_count",
      message: `Script has ${script.segments.length} body segments; the "${structure.name}" structure requires ${segments.minSegments}-${segments.maxSegments}.`,
    });
  }

  const openingWords = wordCount(script.opening);
  if (openingWords < OPENING_WORDS.min || openingWords > OPENING_WORDS.max) {
    issues.push({
      code: "opening_words",
      message: `Opening is ${openingWords} words; required ${OPENING_WORDS.min}-${OPENING_WORDS.max}.`,
    });
  }

  const outroWords = wordCount(script.outro);
  if (outroWords < OUTRO_WORDS.min || outroWords > OUTRO_WORDS.max) {
    issues.push({
      code: "outro_words",
      message: `Outro is ${outroWords} words; required ${OUTRO_WORDS.min}-${OUTRO_WORDS.max}.`,
    });
  }

  for (const segment of script.segments) {
    const label = `Segment ${segment.id}`;

    if (!segment.headline?.trim() || !segment.visualCue?.trim()) {
      issues.push({
        code: "missing_field",
        segmentId: segment.id,
        message: `${label} is missing a headline or visualCue.`,
      });
    }

    const words = wordCount(segment.text);
    if (words < segments.minWordsPerSegment || words > segments.maxWordsPerSegment) {
      issues.push({
        code: "segment_words",
        segmentId: segment.id,
        message: `${label} is ${words} spoken words; the "${structure.name}" structure requires ${segments.minWordsPerSegment}-${segments.maxWordsPerSegment}.`,
      });
    }

    // ── Original-insight enforcement ───────────────────────────────────────
    const insight = segment.insight?.trim() ?? "";
    if (!insight) {
      issues.push({
        code: "missing_insight",
        segmentId: segment.id,
        message: `${label} declares no insight. Every segment must add context, analysis, comparison, or implications beyond the sources.`,
      });
    } else {
      if (wordCount(insight) < THRESHOLDS.minInsightWords) {
        issues.push({
          code: "insight_too_short",
          segmentId: segment.id,
          message: `${label}'s insight is too short to be a real analysis (needs at least ${THRESHOLDS.minInsightWords} words).`,
        });
      }

      const insightRun = longestSharedRun(insight, sourceSummaries);
      if (insightRun > THRESHOLDS.maxInsightSharedRunTokens) {
        issues.push({
          code: "insight_lifted",
          segmentId: segment.id,
          message: `${label}'s insight repeats ${insightRun} consecutive words from a source — it restates rather than adds.`,
        });
      }

      const coverage = insightCoverage(insight, segment.text);
      if (coverage < THRESHOLDS.minInsightCoverage) {
        issues.push({
          code: "insight_not_in_text",
          segmentId: segment.id,
          message: `${label} claims an insight that does not appear in its spoken text (${Math.round(coverage * 100)}% of the insight's key terms are present; need ${Math.round(THRESHOLDS.minInsightCoverage * 100)}%). Write the analysis into the narration, don't just assert it.`,
        });
      }
    }

    // ── Derivativeness ─────────────────────────────────────────────────────
    const run = longestSharedRun(segment.text, sourceSummaries);
    if (run > THRESHOLDS.maxSharedRunTokens) {
      issues.push({
        code: "verbatim_lifting",
        segmentId: segment.id,
        message: `${label} reproduces ${run} consecutive words from a source. Rewrite in your own words — verbatim reading is what the inauthentic-content policy penalises.`,
      });
    }

    const novelty = novelContentRatio(segment.text, sourceSummaries);
    if (novelty < THRESHOLDS.minNovelContentRatio) {
      issues.push({
        code: "low_novelty",
        segmentId: segment.id,
        message: `${label} is ${Math.round((1 - novelty) * 100)}% source vocabulary — it restates the source rather than adding context or analysis.`,
      });
    }
  }

  return issues;
}

/** Renders issues into corrective instructions for a retry attempt. */
export function issuesToRetryInstructions(issues: readonly ValidationIssue[]): string {
  return [
    "Your previous attempt was rejected by automated validation. Fix every issue below and return the corrected script in the same JSON format.",
    "",
    ...issues.map((i) => `- ${i.message}`),
  ].join("\n");
}
