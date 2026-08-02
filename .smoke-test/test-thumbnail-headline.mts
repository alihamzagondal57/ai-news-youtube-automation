// Pure-logic checks for thumbnail-generator's headline fitting and frame-
// timestamp clamping — no rendering, no ffmpeg, so it runs in a second. The
// real render + frame-extraction path is proven end-to-end in
// e2e-thumbnail-generator.mts.
import type { Script } from "@ai-news/shared";
import { pickRepresentativeTimestamp } from "../services/thumbnail-generator/src/frame.ts";
import { deriveThumbnailHeadline, fitHeadline } from "../services/thumbnail-generator/src/headline.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function scriptWithHeadline(headline: string): Pick<Script, "segments"> {
  return { segments: [{ id: 0, text: "narration text", headline, visualCue: "b-roll", estSeconds: 5 }] };
}

// ── fitHeadline: font-size tiers ──────────────────────────────────────────
// Deterministic repeat()-built fixtures rather than hand-counted sentences,
// so the tier boundaries being tested can't drift from a miscounted string.
{
  const shortest = fitHeadline("A".repeat(20)); // <= 28
  check("<=28 chars gets the largest font tier", shortest.fontSizePx === 112, `${shortest.fontSizePx}px for 20 chars`);

  const short = fitHeadline("A".repeat(35)); // 29-42
  check("29-42 chars gets the second tier", short.fontSizePx === 96, `${short.fontSizePx}px for 35 chars`);

  const medium = fitHeadline("A".repeat(50)); // 43-60
  check("43-60 chars gets the third tier", medium.fontSizePx === 80, `${medium.fontSizePx}px for 50 chars`);

  const long = fitHeadline("A".repeat(75)); // 61-90
  check("61-90 chars gets the smallest tier", long.fontSizePx === 68, `${long.fontSizePx}px for 75 chars`);
}

// ── fitHeadline: truncation ────────────────────────────────────────────────
{
  const veryLong = fitHeadline("A".repeat(150));
  check("headline over 90 chars is truncated", veryLong.text.length <= 90, `${veryLong.text.length} chars`);
  check("truncated headline ends with an ellipsis", veryLong.text.endsWith("…"), JSON.stringify(veryLong.text.slice(-5)));
  check("truncated headline still gets the smallest tier", veryLong.fontSizePx === 68, `${veryLong.fontSizePx}px`);
}

{
  const exactly90 = fitHeadline("A".repeat(90));
  check("exactly 90 chars is kept verbatim, not truncated", exactly90.text === "A".repeat(90), `${exactly90.text.length} chars, no ellipsis`);
}

// ── fitHeadline: realistic text + whitespace normalization ────────────────
{
  const realistic = fitHeadline("ECB Holds Rates Steady");
  check("short realistic headline kept verbatim", realistic.text === "ECB Holds Rates Steady", realistic.text);
  check("short realistic headline gets the largest tier", realistic.fontSizePx === 112, `${realistic.fontSizePx}px`);
}

{
  const messy = fitHeadline("  Markets   React\nto  Rate   Decision  ");
  check(
    "internal whitespace/newlines collapse to single spaces",
    messy.text === "Markets React to Rate Decision",
    JSON.stringify(messy.text),
  );
}

// ── deriveThumbnailHeadline ────────────────────────────────────────────────
{
  const derived = deriveThumbnailHeadline(scriptWithHeadline("Brussels Unveils Energy Package"));
  check(
    "derives from segments[0].headline, not script.title",
    derived.text === "Brussels Unveils Energy Package",
    derived.text,
  );
}

{
  let threw = false;
  try {
    deriveThumbnailHeadline(scriptWithHeadline("   "));
  } catch {
    threw = true;
  }
  check("a blank opening-segment headline is rejected rather than rendering an empty thumbnail", threw, "threw as expected");
}

// ── pickRepresentativeTimestamp ────────────────────────────────────────────
const FRAME_OPTS = { fractionOfDuration: 0.12, minSeconds: 1.5, maxSeconds: 8 };

{
  // 40s * 12% = 4.8s, comfortably inside [1.5, 8] — the un-clamped case.
  const ts = pickRepresentativeTimestamp(40, FRAME_OPTS);
  check("typical-length video uses the fraction directly", Math.abs(ts - 4.8) < 1e-9, `${ts}s`);
}

{
  // 120s * 12% = 14.4s, above maxSeconds — must clamp down, not seek 14s in.
  const ts = pickRepresentativeTimestamp(120, FRAME_OPTS);
  check("long video clamps to maxSeconds", ts === 8, `${ts}s`);
}

{
  // 5s * 12% = 0.6s, below minSeconds — must clamp up.
  const ts = pickRepresentativeTimestamp(5, FRAME_OPTS);
  check("short video clamps up to minSeconds", ts === 1.5, `${ts}s`);
}

{
  // 1s video: minSeconds (1.5) would seek past EOF — must clamp below the
  // video's own length instead of trusting the configured floor blindly.
  const ts = pickRepresentativeTimestamp(1, FRAME_OPTS);
  check("very short video never seeks past its own end", ts < 1 && ts > 0, `${ts}s for a 1s video`);
}

console.log(failures === 0 ? "\nALL THUMBNAIL HEADLINE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
