// Calibrates the original-insight enforcement against crafted fixtures.
//
// The point of this suite is NOT that bad scripts get rejected — a validator
// that rejects everything does that. It is that a genuinely good script passes
// while each distinct failure mode is caught by the specific check meant for
// it. False positives here would block every generation, so the good-script
// case is the most important assertion in the file.
//
// No LLM calls — pure functions over fixed inputs.
import type { ScriptStructure } from "../services/shared/src/script-structure/index.ts";
import { validateScript, THRESHOLDS } from "../services/script-generator/src/validate.ts";
import {
  insightCoverage,
  longestSharedRun,
  novelContentRatio,
} from "../services/script-generator/src/textAnalysis.ts";
import { getStructure } from "../services/shared/src/script-structure/index.ts";
import type { GeneratedScript } from "../services/script-generator/src/schema.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── The factual grounding every fixture is written from ────────────────────
const SOURCES = [
  "The European Central Bank held its key interest rate at 3.75 percent on Thursday, ending a run of three consecutive cuts.",
  "Eurozone inflation fell to 2.1 percent in September, close to the ECB's two percent target.",
  "The ECB President said policymakers would remain data dependent and made no commitment on the December meeting.",
];

// Small word budgets so fixtures stay readable; the real catalog structures are
// exercised separately in the structural-conformance section below.
const TEST_STRUCTURE: ScriptStructure = {
  id: "test-structure",
  name: "Test Structure",
  description: "Fixture structure with small budgets.",
  opening: "directStatement",
  throughline: "thematic",
  segments: { minSegments: 1, maxSegments: 3, minWordsPerSegment: 40, maxWordsPerSegment: 200, rhythm: "test" },
  analysis: "perSegment",
  outro: "keyTakeaways",
};

const OPENING =
  "The European Central Bank has paused. After three straight reductions, policymakers left borrowing costs untouched this week, and the decision lands at a moment when the inflation picture looks calmer than it has in two years. What follows is a look at why the pause happened now, who it affects, and what signal it sends about the months ahead.";

const OUTRO =
  "So the pause is less a verdict than a pause for breath. Watch the December meeting for whether this becomes a genuine halt or a brief interruption, keep an eye on whether inflation holds near target through the autumn, and remember that for anyone on a variable rate, the era of steadily falling repayments has stopped for now.";

/** Genuine analysis in original wording — this is what SHOULD pass. */
const GOOD_SEGMENT = {
  text: "Policymakers have chosen caution over momentum. Three reductions in a row had built an expectation that borrowing costs would keep falling, and holding steady now signals the bank believes the easing cycle has gone far enough for the moment. For households on tracker mortgages across the bloc, that means monthly repayments stop improving, a shift that lands hardest on borrowers who stretched their budgets betting on continued relief. The pause also buys time to see whether the recent improvement in prices is durable or simply a seasonal artefact.",
  headline: "Why The Pause Now",
  visualCue: "stock footage of the ECB headquarters in Frankfurt",
  insight:
    "Holding steady after three reductions signals the easing cycle may have gone far enough, which matters most for tracker borrowers whose repayments stop improving.",
};

/** Lifted almost word-for-word from a source. */
const VERBATIM_SEGMENT = {
  ...GOOD_SEGMENT,
  text: "The European Central Bank held its key interest rate at 3.75 percent on Thursday, ending a run of three consecutive cuts. This was the decision markets had been waiting for and it came after a long period of speculation about the path ahead for borrowing costs in the currency bloc.",
};

/** Reworded enough to break long verbatim runs, but adds nothing of its own. */
const RESTATEMENT_SEGMENT = {
  ...GOOD_SEGMENT,
  text: "The European Central Bank kept its key interest rate at 3.75 percent, ending three consecutive cuts. Eurozone inflation fell to 2.1 percent in September, near the two percent target. The ECB President said policymakers would remain data dependent and made no commitment on the December meeting ahead.",
};

/** Declares an analysis it never actually writes into the narration. */
const FAKE_INSIGHT_SEGMENT = {
  ...GOOD_SEGMENT,
  insight:
    "This segment compares the current pause with the 2011 tightening cycle and explains the consequences for Italian sovereign bond spreads and pension funds.",
};

function scriptWith(segments: Array<typeof GOOD_SEGMENT>): GeneratedScript {
  return {
    title: "ECB Holds Rates As Inflation Cools",
    opening: OPENING,
    outro: OUTRO,
    segments: segments.map((s, i) => ({ ...s, id: i })),
  };
}

const validate = (script: GeneratedScript, structure: ScriptStructure = TEST_STRUCTURE) =>
  validateScript({ script, structure, sourceSummaries: SOURCES });

// ── The calibration case: a good script must not be rejected ───────────────
console.log("CALIBRATION: a genuinely good script must pass");
const goodIssues = validate(scriptWith([GOOD_SEGMENT]));
check(
  "well-written script with real analysis passes",
  goodIssues.length === 0,
  goodIssues.length === 0
    ? "no issues raised — the thresholds don't reject legitimate output"
    : `unexpectedly rejected: ${goodIssues.map((i) => `${i.code}: ${i.message}`).join(" | ")}`,
);
console.log(
  `        measures — novelty ${novelContentRatio(GOOD_SEGMENT.text, SOURCES).toFixed(2)} (need >=${THRESHOLDS.minNovelContentRatio}), ` +
    `longest shared run ${longestSharedRun(GOOD_SEGMENT.text, SOURCES)} tokens (max ${THRESHOLDS.maxSharedRunTokens}), ` +
    `insight coverage ${insightCoverage(GOOD_SEGMENT.insight, GOOD_SEGMENT.text).toFixed(2)} (need >=${THRESHOLDS.minInsightCoverage})`,
);

// ── Each failure mode caught by its own check ──────────────────────────────
console.log("\nENFORCEMENT: each failure mode is caught");

const verbatimIssues = validate(scriptWith([VERBATIM_SEGMENT]));
check(
  "verbatim lifting is caught",
  verbatimIssues.some((i) => i.code === "verbatim_lifting"),
  `longest shared run ${longestSharedRun(VERBATIM_SEGMENT.text, SOURCES)} tokens > ${THRESHOLDS.maxSharedRunTokens}`,
);

const restatementIssues = validate(scriptWith([RESTATEMENT_SEGMENT]));
check(
  "reworded restatement is caught by novelty, not just by verbatim matching",
  restatementIssues.some((i) => i.code === "low_novelty"),
  `novelty ${novelContentRatio(RESTATEMENT_SEGMENT.text, SOURCES).toFixed(2)} < ${THRESHOLDS.minNovelContentRatio} — paraphrasing around the verbatim check does not get through`,
);

const fakeInsightIssues = validate(scriptWith([FAKE_INSIGHT_SEGMENT]));
check(
  "insight declared but not written is caught",
  fakeInsightIssues.some((i) => i.code === "insight_not_in_text"),
  `coverage ${insightCoverage(FAKE_INSIGHT_SEGMENT.insight, FAKE_INSIGHT_SEGMENT.text).toFixed(2)} < ${THRESHOLDS.minInsightCoverage} — the insight field can't be rubber-stamped`,
);

const missingInsightIssues = validate(scriptWith([{ ...GOOD_SEGMENT, insight: "" }]));
check(
  "missing insight is caught",
  missingInsightIssues.some((i) => i.code === "missing_insight"),
  "a segment with no declared analysis is rejected",
);

const shortInsightIssues = validate(scriptWith([{ ...GOOD_SEGMENT, insight: "adds useful context" }]));
check(
  "rubber-stamp insight is caught",
  shortInsightIssues.some((i) => i.code === "insight_too_short"),
  `under ${THRESHOLDS.minInsightWords} words is not an analysis`,
);

const liftedInsightIssues = validate(
  scriptWith([
    {
      ...GOOD_SEGMENT,
      insight: "The ECB President said policymakers would remain data dependent and made no commitment on the December meeting.",
    },
  ]),
);
check(
  "insight lifted from a source is caught",
  liftedInsightIssues.some((i) => i.code === "insight_lifted"),
  "restating a source in the insight field is not adding analysis",
);

// ── Structural conformance against a real catalog structure ────────────────
console.log("\nSTRUCTURAL CONFORMANCE: the brief's bounds are enforced");
const deepDive = getStructure("deep-dive"); // 3-3 segments, 280-450 words each

const tooFewIssues = validate(scriptWith([GOOD_SEGMENT]), deepDive);
check(
  "segment count outside the brief is caught",
  tooFewIssues.some((i) => i.code === "segment_count"),
  `1 segment against deep-dive's ${deepDive.segments.minSegments}-${deepDive.segments.maxSegments}`,
);
check(
  "per-segment word budget is caught",
  tooFewIssues.some((i) => i.code === "segment_words"),
  `~85-word segment against deep-dive's ${deepDive.segments.minWordsPerSegment}-${deepDive.segments.maxWordsPerSegment}`,
);

const shortOpening = validate({ ...scriptWith([GOOD_SEGMENT]), opening: "Rates held." });
check(
  "opening word budget is caught",
  shortOpening.some((i) => i.code === "opening_words"),
  "a two-word opening is rejected",
);

const shortOutro = validate({ ...scriptWith([GOOD_SEGMENT]), outro: "That's all." });
check(
  "outro word budget is caught",
  shortOutro.some((i) => i.code === "outro_words"),
  "a two-word outro is rejected",
);

const missingFieldIssues = validate(scriptWith([{ ...GOOD_SEGMENT, visualCue: "  " }]));
check(
  "missing visualCue is caught",
  missingFieldIssues.some((i) => i.code === "missing_field"),
  "media-sourcing depends on visualCue, so it can't be blank",
);

// ── The measures behave sensibly in isolation ──────────────────────────────
console.log("\nMEASURES: behave as intended on controlled inputs");
check(
  "identical text scores maximum shared run",
  longestSharedRun(SOURCES[0], SOURCES) >= 15,
  `${longestSharedRun(SOURCES[0], SOURCES)} tokens for an exact copy`,
);
check(
  "unrelated text shares no long run",
  longestSharedRun("Quantum entanglement complicates naive assumptions about locality in physics.", SOURCES) <= 2,
  `${longestSharedRun("Quantum entanglement complicates naive assumptions about locality in physics.", SOURCES)} tokens`,
);
check(
  "unrelated text is fully novel",
  novelContentRatio("Quantum entanglement complicates naive assumptions about locality.", SOURCES) === 1,
  "novelty 1.00 when no content word appears in the sources",
);
check(
  "insight fully present in text scores full coverage",
  insightCoverage("borrowing costs stop improving", "Borrowing costs stop improving for households.") === 1,
  "coverage 1.00 when every content word of the insight appears in the text",
);

console.log("");
console.log(failures === 0 ? "ALL SCRIPT VALIDATION TESTS PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
