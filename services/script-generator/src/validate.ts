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
    if (!segment.headline?.trim() || !segment.visualCue?.trim()) {
      issues.push({
        code: "missing_field",
        segmentId: segment.id,
        message: `Segment ${segment.id} is missing a headline or visualCue.`,
      });
    }
    issues.push(...segmentTextIssues(segment.id, segment.text, segment.insight, structure, sourceSummaries));
  }

  return issues;
}

/**
 * The per-segment prose checks (word budget, insight, derivativeness), shared
 * between the whole-script check and the per-segment retry loop of two-phase
 * generation. Keeping one implementation means the retry loop and the final
 * safety check can never disagree about what "passing" means.
 */
export function segmentTextIssues(
  segmentId: number,
  text: string,
  insight: string | undefined,
  structure: ScriptStructure,
  sourceSummaries: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const label = `Segment ${segmentId}`;
  const { segments } = structure;

  const words = wordCount(text);
  if (words < segments.minWordsPerSegment || words > segments.maxWordsPerSegment) {
    issues.push({
      code: "segment_words",
      segmentId,
      message: `${label} is ${words} spoken words; the "${structure.name}" structure requires ${segments.minWordsPerSegment}-${segments.maxWordsPerSegment}.`,
    });
  }

  const cleanInsight = insight?.trim() ?? "";
  if (!cleanInsight) {
    issues.push({
      code: "missing_insight",
      segmentId,
      message: `${label} declares no insight. Every segment must add context, analysis, comparison, or implications beyond the sources.`,
    });
  } else {
    if (wordCount(cleanInsight) < THRESHOLDS.minInsightWords) {
      issues.push({
        code: "insight_too_short",
        segmentId,
        message: `${label}'s insight is too short to be a real analysis (needs at least ${THRESHOLDS.minInsightWords} words).`,
      });
    }
    const insightRun = longestSharedRun(cleanInsight, sourceSummaries);
    if (insightRun > THRESHOLDS.maxInsightSharedRunTokens) {
      issues.push({
        code: "insight_lifted",
        segmentId,
        message: `${label}'s insight repeats ${insightRun} consecutive words from a source — it restates rather than adds.`,
      });
    }
    const coverage = insightCoverage(cleanInsight, text);
    if (coverage < THRESHOLDS.minInsightCoverage) {
      issues.push({
        code: "insight_not_in_text",
        segmentId,
        message: `${label} claims an insight that does not appear in its spoken text (${Math.round(coverage * 100)}% of the insight's key terms present; need ${Math.round(THRESHOLDS.minInsightCoverage * 100)}%). Write the analysis into the narration, don't just assert it.`,
      });
    }
  }

  const run = longestSharedRun(text, sourceSummaries);
  if (run > THRESHOLDS.maxSharedRunTokens) {
    issues.push({
      code: "verbatim_lifting",
      segmentId,
      message: `${label} reproduces ${run} consecutive words from a source. Rewrite in your own words — verbatim reading is what the inauthentic-content policy penalises.`,
    });
  }

  const novelty = novelContentRatio(text, sourceSummaries);
  if (novelty < THRESHOLDS.minNovelContentRatio) {
    issues.push({
      code: "low_novelty",
      segmentId,
      message: `${label} is ${Math.round((1 - novelty) * 100)}% source vocabulary — it restates the source rather than adding context or analysis.`,
    });
  }

  return issues;
}

/**
 * Phase-1 checks: segment count and the opening/outro word budgets. The plan
 * does not contain body prose, so it is not checked for it here — that happens
 * per segment in phase 2.
 */
export function validatePlan(
  plan: { opening: string; outro: string; segments: readonly unknown[] },
  structure: ScriptStructure,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { segments } = structure;

  if (plan.segments.length < segments.minSegments || plan.segments.length > segments.maxSegments) {
    issues.push({
      code: "segment_count",
      message: `Plan has ${plan.segments.length} segments; the "${structure.name}" structure requires ${segments.minSegments}-${segments.maxSegments}.`,
    });
  }
  const openingWords = wordCount(plan.opening);
  if (openingWords < OPENING_WORDS.min || openingWords > OPENING_WORDS.max) {
    issues.push({
      code: "opening_words",
      message: `Opening is ${openingWords} words; required ${OPENING_WORDS.min}-${OPENING_WORDS.max}.`,
    });
  }
  const outroWords = wordCount(plan.outro);
  if (outroWords < OUTRO_WORDS.min || outroWords > OUTRO_WORDS.max) {
    issues.push({
      code: "outro_words",
      message: `Outro is ${outroWords} words; required ${OUTRO_WORDS.min}-${OUTRO_WORDS.max}.`,
    });
  }
  return issues;
}

/** Renders issues into corrective instructions for a retry attempt. */
export function issuesToRetryInstructions(issues: readonly ValidationIssue[]): string {
  return [
    "Your previous attempt was rejected by automated validation. Fix every issue below and return the corrected output in the same format.",
    "",
    ...issues.map((i) => `- ${i.message}`),
  ].join("\n");
}
