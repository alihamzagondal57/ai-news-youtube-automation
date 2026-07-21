import "dotenv/config";
import type { ScriptProvider } from "./providers/types.js";
import { ClaudeProvider } from "./providers/claude.js";
import { GroqProvider } from "./providers/groq.js";

export const config = {
  /**
   * Claude is primary because script quality is the product, and the
   * original-insight layer is a compliance requirement rather than a stylistic
   * preference — a weaker model that produces generic analysis reads as
   * templated, which is the exact monetization risk this pipeline is built to
   * avoid. Cost is not the deciding factor at ~6 uploads/day (the YouTube
   * quota ceiling).
   */
  claudeModel: process.env.SCRIPT_CLAUDE_MODEL ?? "claude-opus-4-8",
  /** Quality-critical work; effort controls thinking depth and overall spend. */
  claudeEffort: (process.env.SCRIPT_CLAUDE_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max",
  /** Resilience fallback only — used when Claude errors, never for quality reasons. */
  groqModel: process.env.SCRIPT_GROQ_MODEL ?? "llama-3.3-70b-versatile",
  /**
   * Generous: a 20-minute script is ~3000 spoken words, and adaptive thinking
   * shares this budget. Streaming makes a large ceiling safe.
   */
  maxTokens: Number(process.env.SCRIPT_MAX_TOKENS ?? 32000),
  /**
   * 3, not 2: live runs against the fallback model showed corrective retries
   * genuinely converging (verbatim lifting fell 13 tokens -> 9 -> under the
   * limit across successive attempts), but needing more than two rounds to get
   * there. Two attempts threw away drafts that were still improving.
   */
  maxAttempts: Number(process.env.SCRIPT_MAX_ATTEMPTS ?? 3),
};

/**
 * Builds the provider chain from whatever credentials exist, in preference
 * order. Missing keys are skipped rather than fatal, so the service still runs
 * on Groq alone if that is all that is configured.
 */
export function buildProviders(env: NodeJS.ProcessEnv = process.env): ScriptProvider[] {
  const providers: ScriptProvider[] = [];

  if (env.ANTHROPIC_API_KEY) {
    providers.push(
      new ClaudeProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        model: config.claudeModel,
        effort: config.claudeEffort,
      }),
    );
  }
  if (env.GROQ_API_KEY) {
    providers.push(new GroqProvider({ apiKey: env.GROQ_API_KEY, model: config.groqModel }));
  }

  return providers;
}
