import type { Logger } from "@ai-news/shared";
import type { ScriptProvider } from "@ai-news/script-generator/providers/types";
import { config } from "./config.js";
import { buildTrendPrompt, TREND_SYSTEM_PROMPT } from "./prompt.js";
import { extractJson, generatedTrendSchema, type GeneratedTrend } from "./schema.js";
import type { Candidate } from "./search.js";

export interface RankTopicOptions {
  niche: string;
  candidates: Candidate[];
  recentTopics: readonly string[];
  /** The script-generator provider chain, reused rather than duplicated — see docs/LICENSING.md for which entries are production-permitted. */
  providers: ScriptProvider[];
  maxAttempts?: number;
  logger: Logger;
}

export interface RankTopicResult {
  trend: GeneratedTrend;
  providerName: string;
  model: string;
}

/**
 * One JSON-mode call per attempt, same shape as metadata-generator's
 * generateMetadata: a provider-level error (network/auth/rate-limit) falls
 * through to the next provider immediately; a model-output problem
 * (unparseable JSON, an out-of-range index) retries the SAME provider with
 * corrective feedback.
 */
export async function rankTopic(options: RankTopicOptions): Promise<RankTopicResult> {
  const { niche, candidates, recentTopics, providers, logger } = options;
  const maxAttempts = options.maxAttempts ?? config.maxAttempts;

  if (candidates.length === 0) {
    throw new Error("No candidate articles to rank — searchCandidates() returned an empty list.");
  }
  if (providers.length === 0) {
    throw new Error(
      "No script providers configured — trend-research reuses script-generator's provider chain, so at least one of its API keys must be set in .env.",
    );
  }

  const errors: string[] = [];

  for (const provider of providers) {
    let retryInstructions: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let text: string;
      let model: string;
      try {
        const result = await provider.complete({
          system: TREND_SYSTEM_PROMPT,
          user: buildTrendPrompt({ niche, candidates, recentTopics, retryInstructions }),
          format: "json",
        });
        text = result.text;
        model = result.model;
      } catch (err) {
        errors.push(`${provider.name}: ${(err as Error).message}`);
        logger.warn({ provider: provider.name, attempt, error: (err as Error).message }, "Provider call failed");
        break; // move to the next provider — this one is unavailable, not just wrong this time
      }

      try {
        const parsed = generatedTrendSchema.parse(extractJson(text));
        const issue = validateIndices(parsed, candidates.length);
        if (!issue) {
          return { trend: parsed, providerName: provider.name, model };
        }
        logger.warn({ provider: provider.name, attempt, issue }, "Generated trend failed validation, retrying");
        retryInstructions = issue;
      } catch (err) {
        logger.warn({ provider: provider.name, attempt, error: (err as Error).message }, "Could not parse model output as JSON, retrying");
        retryInstructions = `Your previous response could not be parsed as the required JSON object (${(err as Error).message}). Return ONLY the JSON object — no prose, no markdown fence.`;
      }
    }
  }

  throw new Error(`Trend ranking failed across ${providers.length} provider(s). Errors: ${errors.join("; ")}`);
}

export function validateIndices(trend: GeneratedTrend, candidateCount: number): string | null {
  if (trend.sourceIndices.length !== trend.sourceSummaries.length) {
    return `sourceIndices has ${trend.sourceIndices.length} entries but sourceSummaries has ${trend.sourceSummaries.length} — they must be the same length, one summary per chosen source.`;
  }
  const outOfRange = trend.sourceIndices.filter((i) => i >= candidateCount);
  if (outOfRange.length > 0) {
    return `sourceIndices contains ${outOfRange.join(", ")}, but only 0-${candidateCount - 1} are valid candidate indices.`;
  }
  return null;
}
