/**
 * Decides what actually plays behind a segment's background, in two layers:
 *
 *  1. `buildSegmentMediaTimeline` — pure seconds-based logic. Real stock
 *     footage (5-60s, from Pexels/Pixabay via media-sourcing) and real segment
 *     lengths (8-220+s, this pipeline's script structures) mismatch in BOTH
 *     directions, and the previous behaviour — one continuous video, however
 *     long the segment ran — meant a clip shorter than its segment froze on
 *     its last decoded frame for the remainder. That's the defect this module
 *     exists to fix.
 *  2. `mediaTimelineToFrames` — converts to the frame-exact form the Remotion
 *     composition consumes, contiguous by construction (the same technique
 *     voiceover's segment-timing and caption-sync's word-timing needed for
 *     their own seconds->frames conversions).
 *
 * Both cases below are driven entirely by clip durations recorded in
 * `media-manifest.json` (`MediaAsset.durationSeconds` /
 * `MediaAlternative.durationSeconds`, measured by media-sourcing's ffprobe
 * validation) and the segment's real spoken length from `segment-timing.json`
 * — never re-probed here, so this module does no I/O and is pure.
 */

export interface TimelineClipSource {
  file: string;
  durationSeconds: number;
}

/** One beat of footage within a segment, in seconds relative to the segment's own timeline. */
export interface MediaTimelineEntry {
  file: string;
  /** Seconds into the SOURCE clip to start playback from. */
  trimInSeconds: number;
  /** How long this beat plays for. */
  playDurationSeconds: number;
  /** Seconds into the SEGMENT's own timeline this beat starts at. */
  startOffsetSeconds: number;
}

export interface MediaTimelineFrameEntry {
  file: string;
  /** Frames into the segment's own (Sequence-local) timeline. */
  startFrame: number;
  durationInFrames: number;
  trimBeforeFrames: number;
  trimAfterFrames: number;
}

/**
 * Stock footage commonly opens on a static or establishing beat (a held
 * wide shot, a title card, a slow push-in that hasn't started moving yet).
 * Skipping this fraction of a clip's start — rather than always trimming from
 * frame 0 — is a deliberate, honest heuristic, not a content-aware "most
 * interesting moment" analysis (that would need real scene/motion detection,
 * out of scope here). Applied once per clip, the first time it's used.
 */
const INTRO_SKIP_FRACTION = 0.12;

/**
 * A cut shorter than this reads as a flash-frame glitch rather than a
 * deliberate edit. Never created UNLESS it's the beat that finishes the
 * segment exactly — a short final beat is normal pacing; a short beat
 * *mid-sequence*, with more footage available right after it, is not.
 */
const MIN_CUT_SECONDS = 0.5;

/**
 * Hard bound on how many times the clip pool can be replayed from the top
 * when it still doesn't fill a very long segment. Unreachable in any real
 * scenario (a single 5s clip replayed 200 times covers 1000s, far past this
 * pipeline's longest segment), but the loop must provably terminate rather
 * than trust that assumption at runtime.
 */
const MAX_LAPS = 200;

const EPSILON = 1e-6;

/**
 * Case 1 — the primary clip already covers the segment: trim it to exactly
 * the segment's length (skipping the intro fraction where there's room to).
 *
 * Case 2 — the primary clip is shorter than the segment: sequence through the
 * primary and its alternatives, in the order given (media-sourcing ranks them
 * best-first, so this cuts to the next-best footage, not an arbitrary one).
 * If the combined footage still doesn't fill the segment, the pool repeats
 * from the top — a fresh hard cut each time, never a frozen frame — for up to
 * `MAX_LAPS` passes.
 */
export function buildSegmentMediaTimeline(
  segmentDurationSeconds: number,
  primary: TimelineClipSource,
  alternatives: readonly TimelineClipSource[],
): MediaTimelineEntry[] {
  if (!(segmentDurationSeconds > 0)) {
    throw new Error(`segmentDurationSeconds must be positive, got ${segmentDurationSeconds}`);
  }
  if (!(primary.durationSeconds > 0)) {
    throw new Error(`Primary clip "${primary.file}" has a non-positive duration (${primary.durationSeconds}s)`);
  }

  // ── Case 1: trim to fit ─────────────────────────────────────────────────
  if (primary.durationSeconds >= segmentDurationSeconds) {
    const latestStart = primary.durationSeconds - segmentDurationSeconds;
    const introSkip = Math.min(primary.durationSeconds * INTRO_SKIP_FRACTION, latestStart);
    return [
      { file: primary.file, trimInSeconds: introSkip, playDurationSeconds: segmentDurationSeconds, startOffsetSeconds: 0 },
    ];
  }

  // ── Case 2: sequence through the pool, repeating if necessary ───────────
  const pool = [primary, ...alternatives].filter((clip) => clip.durationSeconds > 0);
  if (pool.length === 0) {
    throw new Error(`No usable clip source to fill a ${segmentDurationSeconds}s segment`);
  }

  const timeline: MediaTimelineEntry[] = [];
  const usedBefore = new Set<string>();
  let cursor = 0;
  let remaining = segmentDurationSeconds;

  for (let lap = 0; lap < MAX_LAPS && remaining > EPSILON; lap++) {
    for (const clip of pool) {
      if (remaining <= EPSILON) break;

      const firstUse = !usedBefore.has(clip.file);
      const introSkip = firstUse
        ? Math.min(clip.durationSeconds * INTRO_SKIP_FRACTION, Math.max(0, clip.durationSeconds - MIN_CUT_SECONDS))
        : 0;
      const available = clip.durationSeconds - introSkip;
      const play = Math.min(available, remaining);
      if (play <= EPSILON) continue;

      const finishesSegment = play >= remaining - EPSILON;
      // A sliver mid-sequence reads as a glitch; skip it and let the next
      // clip in the pool take a full-length beat instead. Not skipped when
      // it's the beat that closes out the segment exactly.
      if (play < MIN_CUT_SECONDS && !finishesSegment) continue;

      timeline.push({ file: clip.file, trimInSeconds: introSkip, playDurationSeconds: play, startOffsetSeconds: cursor });
      usedBefore.add(clip.file);
      cursor += play;
      remaining -= play;
    }
  }

  if (remaining > EPSILON) {
    // Unreachable in practice (see MAX_LAPS) — every clip in the pool would
    // have to be smaller than MIN_CUT_SECONDS for 200 laps. If it ever
    // happens, extend the final beat rather than leave a gap or freeze.
    const last = timeline[timeline.length - 1];
    if (!last) {
      throw new Error(`No usable footage could fill a ${segmentDurationSeconds}s segment from a pool of ${pool.length} clip(s)`);
    }
    last.playDurationSeconds += remaining;
  }

  return timeline;
}

/**
 * Seconds -> frames. Each entry's frame span is derived from its CUMULATIVE
 * end time (`Math.round` applied once to the running total), not from
 * independently rounding each entry's own duration — the same fix
 * voiceover's `buildSegmentTiming` and caption-sync's `normalizeWords` needed,
 * for the same reason: independent per-entry rounding can leave a 1-frame gap
 * or overlap between consecutive entries, which the renderer's Sequence
 * placement cannot tolerate (a gap is a black flash; an overlap desyncs
 * everything after it).
 */
export function mediaTimelineToFrames(entries: readonly MediaTimelineEntry[], fps: number): MediaTimelineFrameEntry[] {
  let cursorFrame = 0;
  return entries.map((entry) => {
    const trimBeforeFrames = Math.round(entry.trimInSeconds * fps);
    const endFrame = Math.round((entry.startOffsetSeconds + entry.playDurationSeconds) * fps);
    const durationInFrames = Math.max(1, endFrame - cursorFrame);
    const startFrame = cursorFrame;
    cursorFrame = endFrame;
    return {
      file: entry.file,
      startFrame,
      durationInFrames,
      trimBeforeFrames,
      trimAfterFrames: trimBeforeFrames + durationInFrames,
    };
  });
}

/**
 * Re-checks the frame-space output for the same contiguity guarantee
 * segment-timing and caption timing both assert on themselves — belt and
 * suspenders, since a violation here is a silent visual desync, not a crash.
 */
export function assertMediaTimelineInvariants(entries: readonly MediaTimelineFrameEntry[], expectedTotalFrames: number): void {
  if (entries.length === 0) {
    throw new Error("Media timeline is empty");
  }
  let expected = 0;
  for (const entry of entries) {
    if (entry.startFrame !== expected) {
      throw new Error(`Media timeline is not contiguous: expected "${entry.file}" to start at frame ${expected}, got ${entry.startFrame}`);
    }
    if (entry.durationInFrames <= 0) {
      throw new Error(`Media timeline entry "${entry.file}" has non-positive duration ${entry.durationInFrames}`);
    }
    if (entry.trimBeforeFrames < 0 || entry.trimAfterFrames <= entry.trimBeforeFrames) {
      throw new Error(`Media timeline entry "${entry.file}" has an invalid trim window [${entry.trimBeforeFrames}, ${entry.trimAfterFrames})`);
    }
    expected += entry.durationInFrames;
  }
  if (expected !== expectedTotalFrames) {
    throw new Error(`Media timeline covers ${expected} frames but the segment is ${expectedTotalFrames} frames`);
  }
}
