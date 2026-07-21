// LIVE test — makes a real LLM call. Requires GROQ_API_KEY (or
// ANTHROPIC_API_KEY) in .env. Reads the key from the environment; the key is
// never written into this file or printed.
//
// Reports what the validator says about GENUINE model output, which is the one
// thing the fixture suites cannot tell us: crafted fixtures prove the checks
// fire correctly, but only a real generation shows where a real model actually
// lands relative to the thresholds.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@ai-news/shared";
import { getStructure } from "../services/shared/src/script-structure/index.ts";
import { generateScript } from "../services/script-generator/src/generate.ts";
import { GroqProvider } from "../services/script-generator/src/providers/groq.ts";
import { ClaudeProvider } from "../services/script-generator/src/providers/claude.ts";
import { config } from "../services/script-generator/src/config.ts";
import { extractJson, generatedScriptSchema, withSegmentIds } from "../services/script-generator/src/schema.ts";
import { validateScript, THRESHOLDS } from "../services/script-generator/src/validate.ts";
import {
  insightCoverage,
  longestSharedRun,
  novelContentRatio,
  wordCount,
} from "../services/script-generator/src/textAnalysis.ts";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "../services/script-generator/src/providers/types.ts";

const REPO = "C:\\Users\\HP\\New folder";
const JOB_ID = "44444444-4444-4444-4444-444444444444";

// A deliberate mid-range structure rather than a rotated one, so the run is
// reproducible and the word budgets are a fair ask for a 70B model.
const STRUCTURE = getStructure(process.env.LIVE_STRUCTURE ?? "anchor-brief");

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

/** Wraps a provider to keep every raw response so per-attempt metrics can be reported. */
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

function bar(value: number, threshold: number, higherIsBetter: boolean): string {
  const ok = higherIsBetter ? value >= threshold : value <= threshold;
  return ok ? "PASS" : "FAIL";
}

async function main() {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  let inner: ScriptProvider;
  if (groqKey) {
    inner = new GroqProvider({ apiKey: groqKey, model: config.groqModel });
    console.log(`Provider: Groq (${config.groqModel})`);
  } else if (anthropicKey) {
    inner = new ClaudeProvider({ apiKey: anthropicKey, model: config.claudeModel, effort: config.claudeEffort });
    console.log(`Provider: Claude (${config.claudeModel}, effort=${config.claudeEffort})`);
  } else {
    console.error("No GROQ_API_KEY or ANTHROPIC_API_KEY in the environment — cannot run a live test.");
    process.exit(1);
  }

  const provider = new RecordingProvider(inner);
  console.log(`Structure: "${STRUCTURE.name}" (${STRUCTURE.opening} opening, ${STRUCTURE.throughline} throughline, ${STRUCTURE.analysis} analysis, ${STRUCTURE.outro} outro)`);
  console.log(`Budget:    ${STRUCTURE.segments.minSegments}-${STRUCTURE.segments.maxSegments} segments, ${STRUCTURE.segments.minWordsPerSegment}-${STRUCTURE.segments.maxWordsPerSegment} words each`);
  console.log(`Topic:     ${TREND.topic}\n`);

  const started = Date.now();
  let result: Awaited<ReturnType<typeof generateScript>> | null = null;
  let generationError: string | null = null;

  try {
    result = await generateScript({
      jobId: JOB_ID,
      trend: TREND,
      structure: STRUCTURE,
      providers: [provider],
      // Well under the model's ceiling; ~1200 words of script is ~1800 tokens.
      maxTokens: 8000,
      maxAttempts: 3,
      logger: createLogger("live-test"),
    });
  } catch (err) {
    generationError = err instanceof Error ? err.message : String(err);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(78)}`);
  console.log(`RAW MODEL OUTPUT vs VALIDATOR — ${provider.responses.length} attempt(s), ${elapsed}s`);
  console.log("=".repeat(78));

  // Score every attempt, including ones the pipeline rejected — the rejected
  // ones are the most informative about where a real model falls short.
  for (const [index, response] of provider.responses.entries()) {
    console.log(`\n--- Attempt ${index + 1} (${response.model}, ${response.outputTokens ?? "?"} output tokens) ---`);

    const parsed = generatedScriptSchema.safeParse(
      (() => {
        try {
          return JSON.parse(extractJson(response.text));
        } catch {
          return null;
        }
      })(),
    );

    if (!parsed.success) {
      console.log("  Output did not parse into the required shape — skipping metrics for this attempt.");
      continue;
    }

    const script = withSegmentIds(parsed.data);
    console.log(`  Title:   "${script.title}"`);
    console.log(`  Shape:   ${script.segments.length} body segments, opening ${wordCount(script.opening)}w, outro ${wordCount(script.outro)}w`);
    console.log("");
    console.log("  seg  words   novelty(>=" + THRESHOLDS.minNovelContentRatio + ")   sharedRun(<=" + THRESHOLDS.maxSharedRunTokens + ")   insightCov(>=" + THRESHOLDS.minInsightCoverage + ")");

    for (const segment of script.segments) {
      const novelty = novelContentRatio(segment.text, TREND.sourceSummaries);
      const run = longestSharedRun(segment.text, TREND.sourceSummaries);
      const coverage = insightCoverage(segment.insight ?? "", segment.text);
      console.log(
        `  ${String(segment.id).padStart(3)}  ${String(wordCount(segment.text)).padStart(5)}   ` +
          `${novelty.toFixed(2)} ${bar(novelty, THRESHOLDS.minNovelContentRatio, true).padEnd(6)}   ` +
          `${String(run).padStart(2)} ${bar(run, THRESHOLDS.maxSharedRunTokens, false).padEnd(8)}   ` +
          `${coverage.toFixed(2)} ${bar(coverage, THRESHOLDS.minInsightCoverage, true)}`,
      );
    }

    const issues = validateScript({ script, structure: STRUCTURE, sourceSummaries: TREND.sourceSummaries });
    if (issues.length === 0) {
      console.log("\n  VALIDATOR: accepted — no issues.");
    } else {
      console.log(`\n  VALIDATOR: rejected with ${issues.length} issue(s):`);
      for (const issue of issues) console.log(`    [${issue.code}] ${issue.message}`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  if (result) {
    console.log(`RESULT: accepted after ${result.attempts} attempt(s) via "${result.providerName}" (${result.model})`);
    console.log(`        ${result.script.segments.length} segments in script.json, structureId "${result.script.structureId}"`);

    const outDir = join(REPO, "remotion", "out");
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, "live-script.json");
    await writeFile(outPath, JSON.stringify(result.script, null, 2), "utf8");
    console.log(`        full script written to ${outPath} (gitignored)`);

    const first = result.script.segments[1];
    if (first) {
      console.log(`\n  Sample body segment (id ${first.id}):`);
      console.log(`    "${first.text.slice(0, 400)}${first.text.length > 400 ? "..." : ""}"`);
      const insight = (first as { insight?: string }).insight;
      if (insight) console.log(`\n    declared insight: "${insight}"`);
    }
  } else {
    console.log(`RESULT: generation failed — ${generationError}`);
  }
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
