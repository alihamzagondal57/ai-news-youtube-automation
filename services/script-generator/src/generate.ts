import type { Logger, Script, Trend } from "@ai-news/shared";
import type { ScriptStructure } from "@ai-news/shared/script-structure";
import { buildPlanPrompt, buildPlanSystemPrompt, buildSegmentPrompt, buildSegmentSystemPrompt } from "./prompt.js";
import { extractJson, parseSegmentProse, planSchema, type GeneratedScript, type Plan } from "./schema.js";
import type { CompletionResult, ScriptProvider } from "./providers/types.js";
import {
  issuesToRetryInstructions,
  segmentTextIssues,
  validatePlan,
  validateScript,
  type ValidationIssue,
} from "./validate.js";
import { wordCount } from "./textAnalysis.js";

/** Spoken words per minute, used to derive estSeconds from generated text. */
const WORDS_PER_MINUTE = 150;

export interface GenerateOptions {
  jobId: string;
  trend: Pick<Trend, "topic" | "angle" | "sourceSummaries">;
  structure: ScriptStructure;
  /** Tried in order; a later provider is used only if every earlier one fails. */
  providers: readonly ScriptProvider[];
  /** Corrective retries per phase, per provider. */
  maxAttempts?: number;
  logger: Logger;
}

export interface GenerateResult {
  script: Script;
  providerName: string;
  model: string;
  /** Total provider calls made (plan + segments + retries) on the winning provider. */
  calls: number;
  discardedIssues: ValidationIssue[][];
}

/**
 * Generates a script two-phase and does not return one that fails validation.
 *
 * Phase 1 asks one provider for a plan (title, opening, outro, and a per-segment
 * skeleton). Phase 2 asks the same provider for each segment's prose in its own
 * focused call. This exists because a single all-segments-in-one-JSON call makes
 * every model ration its output budget and under-write each segment by ~2x;
 * asked for one passage at a time, the same model writes to length. Each phase
 * is validated and retried against the identical bar; a provider that cannot
 * produce a passing script falls through to the next, and if the chain is
 * exhausted this throws rather than returning something that failed the checks.
 */
export async function generateScript(options: GenerateOptions): Promise<GenerateResult> {
  const { jobId, trend, structure, providers, logger } = options;
  const maxAttempts = options.maxAttempts ?? 3;

  if (providers.length === 0) {
    throw new Error("No script providers configured");
  }

  const discardedIssues: ValidationIssue[][] = [];
  const providerErrors: string[] = [];

  for (const provider of providers) {
    let calls = 0;
    const track = async (fn: () => Promise<CompletionResult>): Promise<CompletionResult> => {
      calls++;
      return fn();
    };

    try {
      // ── Phase 1: plan ──────────────────────────────────────────────────────
      const plan = await generatePlan(provider, trend, structure, maxAttempts, jobId, logger, track, discardedIssues);

      // ── Phase 2: one prose call per planned segment ────────────────────────
      const segments: GeneratedScript["segments"] = [];
      for (let i = 0; i < plan.segments.length; i++) {
        const prose = await generateSegment(
          provider,
          trend,
          structure,
          plan.segments[i],
          i,
          plan.segments.length,
          maxAttempts,
          jobId,
          logger,
          track,
          discardedIssues,
        );
        segments.push({
          id: i,
          text: prose.text,
          insight: prose.insight,
          headline: plan.segments[i].headline,
          visualCue: plan.segments[i].visualCue,
        });
      }

      const generated: GeneratedScript = { title: plan.title, opening: plan.opening, outro: plan.outro, segments };

      // Final belt-and-suspenders: the whole assembled script must pass, not
      // just each piece in isolation. A phase that passed but drifted from the
      // structure would be caught here before anything is returned.
      const finalIssues = validateScript({ script: generated, structure, sourceSummaries: trend.sourceSummaries });
      if (finalIssues.length > 0) {
        discardedIssues.push(finalIssues);
        throw new Error(`assembled script failed final validation: ${finalIssues.map((i) => i.code).join(", ")}`);
      }

      logger.info(
        { jobId, provider: provider.name, calls, segments: segments.length },
        "Script generated and validated (two-phase)",
      );
      return {
        script: assembleScript(jobId, generated, structure),
        providerName: provider.name,
        model: plan.model,
        calls,
        discardedIssues,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      providerErrors.push(`${provider.name}: ${message}`);
      logger.warn({ jobId, provider: provider.name, err }, "Provider failed; trying next provider");
    }
  }

  throw new Error(
    `Script generation failed across ${providers.length} provider(s). ` +
      (providerErrors.length > 0 ? `Errors: ${providerErrors.join(" | ")}. ` : "") +
      (discardedIssues.length > 0
        ? `Last issues: ${discardedIssues[discardedIssues.length - 1].map((i) => i.message).join(" | ")}`
        : ""),
  );
}

async function generatePlan(
  provider: ScriptProvider,
  trend: GenerateOptions["trend"],
  structure: ScriptStructure,
  maxAttempts: number,
  jobId: string,
  logger: Logger,
  track: (fn: () => Promise<CompletionResult>) => Promise<CompletionResult>,
  discardedIssues: ValidationIssue[][],
): Promise<Plan & { model: string }> {
  let retryInstructions: string | undefined;
  let lastError = "plan generation exhausted retries";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await track(() =>
      provider.complete({
        system: buildPlanSystemPrompt(trend.sourceSummaries.length > 0),
        user: buildPlanPrompt({ trend, structure, retryInstructions }),
        format: "json",
      }),
    );

    const parsed = planSchema.safeParse(safeJson(completion.text));
    if (!parsed.success) {
      retryInstructions = `Your previous plan was not valid JSON in the required shape: ${parsed.error?.issues
        ?.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}. Return the corrected plan.`;
      lastError = "plan failed schema";
      logger.warn({ jobId, provider: provider.name, attempt }, "Plan failed schema parse");
      continue;
    }

    const issues = validatePlan(parsed.data, structure);
    if (issues.length > 0) {
      discardedIssues.push(issues);
      retryInstructions = issuesToRetryInstructions(issues);
      lastError = `plan issues: ${issues.map((i) => i.code).join(", ")}`;
      logger.warn({ jobId, provider: provider.name, attempt, codes: issues.map((i) => i.code) }, "Plan failed validation");
      continue;
    }

    return { ...parsed.data, model: completion.model };
  }
  throw new Error(lastError);
}

async function generateSegment(
  provider: ScriptProvider,
  trend: GenerateOptions["trend"],
  structure: ScriptStructure,
  segment: Plan["segments"][number],
  index: number,
  total: number,
  maxAttempts: number,
  jobId: string,
  logger: Logger,
  track: (fn: () => Promise<CompletionResult>) => Promise<CompletionResult>,
  discardedIssues: ValidationIssue[][],
): Promise<{ text: string; insight: string }> {
  let retryInstructions: string | undefined;
  let lastError = `segment ${index} exhausted retries`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await track(() =>
      provider.complete({
        system: buildSegmentSystemPrompt(trend.sourceSummaries.length > 0),
        user: buildSegmentPrompt({ trend, structure, segment, index: index + 1, total, retryInstructions }),
        format: "text",
      }),
    );

    const prose = parseSegmentProse(completion.text);
    const issues = segmentTextIssues(index, prose.text, prose.insight, structure, trend.sourceSummaries);
    if (issues.length > 0) {
      discardedIssues.push(issues);
      retryInstructions = issuesToRetryInstructions(issues);
      lastError = `segment ${index} issues: ${issues.map((i) => i.code).join(", ")}`;
      logger.warn(
        { jobId, provider: provider.name, segment: index, attempt, codes: issues.map((i) => i.code) },
        "Segment failed validation",
      );
      continue;
    }
    return prose;
  }
  throw new Error(lastError);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(extractJson(raw));
  } catch {
    return null;
  }
}

/**
 * Maps the generated shape onto the pipeline's `script.json` contract. The
 * opening and outro become ordinary segments so downstream steps need no
 * special cases for them.
 */
export function assembleScript(jobId: string, generated: GeneratedScript, structure: ScriptStructure): Script {
  const estSeconds = (text: string) => Math.max(1, (wordCount(text) / WORDS_PER_MINUTE) * 60);

  const segments = [
    {
      id: 0,
      text: generated.opening,
      headline: generated.title,
      visualCue: generated.segments[0]?.visualCue ?? "establishing stock footage for the topic",
      estSeconds: estSeconds(generated.opening),
    },
    ...generated.segments.map((segment, index) => ({
      id: index + 1,
      text: segment.text,
      headline: segment.headline,
      visualCue: segment.visualCue,
      estSeconds: estSeconds(segment.text),
      insight: segment.insight,
    })),
    {
      id: generated.segments.length + 1,
      text: generated.outro,
      headline: "What To Watch",
      visualCue: "closing stock footage, wide establishing shot",
      estSeconds: estSeconds(generated.outro),
    },
  ];

  return { jobId, title: generated.title, structureId: structure.id, segments };
}
