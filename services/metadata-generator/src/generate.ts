import type { Logger, Script } from "@ai-news/shared";
import type { ScriptProvider } from "@ai-news/script-generator/providers/types";
import { config } from "./config.js";
import { buildMetadataPrompt, METADATA_SYSTEM_PROMPT } from "./prompt.js";
import { extractJson, generatedMetadataSchema, type GeneratedMetadata } from "./schema.js";
import { retryableIssues } from "./validate.js";

export interface GenerateMetadataOptions {
  script: Script;
  totalDurationSeconds: number;
  /** The script-generator provider chain, reused rather than duplicated — see docs/LICENSING.md for which entries are production-permitted. */
  providers: ScriptProvider[];
  maxAttempts?: number;
  logger: Logger;
}

export interface GenerateMetadataResult {
  metadata: GeneratedMetadata;
  providerName: string;
  model: string;
}

/**
 * One JSON-mode call per attempt — unlike script-generator's two-phase design,
 * metadata fields are short structured copy, not long-form prose, so there's
 * no length-rationing problem to work around.
 *
 * Two distinct failure modes get different treatment, the same lesson
 * script-generator's own generate.ts already learned the hard way: a
 * PROVIDER-level error (network, auth, rate limit) falls through to the next
 * provider immediately, while a MODEL-OUTPUT problem (unparseable JSON, an
 * over-length title) retries the SAME provider with corrective feedback —
 * abandoning a provider over one bad generation would be needlessly wasteful.
 */
export async function generateMetadata(options: GenerateMetadataOptions): Promise<GenerateMetadataResult> {
  const { script, totalDurationSeconds, providers, logger } = options;
  const maxAttempts = options.maxAttempts ?? config.maxAttempts;

  if (providers.length === 0) {
    throw new Error(
      "No script providers configured — metadata-generator reuses script-generator's provider chain, so at least one of its API keys must be set in .env.",
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
          system: METADATA_SYSTEM_PROMPT,
          user: buildMetadataPrompt({ script, totalDurationSeconds, retryInstructions }),
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
        const parsed = generatedMetadataSchema.parse(extractJson(text));
        const issues = retryableIssues(parsed);
        if (issues.length === 0) {
          return { metadata: parsed, providerName: provider.name, model };
        }
        logger.warn({ provider: provider.name, attempt, issues }, "Generated metadata failed validation, retrying");
        retryInstructions = issues.map((i) => `- ${i}`).join("\n");
      } catch (err) {
        // Model output didn't parse as the required shape — a generation
        // fluke, not evidence the provider is down, so retry it directly.
        logger.warn({ provider: provider.name, attempt, error: (err as Error).message }, "Could not parse model output as JSON, retrying");
        retryInstructions = `Your previous response could not be parsed as the required JSON object (${(err as Error).message}). Return ONLY the JSON object — no prose, no markdown fence.`;
      }
    }
  }

  throw new Error(`Metadata generation failed across ${providers.length} provider(s). Errors: ${errors.join("; ")}`);
}
