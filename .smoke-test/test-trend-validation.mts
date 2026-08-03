// Pure-logic unit test for trend-research's rank.ts validation — no network,
// no LLM call. The real end-to-end proof (actual Firecrawl search + scrape +
// LLM ranking + a real trend.json written to a store) is
// e2e-trend-research.mts; this just covers the index-validation edge cases
// cheaply and fast.
import { validateIndices } from "../services/trend-research/src/rank.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function main() {
  const ok = validateIndices({ topic: "t", angle: "a", sourceIndices: [0, 2], sourceSummaries: ["s1", "s2"] }, 5);
  check("matching-length, in-range indices pass", ok === null, `${ok}`);

  const mismatched = validateIndices({ topic: "t", angle: "a", sourceIndices: [0, 1, 2], sourceSummaries: ["s1"] }, 5);
  check("mismatched sourceIndices/sourceSummaries length is rejected", mismatched !== null && mismatched.includes("3") && mismatched.includes("1"), `${mismatched}`);

  const outOfRange = validateIndices({ topic: "t", angle: "a", sourceIndices: [0, 7], sourceSummaries: ["s1", "s2"] }, 5);
  check("an out-of-range index is rejected", outOfRange !== null && outOfRange.includes("7"), `${outOfRange}`);

  const singleValid = validateIndices({ topic: "t", angle: "a", sourceIndices: [4], sourceSummaries: ["s1"] }, 5);
  check("the last valid index (candidateCount - 1) passes", singleValid === null, `${singleValid}`);

  const zeroCandidates = validateIndices({ topic: "t", angle: "a", sourceIndices: [0], sourceSummaries: ["s1"] }, 0);
  check("any index is out of range against zero candidates", zeroCandidates !== null, `${zeroCandidates}`);

  console.log("");
  console.log(failures === 0 ? "ALL TREND VALIDATION TESTS PASSED" : `${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

main();
