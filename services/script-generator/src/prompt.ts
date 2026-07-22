import type { Trend } from "@ai-news/shared";
import type { ScriptStructure } from "@ai-news/shared/script-structure";
import {
  OPENING_WORDS,
  OUTRO_WORDS,
  analysisDirective,
  openingDirective,
  outroDirective,
  throughlineDirective,
} from "@ai-news/shared/script-structure";
import { INSIGHT_MARKER } from "./schema.js";
import type { PlanSegment } from "./schema.js";
import { THRESHOLDS } from "./validate.js";

/** Shared grounding + insight rules, embedded in both phase prompts. */
const CORE_RULES = [
  "GROUNDING: Every factual claim must trace to the supplied source summaries. Never invent figures, quotes, dates, or events.",
  "ORIGINAL INSIGHT: Go beyond restating the sources — add context, analysis, comparison to prior events, or implications for the audience. Original *framing and analysis*, never invented facts.",
  "TONE: Neutral, EU-audience-appropriate. No unverified speculation presented as fact.",
  "SPOKEN COPY: Written to be read aloud by a synthetic voice. No markdown, no bullet points, no parentheticals, no stage directions. Expand abbreviations on first use.",
].join("\n");

function sourcesBlock(sourceSummaries: readonly string[]): string {
  return ["# Source summaries (the ONLY permitted basis for factual claims)", ...sourceSummaries.map((s, i) => `[${i + 1}] ${s}`)].join("\n");
}

// ── Phase 1: the plan ────────────────────────────────────────────────────────

export const PLAN_SYSTEM_PROMPT = [
  "You are the story editor for a European-audience broadcast news channel.",
  "You plan a video: its title, its spoken opening and closing lines, and a skeleton of body segments — but you do NOT write the body prose (a separate writer does that, one segment at a time).",
  "",
  CORE_RULES,
  "",
  "Return a single JSON object and nothing else:",
  "{",
  '  "title": "SEO-friendly video title",',
  '  "opening": "the spoken opening hook (full text)",',
  '  "segments": [',
  '    { "headline": "On-Screen Label", "visualCue": "stock footage of ...", "focus": "one sentence naming exactly what THIS segment covers" }',
  "  ],",
  '  "outro": "the spoken closing (full text)"',
  "}",
  "",
  "Each segment's `focus` must be DISTINCT and must not overlap another segment's ground — the writer will develop each into a full passage, so the foci together must tile the whole story without repetition.",
].join("\n");

export interface PlanPromptInput {
  trend: Pick<Trend, "topic" | "angle" | "sourceSummaries">;
  structure: ScriptStructure;
  retryInstructions?: string;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const { trend, structure, retryInstructions } = input;
  const { segments } = structure;

  const parts = [
    `# Topic`,
    trend.topic,
    "",
    `# Angle`,
    trend.angle,
    "",
    sourcesBlock(trend.sourceSummaries),
    "",
    `# Plan requirements: "${structure.name}"`,
    ``,
    `OPENING (${OPENING_WORDS.min}-${OPENING_WORDS.max} spoken words): ${openingDirective(structure)}`,
    ``,
    `BODY: plan exactly ${segments.minSegments}-${segments.maxSegments} segments. Throughline: ${throughlineDirective(structure)}`,
    `Give each segment a distinct focus so they tile the story in that order.`,
    ``,
    `ANALYSIS PLACEMENT (guides how you assign foci): ${analysisDirective(structure)}`,
    ``,
    `OUTRO (${OUTRO_WORDS.min}-${OUTRO_WORDS.max} spoken words): ${outroDirective(structure)}`,
  ];

  if (retryInstructions) {
    parts.push("", "# Correction required", retryInstructions);
  }
  return parts.join("\n");
}

// ── Phase 2: one segment's prose ─────────────────────────────────────────────

export const SEGMENT_SYSTEM_PROMPT = [
  "You are a broadcast news writer. You write ONE segment of a video script — a single, fully-developed spoken passage — at a time.",
  "",
  CORE_RULES,
  "",
  "LENGTH IS A STRICT BUDGET — a hard floor AND a hard ceiling, and BOTH are enforced. Write a substantial, developed spoken passage: state the point, give context, compare to prior events where the sources allow, and spell out the concrete implication. But you are writing to a word budget: land INSIDE the range you are given. Going under the floor is rejected; going over the ceiling is equally rejected. If you have more material than fits, be more selective — do not exceed the ceiling. Count your words and stop when the point is developed to the target, not when you run out of things to say.",
  "",
  "Your output is checked mechanically and rejected if it:",
  `- reproduces more than ${THRESHOLDS.maxSharedRunTokens} consecutive words from a source;`,
  `- is built almost entirely from source vocabulary (under ${Math.round(THRESHOLDS.minNovelContentRatio * 100)}% new content words);`,
  "- falls outside the required word count;",
  "- omits the insight line, or states an insight not actually present in the passage.",
  "",
  "OUTPUT FORMAT — plain text, no JSON, no markdown:",
  "First the passage itself. Then, on its own line, exactly:",
  INSIGHT_MARKER,
  "followed by one sentence naming the specific original analysis this passage adds (context / comparison / implication).",
  "CRITICAL: write that sentence using the SAME concrete words and phrases that appear in your passage above — it should read like a one-sentence extract of the analysis you already wrote, not a fresh paraphrase in new vocabulary. If your passage discusses 'variable-rate households' and 'repayment relief', the insight sentence must use those exact terms. An insight whose key words do not appear in the passage is rejected.",
].join("\n");

export interface SegmentPromptInput {
  trend: Pick<Trend, "topic" | "angle" | "sourceSummaries">;
  structure: ScriptStructure;
  segment: PlanSegment;
  /** 1-based position, for "second of five" framing. */
  index: number;
  total: number;
  retryInstructions?: string;
}

export function buildSegmentPrompt(input: SegmentPromptInput): string {
  const { trend, structure, segment, index, total, retryInstructions } = input;
  const { minWordsPerSegment: min, maxWordsPerSegment: max } = structure.segments;
  const target = Math.round((min + max) / 2);

  const parts = [
    `# Video topic (context only — write about the focus below)`,
    `${trend.topic} — ${trend.angle}`,
    "",
    sourcesBlock(trend.sourceSummaries),
    "",
    `# This segment (${index} of ${total})`,
    `On-screen headline: ${segment.headline}`,
    `Cover exactly this and nothing else: ${segment.focus}`,
    "",
    `# Word budget (STRICT — both ends enforced)`,
    `Target: ${target} words. Acceptable range: ${min}-${max} spoken words.`,
    `Under ${min} is rejected. Over ${max} is rejected. Aim for the middle (${target}) to leave margin on both sides. A developed passage of ~${target} words is the goal — not the longest passage you can write.`,
  ];

  if (retryInstructions) {
    parts.push("", "# Correction required", retryInstructions);
  }
  return parts.join("\n");
}
