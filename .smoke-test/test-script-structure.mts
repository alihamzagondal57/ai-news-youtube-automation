// Verifies the script-structure catalog is genuinely varied (not one skeleton
// reworded), that every structure lands inside the product's 5-20 minute
// runtime envelope, that the prompt brief is actually data-driven, and that
// auto-rotation never repeats a skeleton back-to-back.
//
// Pure logic — no LLM calls, no store — so it runs in a second.
import {
  OPENING_WORDS,
  OUTRO_WORDS,
  SCRIPT_STRUCTURES,
  STRUCTURE_AVOID_WINDOW,
  STRUCTURE_IDS,
  buildStructuralBrief,
  getStructure,
  getStructureOrDefault,
  selectStructure,
  type StructureRotationState,
} from "../services/shared/src/script-structure/index.ts";
import { EMPTY_ROTATION, rotate } from "../services/shared/src/rotation/select.ts";

// The product targets 5-20 minute videos at roughly 150 spoken words/minute.
const WORDS_PER_MINUTE = 150;
const MIN_RUNTIME_MINUTES = 5;
const MAX_RUNTIME_MINUTES = 20;

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── Catalog shape ──────────────────────────────────────────────────────────
check("catalog has 10-20 structures", SCRIPT_STRUCTURES.length >= 10 && SCRIPT_STRUCTURES.length <= 20, `${SCRIPT_STRUCTURES.length} structures`);
check("structure ids are unique", new Set(STRUCTURE_IDS).size === SCRIPT_STRUCTURES.length, `${new Set(STRUCTURE_IDS).size} unique ids`);

// The core requirement: skeletons must differ in SHAPE, not just wording.
const skeletons = new Set(
  SCRIPT_STRUCTURES.map((s) => [s.opening, s.throughline, s.analysis, s.outro].join("|")),
);
check(
  "no two structures share a skeleton",
  skeletons.size === SCRIPT_STRUCTURES.length,
  `${skeletons.size} distinct opening/throughline/analysis/outro combinations across ${SCRIPT_STRUCTURES.length} structures`,
);

// Every declared variant must actually be used, or the token is dead weight
// and the prompt directive for it is never exercised.
for (const [dimension, values] of Object.entries({
  opening: SCRIPT_STRUCTURES.map((s) => s.opening),
  throughline: SCRIPT_STRUCTURES.map((s) => s.throughline),
  analysis: SCRIPT_STRUCTURES.map((s) => s.analysis),
  outro: SCRIPT_STRUCTURES.map((s) => s.outro),
})) {
  const used = new Set(values);
  check(`${dimension} variants in use`, used.size >= 4, `${used.size} distinct: ${[...used].join(", ")}`);
}

// ── Segment rhythm actually varies ─────────────────────────────────────────
const minCounts = SCRIPT_STRUCTURES.map((s) => s.segments.minSegments);
const maxCounts = SCRIPT_STRUCTURES.map((s) => s.segments.maxSegments);
check(
  "segment counts span short-and-deep to many-and-brief",
  Math.min(...minCounts) <= 3 && Math.max(...maxCounts) >= 6,
  `counts range ${Math.min(...minCounts)}-${Math.max(...maxCounts)} segments`,
);
const wordSpreads = new Set(SCRIPT_STRUCTURES.map((s) => `${s.segments.minWordsPerSegment}-${s.segments.maxWordsPerSegment}`));
check("per-segment word budgets vary", wordSpreads.size >= 8, `${wordSpreads.size} distinct budgets`);

// A structure that is 3 deep segments must genuinely be deeper per segment than
// one that is 7 brief ones, otherwise "vary segment count and depth" is cosmetic.
const deepest = SCRIPT_STRUCTURES.reduce((a, b) => (a.segments.maxWordsPerSegment > b.segments.maxWordsPerSegment ? a : b));
const briefest = SCRIPT_STRUCTURES.reduce((a, b) => (a.segments.minWordsPerSegment < b.segments.minWordsPerSegment ? a : b));
check(
  "depth genuinely varies between structures",
  deepest.segments.maxWordsPerSegment >= briefest.segments.minWordsPerSegment * 2.5,
  `"${deepest.id}" up to ${deepest.segments.maxWordsPerSegment} words/segment vs "${briefest.id}" from ${briefest.segments.minWordsPerSegment}`,
);

// ── Runtime envelope: the constraint that actually matters in production ───
// A structure whose bounds fall outside 5-20 minutes would silently generate
// videos the product cannot ship, so this is arithmetic, not judgement.
let envelopeViolations: string[] = [];
for (const s of SCRIPT_STRUCTURES) {
  const minWords = OPENING_WORDS.min + s.segments.minSegments * s.segments.minWordsPerSegment + OUTRO_WORDS.min;
  const maxWords = OPENING_WORDS.max + s.segments.maxSegments * s.segments.maxWordsPerSegment + OUTRO_WORDS.max;
  const minMinutes = minWords / WORDS_PER_MINUTE;
  const maxMinutes = maxWords / WORDS_PER_MINUTE;
  if (minMinutes < MIN_RUNTIME_MINUTES || maxMinutes > MAX_RUNTIME_MINUTES) {
    envelopeViolations.push(`${s.id} (${minMinutes.toFixed(1)}-${maxMinutes.toFixed(1)} min)`);
  }
}
const runtimes = SCRIPT_STRUCTURES.map((s) => ({
  id: s.id,
  min: (OPENING_WORDS.min + s.segments.minSegments * s.segments.minWordsPerSegment + OUTRO_WORDS.min) / WORDS_PER_MINUTE,
  max: (OPENING_WORDS.max + s.segments.maxSegments * s.segments.maxWordsPerSegment + OUTRO_WORDS.max) / WORDS_PER_MINUTE,
}));
check(
  `every structure lands inside the ${MIN_RUNTIME_MINUTES}-${MAX_RUNTIME_MINUTES} minute envelope`,
  envelopeViolations.length === 0,
  envelopeViolations.length === 0
    ? `shortest ${Math.min(...runtimes.map((r) => r.min)).toFixed(1)} min, longest ${Math.max(...runtimes.map((r) => r.max)).toFixed(1)} min at ${WORDS_PER_MINUTE} wpm`
    : `outside envelope: ${envelopeViolations.join(", ")}`,
);

// ── Lookup ─────────────────────────────────────────────────────────────────
check("getStructure resolves a known id", getStructure("deep-dive").id === "deep-dive", "deep-dive resolved");
let threw = false;
try {
  getStructure("does-not-exist");
} catch {
  threw = true;
}
check("getStructure throws on unknown id", threw, "unknown id rejected rather than silently defaulted");
check(
  "getStructureOrDefault falls back",
  getStructureOrDefault("nope").id === getStructureOrDefault(null).id,
  "unknown and null both fall back to the default structure",
);

// ── The prompt brief is data-driven, not boilerplate ───────────────────────
const deepDiveBrief = buildStructuralBrief(getStructure("deep-dive"));
const rapidWireBrief = buildStructuralBrief(getStructure("rapid-wire"));
check("briefs differ between structures", deepDiveBrief !== rapidWireBrief, "two structures produce different prompt briefs");
check(
  "brief carries the structure's own segment bounds",
  deepDiveBrief.includes("3-3 segments") && rapidWireBrief.includes("6-7 segments"),
  `deep-dive "3-3 segments", rapid-wire "6-7 segments"`,
);
check(
  "brief carries the structure's own word budgets",
  deepDiveBrief.includes("280-450 spoken words") && rapidWireBrief.includes("115-170 spoken words"),
  "per-segment budgets rendered into the prompt",
);
// Every structure must produce a brief naming all five structural dimensions,
// or a variant would silently reach the LLM with no instruction attached.
const incompleteBriefs = SCRIPT_STRUCTURES.filter((s) => {
  const brief = buildStructuralBrief(s);
  return !["OPENING", "BODY", "Throughline", "ANALYSIS", "OUTRO"].every((section) => brief.includes(section));
});
check(
  "every structure renders a complete brief",
  incompleteBriefs.length === 0,
  incompleteBriefs.length === 0 ? `all ${SCRIPT_STRUCTURES.length} briefs name every structural dimension` : `incomplete: ${incompleteBriefs.map((s) => s.id).join(", ")}`,
);
const briefs = new Set(SCRIPT_STRUCTURES.map((s) => buildStructuralBrief(s)));
check("all briefs are distinct", briefs.size === SCRIPT_STRUCTURES.length, `${briefs.size} distinct briefs`);

// ── Rotation: the actual requirement ───────────────────────────────────────
const DRAWS = 5000;
let state: StructureRotationState = { recentStructureIds: [] };
const sequence: string[] = [];
let seed = 987654;
const seededRandom = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

for (let i = 0; i < DRAWS; i++) {
  const selection = selectStructure({ state, random: seededRandom });
  sequence.push(selection.structureId);
  state = selection.nextState;
}

let consecutive = 0;
for (let i = 1; i < sequence.length; i++) {
  if (sequence[i] === sequence[i - 1]) consecutive++;
}
check("auto-rotation never repeats consecutively", consecutive === 0, `0 consecutive repeats across ${DRAWS} draws`);

let windowViolations = 0;
for (let i = STRUCTURE_AVOID_WINDOW; i < sequence.length; i++) {
  if (sequence.slice(i - STRUCTURE_AVOID_WINDOW, i).includes(sequence[i])) windowViolations++;
}
check(
  `no repeat within the last ${STRUCTURE_AVOID_WINDOW} videos`,
  windowViolations === 0,
  `0 violations across ${DRAWS} draws`,
);
check("rotation reaches every structure", new Set(sequence).size === SCRIPT_STRUCTURES.length, `${new Set(sequence).size}/${SCRIPT_STRUCTURES.length} structures used`);

// ── Manual override ────────────────────────────────────────────────────────
const overridden = selectStructure({ state, override: "long-lens" });
check("manual override wins", overridden.structureId === "long-lens" && overridden.manual, "override honoured and flagged manual");
check(
  "override is recorded in history",
  overridden.nextState.recentStructureIds[0] === "long-lens",
  "a later auto-pick won't immediately repeat a hand-picked structure",
);
let overrideThrew = false;
try {
  selectStructure({ state, override: "not-a-structure" });
} catch {
  overrideThrew = true;
}
check("invalid override rejected", overrideThrew, "unknown override id throws rather than silently rotating");

// ── The shared rotation helper both systems now depend on ──────────────────
// Theme and structure rotation are the same algorithm; a regression here breaks
// both, so it is verified directly rather than only through its two callers.
const tiny = rotate({ ids: ["a", "b"], state: { recentIds: ["a"] }, avoidWindow: 5, random: () => 0 });
check("shared rotate: tiny catalog still rotates", tiny.id === "b", "2-id catalog avoids the previous pick instead of throwing");
const single = rotate({ ids: ["a"], state: { recentIds: ["a"] }, avoidWindow: 5, random: () => 0 });
check("shared rotate: single-id catalog degrades gracefully", single.id === "a", "falls back rather than throwing on an empty pool");
let emptyThrew = false;
try {
  rotate({ ids: [], avoidWindow: 3 });
} catch {
  emptyThrew = true;
}
check("shared rotate: empty catalog throws", emptyThrew, "an empty catalog is a programming error, not a silent no-op");
check(
  "shared rotate: empty state is a valid starting point",
  rotate({ ids: ["a", "b", "c"], state: EMPTY_ROTATION, avoidWindow: 2, random: () => 0 }).id === "a",
  "first-ever pick works with no history",
);

console.log("");
console.log(failures === 0 ? "ALL SCRIPT STRUCTURE TESTS PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
