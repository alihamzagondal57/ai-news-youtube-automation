// Provider qualification harness. Makes REAL LLM calls.
//
// Runs every configured provider against the SAME trend and the SAME
// validation bar, in isolation (no fallback chain, so nothing masks a
// failure), and reports which providers actually qualify.
//
// Providers are tested against two structures chosen to bracket the catalog:
// the one with the most segments and the one with the highest per-segment word
// budget. Structure rotation picks randomly, so a provider must handle BOTH to
// be usable in production — passing only the easy one is not a pass.
//
// Keys are read from the environment. No key is ever printed.
import "dotenv/config";
import { createLogger } from "@ai-news/shared";
import { getStructure } from "../services/shared/src/script-structure/index.ts";
import { generateScript } from "../services/script-generator/src/generate.ts";
import { config } from "../services/script-generator/src/config.ts";
import { providerStatus, resolveModel } from "../services/script-generator/src/providers/registry.ts";
import { extractJson, generatedScriptSchema, withSegmentIds } from "../services/script-generator/src/schema.ts";
import { validateScript, THRESHOLDS } from "../services/script-generator/src/validate.ts";
import {
  insightCoverage,
  longestSharedRun,
  novelContentRatio,
  wordCount,
} from "../services/script-generator/src/textAnalysis.ts";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "../services/script-generator/src/providers/types.ts";

const JOB_ID = "55555555-5555-5555-5555-555555555555";

// Bracket the catalog: most segments (shortest each) vs highest per-segment
// budget. A provider that clears both will clear the structures in between.
const STRUCTURE_IDS = (process.env.QUALIFY_STRUCTURES ?? "rapid-wire,the-explainer").split(",");

const TREND = {
  topic: "EU agrees provisional deal on 2040 climate target",
  angle: "What the 90 percent emissions-cut target means in practice, and why the flexibility clause is contested",
  sourceSummaries: [
    "European Union negotiators reached a provisional agreement to cut net greenhouse gas emissions by 90 percent by 2040, measured against 1990 levels.",
    "The deal allows member states to count a limited volume of international carbon credits toward the target, capped at three percent of the total reduction.",
    "Several member states argued the flexibility was necessary to keep heavy industry competitive, while environmental groups said it weakens the headline figure.",
    "The provisional text still requires formal approval by the European Parliament and by member state governments before it becomes law.",
    "The European Commission said the target keeps the bloc on a path to climate neutrality by 2050.",
  ],
};

class RecordingProvider implements ScriptProvider {
  readonly name: string;
  readonly responses: CompletionResult[] = [];
  constructor(private readonly inner: ScriptProvider) {
    this.name = inner.name;
  }
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const result = await this.inner.complete(request);
    this.responses.push(result);
    return result;
  }
}

const quiet = (() => {
  const base = createLogger("qualify");
  const q = { ...base, info: () => {}, warn: () => {}, error: () => {}, child: () => q };
  return q as unknown as typeof base;
})();

interface StructureOutcome {
  structureId: string;
  qualified: boolean;
  attempts: number;
  seconds: number;
  /** Best attempt's per-segment word range, for diagnosing length failures. */
  wordRange: string;
  maxOutputTokens: number;
  failureCodes: string[];
  error?: string;
}

/**
 * Sorts a failure into one actionable category. The whole point of this
 * harness is to tell a rate-limit blip apart from a genuine quality failure —
 * the first is retryable and says nothing about the provider's ceiling; the
 * second is a real disqualification.
 */
type Classification = "PASS" | "RATE-LIMIT" | "QUOTA" | "TRUNCATED" | "LENGTH" | "QUALITY" | "FORMAT" | "SETUP" | "ERROR";

function classify(outcome: StructureOutcome): Classification {
  if (outcome.qualified) return "PASS";
  const err = outcome.error ?? "";
  const codes = new Set(outcome.failureCodes);

  if (codes.has("provider_setup")) return "SETUP";
  // Error-string signals first: these usually mean zero completed attempts.
  if (/quota|limit:\s*0|insufficient|billing|payment required|402/i.test(err)) return "QUOTA";
  if (/429|rate.?limit|resource_exhausted|too many requests/i.test(err)) return "RATE-LIMIT";
  if (/truncat|hit max_tokens|hit maxoutputtokens/i.test(err)) return "TRUNCATED";
  // Then validation-code signals from a parsed-but-rejected attempt.
  if ([...codes].some((c) => c.startsWith("segment_") || c.startsWith("opening_") || c.startsWith("outro_"))) return "LENGTH";
  if ([...codes].some((c) => c.includes("insight") || c === "verbatim_lifting" || c === "low_novelty")) return "QUALITY";
  if (codes.has("unparseable_json") || codes.has("bad_shape") || codes.has("missing_field")) return "FORMAT";
  return "ERROR";
}

async function runOne(provider: ScriptProvider, structureId: string): Promise<StructureOutcome> {
  const structure = getStructure(structureId);
  const recorder = new RecordingProvider(provider);
  const started = Date.now();
  let qualified = false;
  let error: string | undefined;

  try {
    await generateScript({
      jobId: JOB_ID,
      trend: TREND,
      structure,
      providers: [recorder],
      maxAttempts: config.maxAttempts,
      logger: quiet,
    });
    qualified = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Diagnose from the best attempt: which checks failed, and what lengths the
  // model actually produced. Length failures and compliance failures need very
  // different responses, so they're reported separately.
  let bestWordRange = "n/a";
  let failureCodes: string[] = [];
  let maxOutputTokens = 0;

  for (const response of recorder.responses) {
    maxOutputTokens = Math.max(maxOutputTokens, response.outputTokens ?? 0);
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(extractJson(response.text));
    } catch {
      failureCodes.push("unparseable_json");
      continue;
    }
    const parsed = generatedScriptSchema.safeParse(parsedJson);
    if (!parsed.success) {
      failureCodes.push("bad_shape");
      continue;
    }
    const script = withSegmentIds(parsed.data);
    const words = script.segments.map((s) => wordCount(s.text));
    bestWordRange = `${Math.min(...words)}-${Math.max(...words)}`;
    const issues = validateScript({ script, structure, sourceSummaries: TREND.sourceSummaries });
    failureCodes = [...new Set(issues.map((i) => i.code))];
  }

  return {
    structureId,
    qualified,
    attempts: recorder.responses.length,
    seconds: (Date.now() - started) / 1000,
    wordRange: bestWordRange,
    maxOutputTokens,
    failureCodes,
    error,
  };
}

async function main() {
  const statuses = providerStatus();
  const configured = statuses.filter((s) => s.configured);
  const missing = statuses.filter((s) => !s.configured);

  console.log("=".repeat(84));
  console.log("PROVIDER QUALIFICATION — identical validation bar for every provider");
  console.log("=".repeat(84));
  console.log(`Structures: ${STRUCTURE_IDS.join(", ")}`);
  for (const id of STRUCTURE_IDS) {
    const s = getStructure(id);
    console.log(
      `  ${s.id.padEnd(16)} ${s.segments.minSegments}-${s.segments.maxSegments} segments x ${s.segments.minWordsPerSegment}-${s.segments.maxWordsPerSegment} words`,
    );
  }
  console.log(
    `Thresholds: novelty >=${THRESHOLDS.minNovelContentRatio}, shared run <=${THRESHOLDS.maxSharedRunTokens}, insight coverage >=${THRESHOLDS.minInsightCoverage}\n`,
  );

  if (missing.length > 0) {
    console.log("NOT CONFIGURED (skipped):");
    for (const { definition } of missing) {
      console.log(`  ${definition.label.padEnd(26)} set ${definition.envKey}`);
    }
    console.log("");
  }

  if (configured.length === 0) {
    console.log("No providers configured — nothing to qualify.");
    return;
  }

  const results = new Map<string, StructureOutcome[]>();

  for (const { definition, model } of configured) {
    console.log("-".repeat(84));
    console.log(`${definition.label}  [${definition.id}]  model: ${model}`);
    console.log("-".repeat(84));

    const outcomes: StructureOutcome[] = [];
    for (const structureId of STRUCTURE_IDS) {
      let provider: ScriptProvider;
      try {
        provider = definition.create(process.env[definition.envKey]!, resolveModel(definition, process.env));
      } catch (err) {
        console.log(`  ${structureId.padEnd(16)} SETUP FAILED — ${err instanceof Error ? err.message : String(err)}`);
        outcomes.push({
          structureId,
          qualified: false,
          attempts: 0,
          seconds: 0,
          wordRange: "n/a",
          maxOutputTokens: 0,
          failureCodes: ["provider_setup"],
          error: String(err),
        });
        continue;
      }

      const outcome = await runOne(provider, structureId);
      outcomes.push(outcome);

      const cls = classify(outcome);
      console.log(
        `  ${structureId.padEnd(16)} ${cls.padEnd(11)} ${outcome.attempts} attempt(s), ${outcome.seconds.toFixed(1)}s, ` +
          `words/segment ${outcome.wordRange}, peak ${outcome.maxOutputTokens} out-tokens`,
      );
      if (!outcome.qualified) {
        if (outcome.failureCodes.length > 0) {
          console.log(`  ${"".padEnd(16)} failed: ${outcome.failureCodes.join(", ")}`);
        }
        if (outcome.error && outcome.failureCodes.length === 0) {
          console.log(`  ${"".padEnd(16)} error: ${outcome.error.replace(/\s+/g, " ").slice(0, 200)}`);
        }
      }
    }
    results.set(definition.id, outcomes);
    console.log("");
  }

  // ── Comparison table ──────────────────────────────────────────────────────
  console.log("=".repeat(84));
  console.log("COMPARISON — one row per provider, one column per structure");
  console.log("=".repeat(84));
  console.log(`${"provider".padEnd(15)}${"model".padEnd(26)}${STRUCTURE_IDS.map((s) => s.slice(0, 13).padEnd(15)).join("")}overall`);
  console.log("-".repeat(84));

  const keep: string[] = [];
  const drop: string[] = [];

  for (const { definition, model } of configured) {
    const outcomes = results.get(definition.id) ?? [];
    const allPassed = outcomes.length > 0 && outcomes.every((o) => o.qualified);
    (allPassed ? keep : drop).push(definition.id);

    const cells = STRUCTURE_IDS.map((sid) => {
      const o = outcomes.find((x) => x.structureId === sid);
      if (!o) return "—".padEnd(15);
      const c = classify(o);
      // Append the produced word range on length failures — it's the number
      // that actually decides these.
      const suffix = c === "LENGTH" || c === "TRUNCATED" ? ` ${o.wordRange}w` : "";
      return (c + suffix).padEnd(15);
    });

    console.log(
      `${definition.id.slice(0, 14).padEnd(15)}${model.slice(0, 25).padEnd(26)}${cells.join("")}${allPassed ? "QUALIFIES" : "rejected"}`,
    );
  }

  console.log("");
  console.log("Failure legend: LENGTH=under word budget · TRUNCATED=cut off at token cap ·");
  console.log("QUALITY=novelty/verbatim/insight · RATE-LIMIT=429 (retryable) · QUOTA=no free allowance");
  console.log("");
  console.log(`QUALIFIES (usable): ${keep.length > 0 ? keep.join(", ") : "(none)"}`);
  console.log(`REJECTED:           ${drop.length > 0 ? drop.join(", ") : "(none)"}`);
  console.log("=".repeat(84));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
