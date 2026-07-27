// Pure-logic checks for caption-sync — no model, no audio, no store, so it runs
// in a second. Every fixture here is a real failure mode observed in Whisper
// output; the renderer's word lookup is a linear "first span containing t", so
// an overlap or a back-step silently highlights the wrong word rather than
// erroring, which is why these are enforced mechanically.
import { normalizeWords, assertCaptionInvariants, type RawWord } from "../services/caption-sync/src/captions.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ── The happy path: Whisper's normal output shape ────────────────────────────
// Leading spaces on every word, consecutive words sharing a boundary — exactly
// what the live probe returned.
const normal: RawWord[] = [
  { text: " Good", start: 0.0, end: 0.32 },
  { text: " evening,", start: 0.32, end: 0.88 },
  { text: " and", start: 1.38, end: 1.6 },
  { text: " welcome.", start: 1.6, end: 2.14 },
];
const okWords = normalizeWords(normal, 3.0);
check("normal Whisper output survives intact", okWords.length === 4, `${okWords.length} words`);
check("leading spaces are trimmed", okWords.every((w) => w.word === w.word.trim() && w.word.length > 0), `first word "${okWords[0].word}"`);
check("shared boundaries are allowed (end == next start)", okWords[0].end === okWords[1].start, `${okWords[0].end} == ${okWords[1].start}`);
check("gaps between words are preserved", okWords[1].end < okWords[2].start, `${okWords[1].end} < ${okWords[2].start} (silence kept)`);
check("happy path passes its own invariants", !throws(() => assertCaptionInvariants(okWords, 3.0)), "no violations");

// ── Overlap at a chunk seam (the bug that matters) ───────────────────────────
// The renderer's findIndex would resolve t=1.2 to "second" forever, never
// reaching "third".
const overlapping: RawWord[] = [
  { text: "first", start: 0.0, end: 1.0 },
  { text: "second", start: 0.9, end: 2.0 },
  { text: "third", start: 1.1, end: 2.5 },
];
const fixed = normalizeWords(overlapping, 3.0);
check(
  "overlapping spans are tiled, not left overlapping",
  fixed.every((w, i) => i === 0 || w.start >= fixed[i - 1].end),
  fixed.map((w) => `${w.word}[${w.start.toFixed(2)}-${w.end.toFixed(2)}]`).join(" "),
);
check("every word survives an overlap fix", fixed.length === 3, `${fixed.length}/3 words kept`);
check("overlap fix passes invariants", !throws(() => assertCaptionInvariants(fixed, 3.0)), "no violations");

// ── Out-of-order words (chunk stitching can emit these) ──────────────────────
const outOfOrder: RawWord[] = [
  { text: "alpha", start: 2.0, end: 2.4 },
  { text: "beta", start: 0.5, end: 0.9 },
];
const sorted = normalizeWords(outOfOrder, 3.0);
check("out-of-order words are sorted by start", sorted[0].word === "beta" && sorted[1].word === "alpha", sorted.map((w) => w.word).join(", "));

// ── Null / zero-length / out-of-bounds timings ───────────────────────────────
const messy: RawWord[] = [
  { text: "nullend", start: 0.5, end: null }, // Whisper leaves the last word of a window open
  { text: "zero", start: 1.0, end: 1.0 }, // zero-length span
  { text: "", start: 1.5, end: 1.8 }, // empty text
  { text: "   ", start: 1.9, end: 2.0 }, // whitespace-only
  { text: "nostart", start: null, end: 2.5 }, // unusable
  { text: "past", start: 2.8, end: 99.0 }, // ends past the audio
];
const cleaned = normalizeWords(messy, 3.0);
check("null end gets a positive span", cleaned.some((w) => w.word === "nullend" && w.end > w.start), `nullend -> ${cleaned.find((w) => w.word === "nullend")?.end.toFixed(2)}`);
check("zero-length span is repaired or dropped", cleaned.every((w) => w.end > w.start), "no zero-length spans remain");
check("empty and whitespace-only words are dropped", !cleaned.some((w) => w.word === "" || w.word.trim() === ""), `${cleaned.length} words kept`);
check("word with no start is dropped", !cleaned.some((w) => w.word === "nostart"), "unusable timing removed");
check("end past the audio is clamped", cleaned.every((w) => w.end <= 3.0 + 1e-9), `max end ${Math.max(...cleaned.map((w) => w.end)).toFixed(2)} <= 3.0`);
check("messy input still passes invariants", !throws(() => assertCaptionInvariants(cleaned, 3.0)), "no violations");

// ── The invariant checker must actually reject bad input ─────────────────────
check("invariants reject an overlap", throws(() => assertCaptionInvariants([
  { word: "a", start: 0, end: 1.0 },
  { word: "b", start: 0.5, end: 1.5 },
], 3.0)), "overlapping words rejected");
check("invariants reject a non-positive span", throws(() => assertCaptionInvariants([{ word: "a", start: 1, end: 1 }], 3.0)), "zero-length word rejected");
check("invariants reject audio overrun", throws(() => assertCaptionInvariants([{ word: "a", start: 0, end: 5 }], 3.0)), "word past end of audio rejected");
check("invariants reject an empty track", throws(() => assertCaptionInvariants([], 3.0)), "empty caption track rejected");

// ── The renderer's actual lookup resolves every word ─────────────────────────
// This is the real acceptance test: simulate WordHighlightCaptions' findIndex
// across the timeline and confirm each word is reachable at its own midpoint.
const unreachable = fixed.filter((w) => {
  const t = (w.start + w.end) / 2;
  const hit = fixed.findIndex((x) => t >= x.start && t < x.end);
  return fixed[hit]?.word !== w.word;
});
check(
  "every word is reachable by the renderer's findIndex",
  unreachable.length === 0,
  unreachable.length === 0 ? "each word highlights at its own midpoint" : `unreachable: ${unreachable.map((w) => w.word).join(", ")}`,
);

console.log("");
console.log(failures === 0 ? "caption-sync unit tests PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
