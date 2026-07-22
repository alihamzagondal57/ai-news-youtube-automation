import type { ScriptProvider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";

/**
 * Declarative provider catalog, quality-ranked.
 *
 * Adding or removing a provider is one entry here — nothing else in the service
 * branches on provider identity. `rank` is the fallback order: lower runs first,
 * and a provider is only reached if every higher-ranked one has errored.
 *
 * Crucially, rank affects ORDER ONLY. Validation thresholds are identical for
 * every provider: a lower-ranked model does not get an easier bar, it just gets
 * asked later. A provider whose output fails validation falls through exactly
 * like one that returned an HTTP error.
 */
export interface ProviderDefinition {
  id: string;
  label: string;
  /** Lower runs first. */
  rank: number;
  /** Environment variable holding the credential. */
  envKey: string;
  /** Optional env var overriding the default model id. */
  modelEnvKey: string;
  defaultModel: string;
  /**
   * Output-token ceiling for this provider's free/paid tier. Not a global
   * constant: Groq's free tier returns 413 for a 32k ask, while Claude needs
   * headroom because adaptive thinking shares the budget.
   */
  maxOutputTokens: number;
  /** Free-tier status, surfaced by the diagnostics command. */
  cost: string;
  /** Where to obtain a key, surfaced by the diagnostics command. */
  howToGetKey: string;
  /** Operational caveats worth knowing before relying on it. */
  notes?: string;
  /**
   * Set when a provider has been MEASURED to fail the validation bar. It stays
   * in the catalog (so the qualification harness can re-test it, and so the
   * evidence is not lost) but is excluded from the live chain. Quality is not
   * negotiable, so a provider that cannot pass is not silently kept around as a
   * "better than nothing" option.
   */
  disabledReason?: string;
  create(apiKey: string, model: string): ScriptProvider;
}

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  {
    id: "gemini",
    label: "Google Gemini (AI Studio)",
    rank: 4,
    envKey: "GEMINI_API_KEY",
    modelEnvKey: "SCRIPT_GEMINI_MODEL",
    // 2.5 Pro has by far the largest output ceiling of the free options, which
    // is the constraint that eliminated llama-3.3-70b.
    defaultModel: "gemini-2.5-pro",
    maxOutputTokens: 16000,
    cost: "Free tier, no credit card",
    howToGetKey: "https://aistudio.google.com/app/apikey — sign in with a Google account, 'Create API key'. No billing setup required.",
    notes: "Highest free output ceiling of the four; best candidate to actually clear the word budgets.",
    create: (apiKey, model) => new GeminiProvider({ apiKey, model, maxTokens: 16000 }),
  },
  {
    id: "github-models",
    label: "GitHub Models",
    rank: 1,
    envKey: "GITHUB_MODELS_TOKEN",
    modelEnvKey: "SCRIPT_GITHUB_MODEL",
    defaultModel: "gpt-4o",
    // GitHub Models' free tier caps gpt-4o output at 4,096 tokens. A full
    // the-explainer script (~2,900 words ≈ 3,800 tokens) sits right against
    // that ceiling, so this provider is expected to truncate on the longest
    // structures — the qualification run will show whether it does.
    maxOutputTokens: 4000,
    cost: "Free with any GitHub account (rate-limited)",
    howToGetKey:
      "https://github.com/settings/personal-access-tokens — 'Fine-grained token', no repo access needed, set Account permissions > Models to 'Read-only'. Copy the ghp_/github_pat_ value.",
    notes: "QUALIFIED (measured): gpt-4o passed both bracket structures — rapid-wire 212-220, the-explainer 334-385 words/segment — with tight length control. Primary free provider.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "github-models", apiKey, baseURL: "https://models.inference.ai.azure.com", model, maxTokens: 8000 }),
  },
  {
    id: "cerebras",
    label: "Cerebras Cloud",
    rank: 5,
    envKey: "CEREBRAS_API_KEY",
    modelEnvKey: "SCRIPT_CEREBRAS_MODEL",
    // Cerebras serves exactly three chat models (queried live): zai-glm-4.7,
    // gpt-oss-120b, gemma-4-31b. GLM-4.7 is the strongest for long-form prose.
    // Deliberately NOT llama-3.3-70b (not offered here anyway), which failed the
    // length bar on Groq.
    defaultModel: "zai-glm-4.7",
    maxOutputTokens: 8000,
    cost: "Free, ~1M tokens/day",
    howToGetKey: "https://cloud.cerebras.ai — sign up, then API Keys > Create. No credit card.",
    notes: "Serves 3 models (zai-glm-4.7, gpt-oss-120b, gemma-4-31b); GLM-4.7 chosen for long-form.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "cerebras", apiKey, baseURL: "https://api.cerebras.ai/v1", model, maxTokens: 8000 }),
  },
  {
    id: "mistral",
    label: "Mistral (La Plateforme)",
    rank: 6,
    envKey: "MISTRAL_API_KEY",
    modelEnvKey: "SCRIPT_MISTRAL_MODEL",
    // Mistral's strongest general model; 128k context, comfortably long output.
    // OpenAI-compatible endpoint, so it uses the shared adapter.
    defaultModel: "mistral-large-latest",
    maxOutputTokens: 8000,
    cost: "Free experiment tier",
    howToGetKey: "https://console.mistral.ai/api-keys — sign up, create a key. Free 'Experiment' plan, no card.",
    notes: "OpenAI-compatible. mistral-large-latest is the flagship; strong long-form.",
    disabledReason:
      "OPERATIONAL, not quality: length/insight PASS (the-explainer 428-455 in band), but the free Experiment tier " +
      "returns 429 partway through a single script's two-phase calls (plan + 6-7 segments + retries), so it cannot " +
      "reliably finish even one script. Revivable by adding inter-call throttling, or on a paid tier.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "mistral", apiKey, baseURL: "https://api.mistral.ai/v1", model, maxTokens: 8000 }),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    rank: 2,
    envKey: "OPENROUTER_API_KEY",
    modelEnvKey: "SCRIPT_OPENROUTER_MODEL",
    // Largest free long-output model in OpenRouter's free catalog (queried
    // live): 120B params, 262k output. Chosen over the 550B sibling because the
    // 550B ran ~5 min/call — impractical at ~9 calls per script.
    defaultModel: "nvidia/nemotron-3-super-120b-a12b:free",
    maxOutputTokens: 16000,
    cost: "Free tier (rate-limited: ~50 req/day without credits)",
    howToGetKey: "https://openrouter.ai/keys — sign up, create a key. Free models carry a ':free' suffix.",
    notes: "Gateway to many models; the :free tier is rate-limited and slow. Override model with SCRIPT_OPENROUTER_MODEL.",
    disabledReason:
      "nemotron-3-super-120b passed rapid-wire (215-236) but TRUNCATED the-explainer at the 16k output cap, and ran " +
      "~6-7 min/structure (~15 min/script) — impractical. A smaller/faster free model might qualify; re-test via SCRIPT_OPENROUTER_MODEL.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "openrouter", apiKey, baseURL: "https://openrouter.ai/api/v1", model, maxTokens: 16000 }),
  },
  {
    id: "groq",
    label: "Groq",
    rank: 4,
    envKey: "GROQ_API_KEY",
    modelEnvKey: "SCRIPT_GROQ_MODEL",
    // llama-3.3-70b-versatile was measured incapable of reaching the per-segment
    // word budgets (caps ~165 words/segment regardless of the brief). Defaulted
    // to a substantially larger model; if that also fails, Groq is dropped
    // rather than allowed to ship short scripts.
    defaultModel: "openai/gpt-oss-120b",
    // MEASURED: Groq's free tier caps this model at 8,000 tokens per MINUTE
    // (input + output combined), so the output ceiling has to leave room for a
    // ~2k-token prompt. This also means roughly one attempt per minute — a real
    // operational constraint, not just a sizing detail.
    maxOutputTokens: 5500,
    cost: "Free tier",
    howToGetKey: "https://console.groq.com/keys — sign up, 'Create API Key'. No credit card.",
    notes:
      "Free tier caps gpt-oss-120b at 8,000 tokens/minute (input+output), so retries are ~1/minute.",
    disabledReason:
      "FAILS the length bar on every model tested. llama-3.3-70b-versatile produced 94-167 words/segment and " +
      "openai/gpt-oss-120b produced 139-196, against the-explainer's 300-450 requirement; gpt-oss also truncates " +
      "under the free tier's 8k tokens/minute cap. Re-run qualify-providers.mts to re-test (e.g. on a paid tier).",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "groq", apiKey, baseURL: "https://api.groq.com/openai/v1", model, maxTokens: 5500 }),
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    rank: 0,
    envKey: "ANTHROPIC_API_KEY",
    modelEnvKey: "SCRIPT_CLAUDE_MODEL",
    defaultModel: "claude-opus-4-8",
    maxOutputTokens: 32000,
    cost: "Paid (~$0.10-0.15/script)",
    howToGetKey: "https://console.anthropic.com/settings/keys — requires billing.",
    notes: "Highest quality; used first when a key is present. Everything below is a free-tier fallback.",
    create: (apiKey, model) =>
      new ClaudeProvider({
        apiKey,
        model,
        effort: (process.env.SCRIPT_CLAUDE_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max",
        maxTokens: 32000,
      }),
  },
];

/** Catalog in fallback order. */
export function rankedCatalog(): ProviderDefinition[] {
  return [...PROVIDER_CATALOG].sort((a, b) => a.rank - b.rank);
}

export function resolveModel(definition: ProviderDefinition, env: NodeJS.ProcessEnv): string {
  return env[definition.modelEnvKey] || definition.defaultModel;
}

/**
 * Instantiates every provider whose credential is present, in quality order.
 * Missing credentials are skipped silently — the chain is whatever is
 * configured, and generation throws if that turns out to be nothing.
 */
export function buildProviderChain(env: NodeJS.ProcessEnv = process.env): ScriptProvider[] {
  return rankedCatalog()
    .filter((definition) => !definition.disabledReason && Boolean(env[definition.envKey]))
    .map((definition) => definition.create(env[definition.envKey]!, resolveModel(definition, env)));
}

/** Which providers are configured vs missing — for the diagnostics command. */
export function providerStatus(env: NodeJS.ProcessEnv = process.env): Array<{
  definition: ProviderDefinition;
  configured: boolean;
  model: string;
}> {
  return rankedCatalog().map((definition) => ({
    definition,
    configured: Boolean(env[definition.envKey]),
    model: resolveModel(definition, env),
  }));
}
