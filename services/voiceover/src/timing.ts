import type { SegmentTiming } from "@ai-news/shared";

/**
 * A piece of the concatenated timeline, in play order. Segments carry their
 * script id; pauses are the silence beats between them.
 */
export type TimelinePiece =
  | { kind: "segment"; id: number; durationSeconds: number }
  | { kind: "pause"; durationSeconds: number };

/**
 * Build segment-timing.json from the *measured* durations of the pieces that
 * were actually concatenated, in the order they were concatenated.
 *
 * The contract that render-server relies on (infra/render-server/src):
 *  - one entry per script segment, and the first segment starts at 0;
 *  - entries are contiguous and gap-free: each segment's span runs until the
 *    next segment begins, so the inter-segment pause is folded into the
 *    preceding segment. buildInputProps turns these into frames with
 *    startFrame = round(startSeconds*fps), and buildChunkPlan tiles the timeline
 *    from consecutive startFrames — a gap or overlap here desyncs every frame
 *    after it against the one continuous audio track.
 *
 * Because every offset is derived from the same measured durations that produced
 * the audio, the timing matches the waveform to the sample; totalDurationSeconds
 * is the exact end of the last segment's audio.
 */
export function buildSegmentTiming(jobId: string, pieces: readonly TimelinePiece[]): SegmentTiming {
  // Absolute start offset of each piece.
  const offsets: number[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    offsets.push(cursor);
    cursor += piece.durationSeconds;
  }
  const totalDurationSeconds = cursor;

  // Segment pieces with their start offsets, in play order.
  const segmentStarts: Array<{ id: number; start: number }> = [];
  pieces.forEach((piece, i) => {
    if (piece.kind === "segment") segmentStarts.push({ id: piece.id, start: offsets[i] });
  });

  if (segmentStarts.length === 0) {
    throw new Error("Cannot build segment timing: no segment pieces");
  }

  const segments = segmentStarts.map((seg, i) => {
    const next = segmentStarts[i + 1];
    // End at the next segment's start (folds the trailing pause in); the last
    // segment ends at the end of the whole track.
    const endSeconds = next ? next.start : totalDurationSeconds;
    return { id: seg.id, startSeconds: seg.start, endSeconds };
  });

  return { jobId, totalDurationSeconds, segments };
}

/**
 * Cheap invariant checks on the finished timing, run before it is written. These
 * are exactly the properties render-server will assume; catching a violation
 * here fails the voiceover step loudly instead of producing a video that drifts.
 */
export function assertTimingInvariants(timing: SegmentTiming, expectedSegmentIds: readonly number[]): void {
  const ids = timing.segments.map((s) => s.id);
  if (ids.length !== expectedSegmentIds.length || ids.some((id, i) => id !== expectedSegmentIds[i])) {
    throw new Error(
      `segment-timing ids ${JSON.stringify(ids)} do not match the script's segment ids ${JSON.stringify(expectedSegmentIds)}`,
    );
  }
  if (timing.segments[0].startSeconds !== 0) {
    throw new Error(`First segment must start at 0, got ${timing.segments[0].startSeconds}`);
  }
  for (let i = 0; i < timing.segments.length; i++) {
    const s = timing.segments[i];
    if (s.endSeconds <= s.startSeconds) {
      throw new Error(`Segment ${s.id} has a non-positive span [${s.startSeconds}, ${s.endSeconds}]`);
    }
    if (i > 0 && Math.abs(s.startSeconds - timing.segments[i - 1].endSeconds) > 1e-6) {
      throw new Error(
        `Timeline is not contiguous between segment ${timing.segments[i - 1].id} and ${s.id}: ` +
          `${timing.segments[i - 1].endSeconds} != ${s.startSeconds}`,
      );
    }
  }
  const lastEnd = timing.segments[timing.segments.length - 1].endSeconds;
  if (Math.abs(lastEnd - timing.totalDurationSeconds) > 1e-6) {
    throw new Error(`Last segment ends at ${lastEnd} but total duration is ${timing.totalDurationSeconds}`);
  }
}
