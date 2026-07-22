// Exercises the TWO-PHASE generation orchestration with fake providers:
// plan-then-per-segment, per-phase retry, provider fallback, the guarantee that
// an invalid script is never returned, and the mapping onto script.json.
//
// No API key and no network — the provider seam is injected. The mock responds
// to plan calls (format "json") and segment calls (format "text") differently,
// exactly as the real providers are driven.
import { createLogger, scriptSchema } from "@ai-news/shared";
import { getStructure } from "../services/shared/src/script-structure/index.ts";
import { generateScript, assembleScript } from "../services/script-generator/src/generate.ts";
import { INSIGHT_MARKER, type GeneratedScript } from "../services/script-generator/src/schema.ts";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "../services/script-generator/src/providers/types.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

const logger = createLogger("gen-test");
const quiet = { ...logger, info: () => {}, warn: () => {}, child: () => quiet } as unknown as typeof logger;

const JOB_ID = "33333333-3333-3333-3333-333333333333";
const STRUCTURE = getStructure("deep-dive"); // 3-3 segments, 280-450 words each

const TREND = {
  topic: "ECB holds interest rates after three consecutive cuts",
  angle: "What the pause signals about the easing cycle",
  sourceSummaries: [
    "The European Central Bank held its key interest rate at 3.75 percent on Thursday, ending a run of three consecutive cuts.",
    "Eurozone inflation fell to 2.1 percent in September, close to the ECB's two percent target.",
  ],
};

// ── Valid mock content, sized to the structure ───────────────────────────────
const OPENING =
  "Something notable happened in Frankfurt this week, and its consequences reach far beyond the trading floor. Policymakers stepped back from a path they had followed for months, and the reasons behind that choice are worth understanding properly rather than skimming. Here is what changed and why it matters.";
const OUTRO =
  "So the moment resolves less than it reveals. Watch the coming weeks for whether this becomes a settled stance or a brief interruption, keep an eye on whether the calmer picture holds, and remember that for anyone whose budget depends on borrowing costs, the ground has just shifted underfoot.";

/** Original prose (low overlap with the sources) padded to a word target, ending with the insight sentence for coverage. */
function proseOf(targetWords: number): string {
  const pool = [
    "Policymakers have chosen caution over momentum, and that choice deserves unpacking rather than simple restatement.",
    "A sequence of reductions had built an expectation among ordinary borrowers that relief would keep arriving on schedule.",
    "Pausing interrupts that rhythm, and expectations once formed are expensive to unwind, which is why officials guard their signalling so carefully.",
    "Businesses feel a quieter version of the same jolt, since spending plans drawn up around ever-cheaper credit suddenly need revisiting.",
    "There is a credibility dimension too, because moving too fast risks reviving the very instability that years of effort had suppressed.",
    "Weighed against that danger, waiting costs comparatively little and buys genuine information about whether recent calm is durable.",
    "Comparisons with earlier episodes tempt the analyst but mislead, because the labour market today behaves unlike its predecessors.",
    "Savers sit in the mirror position, and a plateau preserves returns many had assumed were about to erode away.",
    "The honest reading is that nobody yet knows which interpretation proves correct, and pretending otherwise would flatter false certainty.",
    "Long-horizon institutions care more about the trajectory than any single month, and they are recalibrating quietly rather than loudly.",
  ];
  const parts: string[] = [];
  let i = 0;
  while (parts.join(" ").split(/\s+/).length < targetWords - 25) {
    parts.push(pool[i % pool.length]);
    i++;
  }
  // Insight-bearing closer guarantees insightCoverage passes.
  parts.push(
    "In short, holding steady after three reductions interrupts borrower expectations, and that matters most for variable-rate households whose budgets had assumed further easing.",
  );
  return parts.join(" ");
}

const INSIGHT =
  "Holding steady after three reductions interrupts borrower expectations, which matters most for variable-rate households whose budgets assumed further easing.";

function planJson(overrides: { openingShort?: boolean } = {}): string {
  const n = STRUCTURE.segments.minSegments;
  return JSON.stringify({
    title: "ECB Holds Rates As Inflation Cools",
    opening: overrides.openingShort ? "Rates held." : OPENING,
    outro: OUTRO,
    segments: Array.from({ length: n }, (_, i) => ({
      headline: `Dimension ${i + 1}`,
      visualCue: "stock footage of the ECB headquarters in Frankfurt",
      focus: `The ${["first", "second", "third"][i]} facet of the pause and who it touches.`,
    })),
  });
}

function proseResponse(opts: { short?: boolean } = {}): string {
  const target = opts.short ? 60 : Math.round((STRUCTURE.segments.minWordsPerSegment + STRUCTURE.segments.maxWordsPerSegment) / 2);
  return `${proseOf(target)}\n${INSIGHT_MARKER}\n${INSIGHT}`;
}

/**
 * Configurable two-phase mock. Responds to plan calls (format "json") and
 * segment calls (format "text"). Failure knobs inject specific shortfalls so
 * the retry and fallback paths can be exercised deterministically.
 */
class MockProvider implements ScriptProvider {
  planCalls = 0;
  segmentCalls = 0;
  constructor(
    readonly name: string,
    private readonly opts: {
      throwEvery?: boolean;
      badPlanTimes?: number; // first N plan calls return malformed JSON
      shortSegmentTimes?: number; // first N segment calls return too-short prose
      alwaysShort?: boolean; // every segment call returns too-short prose
    } = {},
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (this.opts.throwEvery) throw new Error("503 upstream unavailable");
    const model = `${this.name}-model`;
    const mk = (text: string): CompletionResult => ({ text, model, inputTokens: 100, outputTokens: 400 });

    if (request.format === "json") {
      this.planCalls++;
      if (this.opts.badPlanTimes && this.planCalls <= this.opts.badPlanTimes) return mk("not json at all");
      return mk(planJson());
    }
    // segment call
    this.segmentCalls++;
    if (this.opts.alwaysShort) return mk(proseResponse({ short: true }));
    if (this.opts.shortSegmentTimes && this.segmentCalls <= this.opts.shortSegmentTimes) return mk(proseResponse({ short: true }));
    return mk(proseResponse());
  }
}

const base = { jobId: JOB_ID, trend: TREND, structure: STRUCTURE, logger: quiet };

// ── Happy path ───────────────────────────────────────────────────────────────
console.log("HAPPY PATH (two-phase)");
const happy = new MockProvider("primary");
const happyResult = await generateScript({ ...base, providers: [happy] });
check(
  "plan + one call per segment",
  happy.planCalls === 1 && happy.segmentCalls === 3,
  `${happy.planCalls} plan call, ${happy.segmentCalls} segment calls`,
);
check("total calls reported", happyResult.calls === 4, `${happyResult.calls} calls (1 plan + 3 segments)`);
check(
  "output satisfies the shared script.json contract",
  scriptSchema.safeParse(happyResult.script).success,
  "scriptSchema.parse succeeds",
);
check("structureId recorded", happyResult.script.structureId === "deep-dive", `"${happyResult.script.structureId}"`);
check(
  "opening + 3 body + outro = 5 segments",
  happyResult.script.segments.length === 5,
  `${happyResult.script.segments.length} segments`,
);
check(
  "body segments hit the word budget",
  happyResult.script.segments.slice(1, -1).every((s) => {
    const w = s.text.split(/\s+/).length;
    return w >= 280 && w <= 450;
  }),
  `body word counts ${happyResult.script.segments.slice(1, -1).map((s) => s.text.split(/\s+/).length).join(", ")}`,
);

// ── Per-segment retry ────────────────────────────────────────────────────────
console.log("\nPER-SEGMENT RETRY");
const retrySeg = new MockProvider("primary", { shortSegmentTimes: 1 });
const retryResult = await generateScript({ ...base, providers: [retrySeg] });
check(
  "a short segment is retried, not returned",
  retryResult.calls === 5 && retrySeg.segmentCalls === 4,
  `${retrySeg.segmentCalls} segment calls (one retry), ${retryResult.calls} total`,
);
check(
  "the retry was triggered by a length failure",
  retryResult.discardedIssues.some((batch) => batch.some((i) => i.code === "segment_words")),
  "segment_words issue recorded before the good attempt",
);

// ── Plan retry on malformed JSON ─────────────────────────────────────────────
console.log("\nPLAN RETRY");
const badPlan = new MockProvider("primary", { badPlanTimes: 1 });
const badPlanResult = await generateScript({ ...base, providers: [badPlan] });
check("malformed plan is retried", badPlan.planCalls === 2, `${badPlan.planCalls} plan calls`);
check("recovers to a valid script", scriptSchema.safeParse(badPlanResult.script).success, "valid after plan retry");

// ── Provider fallback ────────────────────────────────────────────────────────
console.log("\nPROVIDER FALLBACK");
const broken = new MockProvider("primary", { throwEvery: true });
const backup = new MockProvider("fallback");
const fallbackResult = await generateScript({ ...base, providers: [broken, backup] });
check("a provider error falls through", fallbackResult.providerName === "fallback", `served by "${fallbackResult.providerName}"`);

// ── The guarantee ────────────────────────────────────────────────────────────
console.log("\nGUARANTEE: an invalid script is never returned");
const alwaysShort = new MockProvider("primary", { alwaysShort: true });
let threw = false;
let msg = "";
try {
  await generateScript({ ...base, providers: [alwaysShort], maxAttempts: 2 });
} catch (err) {
  threw = true;
  msg = err instanceof Error ? err.message : String(err);
}
check("under-length segments throw rather than shipping", threw, "the length bar is not bypassed");
check("retries were attempted before giving up", alwaysShort.segmentCalls === 2, `${alwaysShort.segmentCalls} attempts on segment 0`);
check("the error explains the failure", /segment|words/i.test(msg), "error names the shortfall");

let noProviderThrew = false;
try {
  await generateScript({ ...base, providers: [] });
} catch {
  noProviderThrew = true;
}
check("no configured providers throws", noProviderThrew, "empty chain fails loudly");

// ── Contract mapping ─────────────────────────────────────────────────────────
console.log("\nCONTRACT MAPPING");
const generated: GeneratedScript = {
  title: "T",
  opening: OPENING,
  outro: OUTRO,
  segments: [0, 1, 2].map((i) => ({ id: i, text: proseOf(350), insight: INSIGHT, headline: `H${i}`, visualCue: "v" })),
};
const assembled = assembleScript(JOB_ID, generated, STRUCTURE);
check(
  "insight carried through to script.json",
  assembled.segments.slice(1, -1).every((s) => typeof (s as { insight?: string }).insight === "string"),
  "body segments retain insight for the review dashboard",
);
check("opening segment uses the title as headline", assembled.segments[0].headline === "T", `"${assembled.segments[0].headline}"`);

console.log("");
console.log(failures === 0 ? "ALL SCRIPT GENERATION TESTS PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
