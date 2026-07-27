// Pure-logic checks for the clip trim/sequencing fix — no render, no network,
// so it runs in a second. Real stock footage (5-60s) and real segment lengths
// (8-220+s for this pipeline's structures) mismatch in both directions; this
// is the module that decides what actually plays to cover the gap. The
// decisive, slow, real-render proof lives in e2e-render-media-timeline.mts —
// this file is about the arithmetic being right in isolation.
import {
  buildSegmentMediaTimeline,
  mediaTimelineToFrames,
  assertMediaTimelineInvariants,
  type MediaTimelineEntry,
} from "../infra/render-server/src/mediaTimeline.ts";

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
function total(entries: MediaTimelineEntry[]): number {
  return entries.reduce((n, e) => n + e.playDurationSeconds, 0);
}
function tiles(entries: MediaTimelineEntry[]): boolean {
  let expected = 0;
  for (const e of entries) {
    if (Math.abs(e.startOffsetSeconds - expected) > 1e-6) return false;
    expected += e.playDurationSeconds;
  }
  return true;
}

// ── Case 1: clip longer than (or equal to) the segment — trim to fit ────────
const longClip = buildSegmentMediaTimeline(8, { file: "clip.mp4", durationSeconds: 54.2 }, []);
check("Case 1 produces exactly one entry", longClip.length === 1, `${longClip.length} entries`);
check("Case 1 plays exactly the segment's duration", Math.abs(total(longClip) - 8) < 1e-9, `${total(longClip)}s`);
check("Case 1 skips a fraction of the clip's start (avoids the static opening beat)", longClip[0].trimInSeconds > 0, `trimmed ${longClip[0].trimInSeconds.toFixed(2)}s`);
check("Case 1's trim-in never runs past what the clip can supply", longClip[0].trimInSeconds + longClip[0].playDurationSeconds <= 54.2 + 1e-9, `${longClip[0].trimInSeconds + longClip[0].playDurationSeconds} <= 54.2`);

const exactClip = buildSegmentMediaTimeline(10, { file: "a.mp4", durationSeconds: 10 }, []);
check("Case 1 edge (clip == segment) trims nothing", exactClip[0].trimInSeconds === 0, "no room to skip an intro, so none is skipped");
check("Case 1 edge still covers the full segment", Math.abs(total(exactClip) - 10) < 1e-9, `${total(exactClip)}s`);

const barelyLong = buildSegmentMediaTimeline(9.5, { file: "b.mp4", durationSeconds: 10 }, []);
check("Case 1 with little slack caps the intro-skip at what's available (never runs past clip end)", barelyLong[0].trimInSeconds <= 0.5 + 1e-9, `skip ${barelyLong[0].trimInSeconds.toFixed(2)}s (latest possible start is 0.5s)`);

// ── Case 2: clip shorter than the segment — sequence through the pool ───────
const sequenced = buildSegmentMediaTimeline(
  180,
  { file: "primary.mp4", durationSeconds: 16 },
  [
    { file: "alt1.mp4", durationSeconds: 12 },
    { file: "alt2.mp4", durationSeconds: 22 },
    { file: "alt3.mp4", durationSeconds: 9 },
  ],
);
check("Case 2 uses more than one clip", sequenced.length > 1, `${sequenced.length} beats`);
check("Case 2 covers the full segment exactly", Math.abs(total(sequenced) - 180) < 1e-9, `${total(sequenced)}s`);
check("Case 2 beats tile with no gap or overlap", tiles(sequenced), "each beat starts exactly where the previous one ended");
check("Case 2 draws on every clip in the pool, not just the primary", new Set(sequenced.map((e) => e.file)).size === 4, `${new Set(sequenced.map((e) => e.file)).size}/4 distinct clips used`);
check("Case 2 never produces a mid-sequence flash-cut", sequenced.every((e, i) => i === sequenced.length - 1 || e.playDurationSeconds >= 0.5 - 1e-9), "no beat under 0.5s except possibly the last");
check("Case 2's first beat also skips its static opening", sequenced[0].trimInSeconds > 0, `primary trimmed ${sequenced[0].trimInSeconds.toFixed(2)}s`);
check("Case 2's repeated clips (later laps) are NOT re-trimmed", sequenced.filter((e) => e.file === "primary.mp4")[1]?.trimInSeconds === 0, "second use of primary.mp4 starts from its own frame 0, not re-skipped");

// ── Case 2: pool exhausted after one pass — must lap, never leave a gap ─────
const lapped = buildSegmentMediaTimeline(60, { file: "p.mp4", durationSeconds: 8 }, [{ file: "a1.mp4", durationSeconds: 6 }]);
check("Lapped sequence still covers the segment exactly", Math.abs(total(lapped) - 60) < 1e-9, `${total(lapped)}s`);
check("Lapped sequence replays the pool more than once", lapped.filter((e) => e.file === "p.mp4").length > 1, `p.mp4 used ${lapped.filter((e) => e.file === "p.mp4").length} times`);
check("Lapped sequence tiles with no gap or overlap", tiles(lapped), "contiguous across every lap");

// ── Case 2: no alternatives at all — must self-loop rather than freeze ──────
const selfLoop = buildSegmentMediaTimeline(50, { file: "solo.mp4", durationSeconds: 7 }, []);
check("A clip with no alternatives still fills the whole segment", Math.abs(total(selfLoop) - 50) < 1e-9, `${total(selfLoop)}s from repeats of a single 7s clip`);
check("Self-loop uses more than one beat (a hard cut, never a held last frame)", selfLoop.length > 1, `${selfLoop.length} beats`);

// ── Degenerate inputs ─────────────────────────────────────────────────────
check("rejects a non-positive segment duration", throws(() => buildSegmentMediaTimeline(0, { file: "a.mp4", durationSeconds: 10 }, [])), "0s segment rejected");
check("rejects a non-positive primary duration", throws(() => buildSegmentMediaTimeline(10, { file: "a.mp4", durationSeconds: 0 }, [])), "0s clip rejected");

// ── Frame conversion: gap-free by construction ──────────────────────────────
const fps = 30;
const frames = mediaTimelineToFrames(sequenced, fps);
check("frame count matches entry count", frames.length === sequenced.length, `${frames.length} frame entries`);
let contiguous = true;
for (let i = 1; i < frames.length; i++) {
  if (frames[i].startFrame !== frames[i - 1].startFrame + frames[i - 1].durationInFrames) contiguous = false;
}
check("frame entries are contiguous (no gap or overlap after rounding)", contiguous, "each startFrame == previous startFrame + durationInFrames");
check("frame timeline starts at frame 0", frames[0].startFrame === 0, `${frames[0].startFrame}`);
const totalFrames = frames.reduce((n, e) => n + e.durationInFrames, 0);
check("total frames match the segment duration at this fps", totalFrames === Math.round(180 * fps), `${totalFrames} frames == ${Math.round(180 * fps)}`);
check("every entry's trim window matches its own duration", frames.every((e) => e.trimAfterFrames - e.trimBeforeFrames === e.durationInFrames), "trimAfter - trimBefore == durationInFrames for every beat");

check("assertMediaTimelineInvariants accepts a well-formed timeline", !throws(() => assertMediaTimelineInvariants(frames, totalFrames)), "no violations");
check("assertMediaTimelineInvariants rejects a gap", throws(() => assertMediaTimelineInvariants([
  { file: "a.mp4", startFrame: 0, durationInFrames: 10, trimBeforeFrames: 0, trimAfterFrames: 10 },
  { file: "b.mp4", startFrame: 11, durationInFrames: 10, trimBeforeFrames: 0, trimAfterFrames: 10 },
], 21)), "gap between frame 10 and 11 rejected");
check("assertMediaTimelineInvariants rejects a total-frame mismatch", throws(() => assertMediaTimelineInvariants(frames, totalFrames + 5)), "declared total not matching the sum of entries is rejected");
check("assertMediaTimelineInvariants rejects an empty timeline", throws(() => assertMediaTimelineInvariants([], 0)), "no beats at all is rejected");

console.log("");
console.log(failures === 0 ? "mediaTimeline unit tests PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
