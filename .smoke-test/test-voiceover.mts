// Pure-logic checks for the voiceover service — no network, no audio, no store,
// so it runs in a second. Covers the things unit-testable without synthesizing:
// the Kokoro chunk splitter + WAV encoder, the segment-timing math the render
// pipeline depends on, the voice library's integrity, and voice rotation.
import { __test as kokoroTest } from "../services/voiceover/src/engines/kokoro.ts";
import { buildSegmentTiming, assertTimingInvariants, type TimelinePiece } from "../services/voiceover/src/timing.ts";
import { VOICE_LIBRARY, DEFAULT_VOICE_ID, getVoice, resolveVoiceId, sapiEquivalent, kokoroEquivalent, VOICE_ROTATION_POOL, VOICE_AVOID_WINDOW, selectVoice, EMPTY_VOICE_ROTATION } from "../services/voiceover/src/voices.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── Voice library ────────────────────────────────────────────────────────────
check("library has a useful spread of voices", VOICE_LIBRARY.length >= 10, `${VOICE_LIBRARY.length} voices`);
check("voice ids are unique", new Set(VOICE_LIBRARY.map((v) => v.id)).size === VOICE_LIBRARY.length, "no duplicate ids");
check("default voice exists in the library", VOICE_LIBRARY.some((v) => v.id === DEFAULT_VOICE_ID), DEFAULT_VOICE_ID);
check("library offers both genders", new Set(VOICE_LIBRARY.map((v) => v.gender)).size === 2, "male and female present");
check(
  "library offers multiple neural accents",
  new Set(VOICE_LIBRARY.filter((v) => v.engine === "kokoro").map((v) => v.accent)).size >= 2,
  `${new Set(VOICE_LIBRARY.filter((v) => v.engine === "kokoro").map((v) => v.accent)).size} Kokoro accents`,
);
check("no removed Edge voices linger", VOICE_LIBRARY.every((v) => v.engine === "kokoro" || v.engine === "sapi"), "library is Kokoro + SAPI only");
check("every gender has an offline fallback voice", ["male", "female"].every((g) => VOICE_LIBRARY.some((v) => v.engine === "sapi" && v.gender === g)), "sapi male + female both present");
check("sapi voices carry a systemName", VOICE_LIBRARY.filter((v) => v.engine === "sapi").every((v) => Boolean(v.systemName)), "offline voices name their system voice");
check("getVoice throws on an unknown id", (() => { try { getVoice("nope"); return false; } catch { return true; } })(), "unknown id rejected");
check("resolveVoiceId honours an override", resolveVoiceId("kokoro-af-heart") === "kokoro-af-heart", "override wins");
check("resolveVoiceId falls back to the default", resolveVoiceId(null) === DEFAULT_VOICE_ID, "null -> default");
check("sapiEquivalent keeps gender and is offline", sapiEquivalent(getVoice("kokoro-bf-emma")).engine === "sapi" && sapiEquivalent(getVoice("kokoro-bf-emma")).gender === "female", "female neural -> female sapi");

// Kokoro voices are wired into the library as a first-class engine.
const kokoroVoices = VOICE_LIBRARY.filter((v) => v.engine === "kokoro");
check("library includes Kokoro voices", kokoroVoices.length >= 6, `${kokoroVoices.length} Kokoro voices`);
check("every Kokoro voice names a model voice", kokoroVoices.every((v) => Boolean(v.engineVoice)), "all carry engineVoice (e.g. bm_george)");
check("Kokoro offers both genders", new Set(kokoroVoices.map((v) => v.gender)).size === 2, "Kokoro male + female present");
check("kokoroEquivalent keeps gender and is Kokoro", kokoroEquivalent(getVoice("sapi-david")).engine === "kokoro" && kokoroEquivalent(getVoice("sapi-david")).gender === "male", "male request -> male Kokoro voice");

// ── Voice rotation pool (the third variety axis) ─────────────────────────────
const poolVoices = VOICE_ROTATION_POOL.map((id) => getVoice(id));
check("rotation pool is all self-hosted Kokoro voices", poolVoices.every((v) => v.engine === "kokoro"), "auto-rotation stays fully self-hosted (no egress/license risk)");
check("rotation pool spans both accents", new Set(poolVoices.map((v) => v.accent)).size >= 2, [...new Set(poolVoices.map((v) => v.accent))].join(" + "));
check("rotation pool spans both genders", new Set(poolVoices.map((v) => v.gender)).size === 2, "male + female both in rotation");
check("default voice is in the rotation pool", VOICE_ROTATION_POOL.includes(DEFAULT_VOICE_ID), DEFAULT_VOICE_ID);
// Deterministic rotation: never repeats within the avoid window, and cycles the whole pool.
let vState = EMPTY_VOICE_ROTATION;
const picks: string[] = [];
let rng = 0;
for (let i = 0; i < 400; i++) {
  const sel = selectVoice({ state: vState, random: () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) });
  picks.push(sel.voiceId);
  vState = sel.nextState;
}
let vConsecutive = 0;
for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) vConsecutive++;
check("rotation never repeats within the avoid window", vConsecutive === 0, `0 back-to-back repeats across 400 draws (window ${VOICE_AVOID_WINDOW})`);
check("rotation uses the whole pool", new Set(picks).size === VOICE_ROTATION_POOL.length, `${new Set(picks).size}/${VOICE_ROTATION_POOL.length} voices used`);
check("override wins and is flagged manual", (() => { const s = selectVoice({ override: "kokoro-am-michael" }); return s.voiceId === "kokoro-am-michael" && s.manual; })(), "explicit override returns that voice, manual=true");

// ── Kokoro helpers ───────────────────────────────────────────────────────────
const { splitForModel, encodeWavPcm16 } = kokoroTest;
const kLong = Array.from({ length: 30 }, (_, i) => `Sentence ${i} of a long segment.`).join(" ");
const kParts = splitForModel(kLong, 200);
check("Kokoro splits long text under the token cap", kParts.length > 1 && kParts.every((p) => p.length <= 200 + 60), `${kParts.length} chunks, max ${Math.max(...kParts.map((p) => p.length))} chars`);
check("Kokoro split is lossless", kParts.join(" ").split(/\s+/).length === kLong.split(/\s+/).length, "no words dropped");
// A tiny WAV: 4 samples at 24kHz must produce a 44-byte header + 8 data bytes.
const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1]), 24000);
check("Kokoro WAV encoder writes a valid RIFF/WAVE header", wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE", `${wav.length} bytes total`);
check("Kokoro WAV declares 24kHz mono 16-bit", wav.readUInt16LE(22) === 1 && wav.readUInt32LE(24) === 24000 && wav.readUInt16LE(34) === 16, "mono, 24000Hz, 16-bit");
check("Kokoro WAV data chunk size matches sample count", wav.readUInt32LE(40) === 4 * 2, "4 samples -> 8 data bytes");

// ── Timing math (the render contract) ────────────────────────────────────────
// Three segments with a 0.5s pause between each; pauses fold into the preceding
// segment so the timeline is gapless.
const pieces: TimelinePiece[] = [
  { kind: "segment", id: 0, durationSeconds: 4 },
  { kind: "pause", durationSeconds: 0.5 },
  { kind: "segment", id: 1, durationSeconds: 6 },
  { kind: "pause", durationSeconds: 0.5 },
  { kind: "segment", id: 2, durationSeconds: 5 },
];
const timing = buildSegmentTiming("11111111-1111-1111-1111-111111111111", pieces);
check("total duration is the sum of all pieces", timing.totalDurationSeconds === 16, `${timing.totalDurationSeconds}s`);
check("first segment starts at 0", timing.segments[0].startSeconds === 0, "0s");
check("trailing pause folds into the preceding segment", timing.segments[0].endSeconds === 4.5 && timing.segments[1].startSeconds === 4.5, "seg0 ends at 4.5, seg1 starts at 4.5");
check("last segment ends at the total", timing.segments[2].endSeconds === 16, "16s");
check("computed timing passes its own invariants", (() => { try { assertTimingInvariants(timing, [0, 1, 2]); return true; } catch { return false; } })(), "contiguous, ascending, ids match");

// A deliberately broken timing must be rejected (a gap between segments).
const broken = { jobId: "1", totalDurationSeconds: 10, segments: [ { id: 0, startSeconds: 0, endSeconds: 4 }, { id: 1, startSeconds: 5, endSeconds: 10 } ] };
check("invariant check rejects a gap in the timeline", (() => { try { assertTimingInvariants(broken as any, [0, 1]); return false; } catch { return true; } })(), "non-contiguous timing throws");
check("invariant check rejects an id mismatch", (() => { try { assertTimingInvariants(timing, [0, 1, 9]); return false; } catch { return true; } })(), "wrong ids throw");

console.log("");
console.log(failures === 0 ? "voiceover unit tests PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
