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
   * Whether this provider's TERMS permit production/commercial use — a licensing
   * fact, entirely separate from whether its output passes quality validation.
   *
   * "prototype-only" providers still run (so the pipeline is testable end-to-end
   * without spending money), but using one to produce a monetized video is
   * outside its terms. buildProviderChain surfaces a loud warning rather than
   * silently disabling them, because a dev machine with no paid key still needs
   * a working pipeline. See docs/LICENSING.md §3.2.
   */
  productionUse: "permitted" | "prototype-only";
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
    id: "deepseek",
    label: "DeepSeek",
    // Provisional pending qualify-providers.mts results — see
    // docs/LICENSING.md §3.2 and this file's git history for the measured
    // outcome that set rank/productionUse/disabledReason to their final
    // values.
    rank: 1,
    envKey: "DEEPSEEK_API_KEY",
    modelEnvKey: "SCRIPT_DEEPSEEK_MODEL",
    // deepseek-chat (V3), not deepseek-reasoner: the reasoner model emits
    // chain-of-thought before its answer, which complicates JSON-mode
    // parsing for no benefit here (this is prose generation, not a math/code
    // problem needing visible reasoning).
    defaultModel: "deepseek-chat",
    maxOutputTokens: 8000,
    cost: "Paid, ~$0.14/M output as of docs/LICENSING.md §3.2's research — billing required (a nonzero account balance, not just a key).",
    howToGetKey: "https://platform.deepseek.com/api_keys — sign up, add billing, create a key.",
    productionUse: "permitted",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "deepseek", apiKey, baseURL: "https://api.deepseek.com/v1", model, maxTokens: 8000 }),
  },
  {
    id: "gemini",
    label: "Google Gemini (AI Studio)",
    rank: 4,
    envKey: "GEMINI_API_KEY",
    modelEnvKey: "SCRIPT_GEMINI_MODEL",
    // gemini-2.5-pro (and separately gemini-2.5-flash) both now 404 with
    // "no longer available to new users" on this key -- confirmed live
    // (2026-08-18) against Google's own generateContent endpoint, not just
    // assumed from the model list, which still lists both as if they were
    // reachable. Their suggested replacements are NOT interchangeable:
    // gemini-3.1-pro-preview 429s with a real 0 free-tier quota (paid only),
    // but gemini-3.6-flash genuinely works free with a 65,536-token output
    // ceiling -- larger than 2.5 Pro's, not a downgrade. Re-check this
    // service's actual reachability if it starts 404ing again; Google has
    // now retired two model generations here within this project's lifetime.
    defaultModel: "gemini-3.6-flash",
    maxOutputTokens: 16000,
    cost: "Free tier, no credit card",
    howToGetKey: "https://aistudio.google.com/app/apikey — sign in with a Google account, 'Create API key'. No billing setup required.",
    notes: "Real free-tier ceiling is 65,536 output tokens; 16000 here is this project's own budget, not the model's limit.",
    // Free AI Studio tier: not for revenue-generating use, and Google may train
    // on free-tier inputs. Paid/Vertex is the commercial path.
    productionUse: "prototype-only",
    create: (apiKey, model) => new GeminiProvider({ apiKey, model, maxTokens: 16000 }),
  },
  {
    id: "github-models",
    label: "GitHub Models",
    rank: 1,
    envKey: "GITHUB_MODELS_TOKEN",
    modelEnvKey: "SCRIPT_GITHUB_MODEL",
    defaultModel: "gpt-4o",
    maxOutputTokens: 4000,
    cost: "N/A — service retired, see disabledReason",
    howToGetKey: "N/A — service retired, see disabledReason",
    notes: "Was QUALIFIED (measured, 2026-07): gpt-4o passed both bracket structures — rapid-wire 212-220, the-explainer 334-385 words/segment. No longer usable at all — see disabledReason.",
    productionUse: "prototype-only",
    // PERMANENTLY RETIRED, not a token/auth problem: GitHub Models was fully
    // shut down 2026-07-30 (confirmed via GitHub's own changelog and docs —
    // "the playground, model catalog, inference API, and BYOK are no longer
    // available to any customer"). A freshly-generated token still gets
    // rejected by models.inference.ai.azure.com while being independently
    // confirmed VALID against GitHub's own /rate_limit endpoint (200,
    // authenticated 5000/hr tier) — the token is fine, the service is gone.
    // No amount of token rotation will ever fix this; kept in the catalog
    // only so buildProviderChain silently skips it rather than erroring, and
    // so this historical qualification result isn't lost.
    disabledReason: "GitHub Models was permanently retired 2026-07-30. The service no longer exists — this is not fixable by rotating GITHUB_MODELS_TOKEN.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "github-models", apiKey, baseURL: "https://models.inference.ai.azure.com", model, maxTokens: 8000 }),
  },
  {
    id: "cerebras",
    label: "Cerebras Cloud",
    rank: 5,
    envKey: "CEREBRAS_API_KEY",
    modelEnvKey: "SCRIPT_CEREBRAS_MODEL",
    // RE-QUERIED LIVE (2026-08-19): zai-glm-4.7, the model this used to default
    // to, now 404s -- GET /v1/models confirms Cerebras serves only two chat
    // models today, gemma-4-31b and gpt-oss-120b (found investigating a real
    // trend-research failure that fell all the way through to this
    // last-resort provider and hit that 404). gpt-oss-120b over gemma-4-31b:
    // it's the same model Groq serves and is already proven for long-form
    // prose in this codebase (see the groq entry below and generate.ts's
    // two-phase rewrite) -- not a fresh, unverified pick.
    defaultModel: "gpt-oss-120b",
    maxOutputTokens: 8000,
    cost: "Free, ~1M tokens/day",
    howToGetKey: "https://cloud.cerebras.ai — sign up, then API Keys > Create. No credit card.",
    notes: "Serves 2 models as of 2026-08-19 (gemma-4-31b, gpt-oss-120b) -- zai-glm-4.7 has been retired.",
    productionUse: "prototype-only",
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
    // The FREE "Experiment" tier is prototyping-only; the PAID tier permits
    // commercial use. Flag reflects the free tier this key would use today.
    productionUse: "prototype-only",
    disabledReason:
      "Re-measured (2026-08): rapid-wire PASSES (229-314 words/segment), but the-explainer fails on verbatim_lifting " +
      "(400-517 words/segment — length is fine, it's copying too many consecutive words from the source summaries) " +
      "across all 10 attempts, not the earlier run's 429/rate-limit issue. Quality profile is NOT stable across runs — " +
      "re-run qualify-providers.mts before trusting either result over the other; do not re-enable on the strength of " +
      "one passing run alone.",
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
    productionUse: "prototype-only",
    disabledReason:
      "Re-measured (2026-08): nemotron-3-super-120b passed rapid-wire (199-250, 841s) but TRUNCATED the-explainer at " +
      "the 16k output cap (342-428 words/segment reached before cutoff, 957s) — same failure mode as originally " +
      "measured, confirmed stable across runs. ~14-16min/structure — impractical regardless. A smaller/faster free " +
      "model might qualify; re-test via SCRIPT_OPENROUTER_MODEL.",
    create: (apiKey, model) =>
      new OpenAICompatibleProvider({ name: "openrouter", apiKey, baseURL: "https://openrouter.ai/api/v1", model, maxTokens: 16000 }),
  },
  {
    id: "groq",
    label: "Groq",
    // PRIMARY (2026-08): the only currently-qualified provider that is both
    // free and actually reachable — Claude/DeepSeek above are correctly
    // ranked higher for quality but neither is funded right now (no
    // ANTHROPIC_API_KEY; DEEPSEEK_API_KEY exists with a $0 balance and will
    // 402 on every attempt until funded). Re-promote DeepSeek above this once
    // it's actually funded AND re-qualified with real output, not on the
    // strength of the unfunded run's structure alone.
    rank: 1,
    envKey: "GROQ_API_KEY",
    modelEnvKey: "SCRIPT_GROQ_MODEL",
    // llama-3.3-70b-versatile was measured incapable of reaching the per-segment
    // word budgets (caps ~165 words/segment regardless of the brief). gpt-oss-120b
    // is the model that actually qualifies — see disabledReason's removal below
    // for why the earlier 139-196 words/segment measurement doesn't apply anymore.
    defaultModel: "openai/gpt-oss-120b",
    // RE-QUALIFIED (2026-08): the original failure (94-196 words/segment) was
    // measured BEFORE the two-phase per-segment rewrite (generate.ts, commit
    // 672d3b6) — the old single-JSON-call-for-all-segments approach rations
    // output budget across every field, undercutting every model by ~2x
    // regardless of provider. Re-tested post-rewrite, PASSED both bracket
    // structures for real, twice on the harder one:
    //   rapid-wire:    PASS, 164s, 201-238 words/segment (band 180-320)
    //   the-explainer: PASS, 127s, 354-397 words/segment (band 330-520)
    //   the-explainer: PASS, 144s, 383-493 words/segment (re-run for stability)
    // Separately confirmed: gpt-oss-120b is a REASONING model — Groq returns
    // its chain-of-thought in a `reasoning` field, which consumes the bulk of
    // max_tokens before any visible `content` appears. This is why the ceiling
    // has to stay conservative (see maxOutputTokens below), and it's the real
    // mechanism behind the historical under-length failures — the two-phase
    // rewrite didn't cause this, it just no longer compounds it across every
    // segment in one call.
    //
    // CAVEAT (read before assuming "passes validation" == "fact-checked"):
    // spot-checking the actual prose against the qualification fixture's
    // source summaries found the same fabrication pattern already documented
    // for DeepSeek/Mistral — e.g. one run stated the EU's 2030 target as "a
    // forty-five percent cut," a specific figure not in the source summaries
    // and inconsistent with the real Fit-for-55 target (55%). The mechanical
    // validation bar (word count, anti-lifting, insight-groundedness) does not
    // catch invented statistics, because it checks overlap with the sources,
    // not truth. Script output should get a fact-check pass before anything
    // downstream trusts it, same as every other free/cheap provider here.
    //
    // MEASURED: the account's TPM (tokens/minute) limit for this model is a hard
    // 8,000, and Groq's 413 check counts the REQUESTED max_tokens ceiling (not
    // actual usage) against it — a max_tokens of 8192 alone exceeds the limit
    // before a single input token is added. 5,500 leaves headroom for the
    // segment/plan prompt (~1-1.5k tokens) plus the reasoning overhead above.
    maxOutputTokens: 5500,
    cost: "Free tier",
    howToGetKey: "https://console.groq.com/keys — sign up, 'Create API Key'. No credit card.",
    notes:
      "Model is a reasoning model (chain-of-thought counted in the token budget); free tier caps it at 8,000 " +
      "tokens/minute (input+output, counted against requested max_tokens, not actual usage). The SDK's built-in " +
      "retry/backoff rides out 429s, but near-ceiling calls can wait most of a minute between attempts.",
    // Groq's Services Agreement (console.groq.com/docs/legal/services-agreement
    // §8.1): customer retains all IP rights in Inputs and Outputs, and this is
    // not tier-gated — the free tier carries the same commercial-use rights as
    // paid. §6.3(f)'s only restriction is preserving AI-provenance disclosure
    // markers on outputs, which this pipeline already does (synthetic-media
    // disclosure on every upload, per docs/LICENSING.md).
    productionUse: "permitted",
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
    // Paid API: commercial use permitted, outputs are yours.
    productionUse: "permitted",
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

/**
 * The provider that would actually be used, and whether its terms permit
 * production use. Returns null when nothing is configured.
 *
 * Deliberately advisory rather than enforcing: a dev machine with no paid key
 * still needs a working pipeline, so a prototype-only provider runs and warns.
 * The caller (runScriptGeneration) logs it on every run so it cannot be
 * forgotten, and docs/LICENSING.md carries the detail.
 */
export function activeProviderLicensing(env: NodeJS.ProcessEnv = process.env): {
  id: string;
  label: string;
  productionUse: ProviderDefinition["productionUse"];
} | null {
  const first = rankedCatalog().find(
    (definition) => !definition.disabledReason && Boolean(env[definition.envKey]),
  );
  if (!first) return null;
  return { id: first.id, label: first.label, productionUse: first.productionUse };
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
