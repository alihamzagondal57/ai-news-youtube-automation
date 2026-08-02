// Pure-logic checks for thumbnail-generator's FLUX.1 [schnell] image prompt
// derivation — no I/O, no network, so this runs in a second. The real
// generation call is proven end-to-end (live, not mocked) in
// e2e-thumbnail-generator.mts.
import type { Script } from "@ai-news/shared";
import { buildImagePrompt } from "../services/thumbnail-generator/src/prompt.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function scriptWith(fields: { title?: string; visualCue?: string; headline?: string }): Pick<Script, "title" | "segments"> {
  return {
    title: fields.title ?? "Fallback Title",
    segments: [
      {
        id: 0,
        text: "narration text",
        headline: fields.headline ?? "Fallback Headline",
        visualCue: fields.visualCue ?? "",
        estSeconds: 5,
      },
    ],
  };
}

// ── Primary path: visualCue drives the subject ────────────────────────────
{
  const prompt = buildImagePrompt(scriptWith({ visualCue: "the European Central Bank building" }));
  check(
    "uses visualCue as the subject when present",
    prompt.startsWith("the European Central Bank building,"),
    prompt,
  );
  check(
    "appends the fixed professional-news style suffix",
    prompt.includes("professional news photography") && prompt.includes("dramatic cinematic lighting"),
    prompt,
  );
  check("instructs the model to avoid in-image text/watermarks/logos", prompt.includes("no text") && prompt.includes("no watermark") && prompt.includes("no logos"), prompt);
}

// ── Search-framing prefixes are stripped (written for stock-footage search, not an image model) ──
{
  const cases: Array<[string, string]> = [
    ["stock footage of the ECB building", "the ECB building"],
    ["Footage of a trading floor", "a trading floor"],
    ["b-roll of Brussels at night", "Brussels at night"],
    ["stock photo of a courtroom", "a courtroom"],
    ["photo of a data centre", "a data centre"],
  ];
  for (const [input, expectedSubject] of cases) {
    const prompt = buildImagePrompt(scriptWith({ visualCue: input }));
    check(`strips the search-engine framing from "${input}"`, prompt.startsWith(`${expectedSubject},`), prompt);
  }
}

{
  const prompt = buildImagePrompt(scriptWith({ visualCue: "a stormy harbour at dusk" }));
  check(
    "a visualCue with no search-engine framing passes through unchanged",
    prompt.startsWith("a stormy harbour at dusk,"),
    prompt,
  );
}

// ── Fallback chain: visualCue -> headline -> title ────────────────────────
{
  const prompt = buildImagePrompt(scriptWith({ visualCue: "", headline: "ECB Holds Rates Steady" }));
  check(
    "falls back to the opening headline when visualCue is empty",
    prompt.startsWith("ECB Holds Rates Steady,"),
    prompt,
  );
}

{
  const prompt = buildImagePrompt(scriptWith({ visualCue: "", headline: "", title: "European Rates Decision" }));
  check(
    "falls back to the script title when both visualCue and headline are empty",
    prompt.startsWith("European Rates Decision,"),
    prompt,
  );
}

{
  const prompt = buildImagePrompt(scriptWith({ visualCue: "  stock footage of   the ECB building  " }));
  check(
    "surrounding whitespace around visualCue is trimmed",
    prompt.startsWith("the ECB building,"),
    JSON.stringify(prompt),
  );
}

{
  let threw = false;
  try {
    buildImagePrompt({
      title: "   ",
      segments: [{ id: 0, text: "x", headline: "  ", visualCue: "  ", estSeconds: 5 }],
    });
  } catch {
    threw = true;
  }
  check("throws rather than generating an empty/meaningless prompt when everything is blank", threw, "threw as expected");
}

console.log(failures === 0 ? "\nALL THUMBNAIL PROMPT TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
