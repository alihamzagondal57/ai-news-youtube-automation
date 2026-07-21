import type { Logger, Script, Trend } from "@ai-news/shared";
import type { ScriptStructure } from "@ai-news/shared/script-structure";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { extractJson, generatedScriptSchema, withSegmentIds, type GeneratedScript } from "./schema.js";
import type { CompletionResult, ScriptProvider } from "./providers/types.js";
import { issuesToRetryInstructions, validateScript, type ValidationIssue } from "./validate.js";
import { wordCount } from "./textAnalysis.js";

/** Spoken words per minute, used to derive estSeconds from generated text. */
const WORDS_PER_MINUTE = 150;

export interface GenerateOptions {
  jobId: string;
  trend: Pick<Trend, "topic" | "angle" | "sourceSummaries">;
  structure: ScriptStructure;
  /** Tried in order; a later provider is used only if every earlier one throws. */
  providers: readonly ScriptProvider[];
  maxTokens: number;
  /** Corrective retries after a validation failure, per provider. */
  maxAttempts?: number;
  logger: Logger;
}

export interface GenerateResult {
  script: Script;
  providerName: string;
  model: string;
  attempts: number;
  /** Issues from rejected attempts, kept for observability into near-misses. */
  discardedIssues: ValidationIssue[][];
}

/**
 * Generates a script and does not return one that fails validation.
 *
 * Two distinct recovery paths, deliberately kept separate:
 *   - A provider *error* (outage, rate limit, refusal, truncation) falls through
 *     to the next provider.
 *   - A *validation failure* is retried on the same provider with the specific
 *     issues fed back, because the model can usually fix its own structural or
 *     insight shortfall when told exactly what failed.
 *
 * If every provider exhausts its attempts, this throws rather than returning a
 * script that failed the compliance checks — shipping an unvalidated script is
 * the outcome the whole layer exists to prevent.
 */
export async function generateScript(options: GenerateOptions): Promise<GenerateResult> {
  const { jobId, trend, structure, providers, maxTokens, logger } = options;
  const maxAttempts = options.maxAttempts ?? 2;

  if (providers.length === 0) {
    throw new Error("No script providers configured — set ANTHROPIC_API_KEY or GROQ_API_KEY");
  }

  const discardedIssues: ValidationIssue[][] = [];
  const providerErrors: string[] = [];
  let totalAttempts = 0;

  for (const provider of providers) {
    let retryInstructions: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      totalAttempts++;

      // Only the network call counts as a provider failure. Everything after it
      // is the model's output being wrong, which is retryable on this same
      // provider — conflating the two sends a recoverable formatting slip to
      // the fallback model and burns the primary's remaining attempts.
      let completion: CompletionResult;
      try {
        completion = await provider.complete({
          system: SYSTEM_PROMPT,
          user: buildUserPrompt({ trend, structure, retryInstructions }),
          maxTokens,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        providerErrors.push(`${provider.name}: ${message}`);
        logger.warn({ jobId, provider: provider.name, attempt, err }, "Provider call failed; trying next provider");
        break;
      }

      try {
        const parsed = generatedScriptSchema.safeParse(JSON.parse(extractJson(completion.text)));
        if (!parsed.success) {
          // A malformed shape is retryable in the same way a validation failure
          // is — tell the model what was wrong and let it correct itself.
          retryInstructions = `Your previous output did not match the required JSON shape: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}. Return the corrected script in the documented format.`;
          logger.warn({ jobId, provider: provider.name, attempt }, "Generated script failed schema parsing");
          continue;
        }

        const generated = withSegmentIds(parsed.data);
        const issues = validateScript({
          script: generated,
          structure,
          sourceSummaries: trend.sourceSummaries,
        });

        if (issues.length > 0) {
          discardedIssues.push(issues);
          retryInstructions = issuesToRetryInstructions(issues);
          logger.warn(
            { jobId, provider: provider.name, attempt, issueCodes: issues.map((i) => i.code) },
            "Generated script failed validation",
          );
          continue;
        }

        logger.info(
          {
            jobId,
            provider: provider.name,
            model: completion.model,
            attempt,
            segments: generated.segments.length,
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
          },
          "Script generated and validated",
        );

        return {
          script: assembleScript(jobId, generated, structure),
          providerName: provider.name,
          model: completion.model,
          attempts: totalAttempts,
          discardedIssues,
        };
      } catch (err) {
        // Reaching here means the response body was not parseable JSON at all.
        // Retryable on the same provider: tell the model what went wrong.
        const message = err instanceof Error ? err.message : String(err);
        retryInstructions = `Your previous output was not valid JSON (${message}). Return a single JSON object and nothing else — no preamble, no markdown fences.`;
        logger.warn({ jobId, provider: provider.name, attempt, err }, "Generated script was not parseable JSON");
      }
    }
  }

  throw new Error(
    `Script generation failed after ${totalAttempts} attempt(s) across ${providers.length} provider(s). ` +
      (providerErrors.length > 0 ? `Provider errors: ${providerErrors.join(" | ")}. ` : "") +
      (discardedIssues.length > 0
        ? `Last validation issues: ${discardedIssues[discardedIssues.length - 1].map((i) => i.message).join(" | ")}`
        : ""),
  );
}

/**
 * Maps the generated shape onto the pipeline's `script.json` contract.
 *
 * The opening and outro become ordinary segments so downstream steps —
 * voiceover, captions, media sourcing, the renderer — need no special cases for
 * them; they are structurally just the first and last segments of the video.
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
