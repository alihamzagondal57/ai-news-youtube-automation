// Exercises the generation orchestration with fake providers: retry-on-
// validation-failure, fallback-on-provider-error, refusal to return an invalid
// script, and the mapping onto the script.json contract.
//
// No API key and no network — the provider seam is injected.
import { createLogger, scriptSchema } from "@ai-news/shared";
import { getStructure } from "../services/shared/src/script-structure/index.ts";
import { generateScript, assembleScript } from "../services/script-generator/src/generate.ts";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "../services/script-generator/src/providers/types.ts";
import type { GeneratedScript } from "../services/script-generator/src/schema.ts";

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

/** Builds original prose long enough to satisfy deep-dive's 280-450 word budget. */
function longSegment(seed: string): string {
  const sentences = [
    `${seed} Policymakers have chosen caution over momentum, and the reasoning behind that choice deserves unpacking rather than simple reporting.`,
    "Three reductions in a row had built an expectation among borrowers that repayment relief would continue arriving on a predictable schedule.",
    "Holding steady interrupts that rhythm, and expectations once set are expensive to reset, which is precisely why central bankers guard their signalling so carefully.",
    "For households carrying variable-rate obligations, the practical consequence is immediate: monthly outgoings stop improving, and budgets built on an assumption of continued easing suddenly look optimistic.",
    "Businesses face a subtler version of the same problem, because investment decisions made under an assumption of cheapening credit now need revisiting against a flatter trajectory.",
    "There is also a credibility dimension worth naming, since an institution that eases too quickly risks importing the very instability it spent years suppressing.",
    "Weighed against that, pausing costs relatively little and buys genuine information about whether recent improvements are durable or merely seasonal artefacts.",
    "The honest summary is that nobody yet knows which reading is correct, and pretending otherwise would misrepresent how much genuine uncertainty remains.",
    "It helps to remember how unusual the preceding sequence was, because uninterrupted reductions of that length are rare outside genuine emergencies.",
    "That rarity is itself informative, suggesting the earlier urgency has faded rather than that the underlying problem was solved outright.",
    "Comparisons with earlier cycles are tempting but treacherous, since the shape of the labour market differs substantially from the last comparable episode.",
    "Wage growth in particular behaves differently now, and any analysis that ignores that difference will reach confident conclusions on weak foundations.",
    "Savers occupy the mirror position to borrowers here, and a plateau in rates preserves returns that many had assumed were about to erode.",
    "Pension funds and insurers, whose liabilities stretch decades ahead, care rather more about the trajectory than about any individual month's decision.",
    "The practical advice for anyone making a medium-term financial commitment is to plan against a flat path rather than a falling one.",
    "None of this amounts to a prediction, and the value of the pause is precisely that it preserves optionality in both directions.",
  ];
  return sentences.join(" ");
}

function goodScript(): GeneratedScript {
  return {
    title: "ECB Holds Rates As Inflation Cools",
    opening:
      "The European Central Bank has paused. After three straight reductions, policymakers left borrowing costs untouched this week, and the decision lands at a moment when the inflation picture looks calmer than it has in two years. What follows examines why the pause happened now and what signal it sends.",
    outro:
      "So the pause is less a verdict than a moment to draw breath. Watch the December meeting for whether this becomes a genuine halt, keep an eye on whether prices hold near target through autumn, and remember that for anyone on a variable rate the era of steadily falling repayments has stopped for now.",
    segments: [0, 1, 2].map((i) => ({
      id: i,
      text: longSegment(`Consider the ${["first", "second", "third"][i]} dimension of this decision.`),
      headline: `Dimension ${i + 1}`,
      visualCue: "stock footage of the ECB headquarters in Frankfurt",
      insight:
        "Holding steady after three reductions interrupts borrower expectations of continued repayment relief, which matters most for variable-rate households whose budgets assumed further easing.",
    })),
  };
}

/** Strips ids — providers return the raw generated shape. */
function asProviderJson(script: GeneratedScript): string {
  return JSON.stringify({
    title: script.title,
    opening: script.opening,
    outro: script.outro,
    segments: script.segments.map(({ id, ...rest }) => rest),
  });
}

class ScriptedProvider implements ScriptProvider {
  public calls = 0;
  constructor(
    readonly name: string,
    private readonly responses: Array<string | Error>,
  ) {}
  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls++;
    if (response instanceof Error) throw response;
    return { text: response, model: `${this.name}-model`, inputTokens: 100, outputTokens: 200 };
  }
}

const base = { jobId: JOB_ID, trend: TREND, structure: STRUCTURE, logger: quiet };

// ── Happy path ─────────────────────────────────────────────────────────────
console.log("HAPPY PATH");
const happy = new ScriptedProvider("primary", [asProviderJson(goodScript())]);
const happyResult = await generateScript({ ...base, providers: [happy] });
check("valid script accepted on first attempt", happyResult.attempts === 1, `${happyResult.attempts} attempt`);
check("provider recorded", happyResult.providerName === "primary", `provider "${happyResult.providerName}"`);
check(
  "output satisfies the shared script.json contract",
  scriptSchema.safeParse(happyResult.script).success,
  "scriptSchema.parse succeeds",
);
check(
  "structureId recorded on the script",
  happyResult.script.structureId === "deep-dive",
  `structureId "${happyResult.script.structureId}"`,
);
check(
  "opening and outro become segments",
  happyResult.script.segments.length === 5,
  `3 body segments + opening + outro = ${happyResult.script.segments.length}`,
);
check(
  "segment ids are sequential from zero",
  happyResult.script.segments.every((s, i) => s.id === i),
  `ids ${happyResult.script.segments.map((s) => s.id).join(",")}`,
);
check(
  "estSeconds derived from word count",
  happyResult.script.segments.every((s) => s.estSeconds > 0),
  `opening ~${happyResult.script.segments[0].estSeconds.toFixed(1)}s`,
);

// ── Retry on validation failure ────────────────────────────────────────────
console.log("\nRETRY ON VALIDATION FAILURE");
const badThenGood = goodScript();
const lifted = {
  ...badThenGood,
  segments: badThenGood.segments.map((s, i) =>
    i === 0 ? { ...s, text: `${TREND.sourceSummaries[0]} ${s.text}` } : s,
  ),
};
const retrying = new ScriptedProvider("primary", [asProviderJson(lifted), asProviderJson(goodScript())]);
const retryResult = await generateScript({ ...base, providers: [retrying] });
check(
  "a failing script is retried, not returned",
  retryResult.attempts === 2 && retryResult.discardedIssues.length === 1,
  `${retryResult.attempts} attempts, ${retryResult.discardedIssues.length} rejected`,
);
check(
  "the rejected attempt was rejected for the right reason",
  retryResult.discardedIssues[0].some((i) => i.code === "verbatim_lifting"),
  `codes: ${retryResult.discardedIssues[0].map((i) => i.code).join(", ")}`,
);

// ── Malformed JSON is retried ──────────────────────────────────────────────
console.log("\nMALFORMED OUTPUT");
const malformed = new ScriptedProvider("primary", ["not json at all", asProviderJson(goodScript())]);
const malformedResult = await generateScript({ ...base, providers: [malformed] });
check("unparseable output is retried", malformedResult.attempts === 2, `${malformedResult.attempts} attempts`);

const fenced = new ScriptedProvider("primary", ["```json\n" + asProviderJson(goodScript()) + "\n```"]);
const fencedResult = await generateScript({ ...base, providers: [fenced] });
check(
  "markdown-fenced JSON is accepted",
  fencedResult.attempts === 1,
  "a fenced response doesn't waste a retry",
);

// ── Provider fallback ──────────────────────────────────────────────────────
console.log("\nPROVIDER FALLBACK");
const broken = new ScriptedProvider("primary", [new Error("503 upstream unavailable")]);
const backup = new ScriptedProvider("fallback", [asProviderJson(goodScript())]);
const fallbackResult = await generateScript({ ...base, providers: [broken, backup] });
check(
  "a provider error falls through to the next provider",
  fallbackResult.providerName === "fallback",
  `served by "${fallbackResult.providerName}"`,
);
check(
  "the broken provider is not retried",
  broken.calls === 1,
  `primary called ${broken.calls}x — retrying a dead endpoint just delays the fallback`,
);

// ── The guarantee: never return an invalid script ──────────────────────────
console.log("\nGUARANTEE: an invalid script is never returned");
const alwaysBad = new ScriptedProvider("primary", [asProviderJson(lifted)]);
let threw = false;
let errorMessage = "";
try {
  await generateScript({ ...base, providers: [alwaysBad], maxAttempts: 2 });
} catch (err) {
  threw = true;
  errorMessage = err instanceof Error ? err.message : String(err);
}
check(
  "exhausted retries throw rather than returning a failing script",
  threw,
  "shipping an unvalidated script is the outcome the layer exists to prevent",
);
check(
  "the error names the validation failure",
  errorMessage.includes("consecutive words"),
  "the thrown error explains what failed, not just that it failed",
);
check("retries were actually attempted", alwaysBad.calls === 2, `${alwaysBad.calls} attempts before giving up`);

let noProviderThrew = false;
try {
  await generateScript({ ...base, providers: [] });
} catch {
  noProviderThrew = true;
}
check("no configured providers throws", noProviderThrew, "missing credentials fail loudly at generation time");

// ── assembleScript in isolation ────────────────────────────────────────────
console.log("\nCONTRACT MAPPING");
const assembled = assembleScript(JOB_ID, goodScript(), STRUCTURE);
check(
  "insight is carried through to script.json",
  assembled.segments.slice(1, -1).every((s) => typeof (s as { insight?: string }).insight === "string"),
  "body segments retain their declared insight for the review dashboard",
);
check(
  "opening segment uses the title as its headline",
  assembled.segments[0].headline === assembled.title,
  `"${assembled.segments[0].headline}"`,
);

console.log("");
console.log(failures === 0 ? "ALL SCRIPT GENERATION TESTS PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
