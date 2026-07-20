import type { NewsVideoRenderProps } from "./buildInputProps.js";

/**
 * Fallback only, for props predating per-theme transitions. The real value comes
 * from the theme (`transition.frames`, 12-24 across the catalog) and arrives on
 * NewsVideoRenderProps.transitionFrames.
 *
 * This used to be a hardcoded 15 duplicated from the composition. That was safe
 * only while every video shared one transition length; with per-theme values a
 * theme like `oceanic` (24 frames) would bleed 9 frames further than the
 * invalidation window covered, leaving a stale clip in the crossfade on a
 * targeted re-render. Both sides now read the same catalog entry, so they cannot
 * disagree.
 */
export const DEFAULT_TRANSITION_FRAMES = 15;

export interface RenderChunk {
  /** Stable cache key / filename component, e.g. "segment-3" or "outro". */
  id: string;
  /** Inclusive. */
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

export interface ChunkPlan {
  chunks: RenderChunk[];
  contentEndFrame: number;
  totalDurationInFrames: number;
}

/**
 * Partitions the video timeline into contiguous, non-overlapping chunks that can
 * be rendered and cached independently: one per segment, plus the outro.
 *
 * Chunk boundaries are taken from consecutive segment *startFrames* rather than
 * from each segment's own duration, so the plan tiles the timeline exactly even
 * if a segment's duration doesn't perfectly abut the next one's start.
 */
export function buildChunkPlan(props: NewsVideoRenderProps): ChunkPlan {
  const { segments, outroDurationInFrames } = props;
  if (segments.length === 0) {
    throw new Error("Cannot build a chunk plan for a video with no segments");
  }

  // The composition derives its duration from the *last array element*, not the
  // latest startFrame, so an out-of-order array would silently desync the plan
  // from what Remotion actually renders.
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startFrame <= segments[i - 1].startFrame) {
      throw new Error(
        `Segments must be in ascending startFrame order: segment ${segments[i].id} ` +
          `starts at ${segments[i].startFrame}, not after segment ${segments[i - 1].id} at ${segments[i - 1].startFrame}`,
      );
    }
  }
  if (segments[0].startFrame !== 0) {
    throw new Error(`First segment must start at frame 0, got ${segments[0].startFrame}`);
  }

  const last = segments[segments.length - 1];
  const contentEndFrame = last.startFrame + last.durationInFrames;
  const totalDurationInFrames = contentEndFrame + outroDurationInFrames;

  const chunks: RenderChunk[] = segments.map((segment, i) => ({
    id: `segment-${segment.id}`,
    startFrame: segment.startFrame,
    endFrame: i < segments.length - 1 ? segments[i + 1].startFrame : contentEndFrame,
  }));

  if (outroDurationInFrames > 0) {
    chunks.push({ id: "outro", startFrame: contentEndFrame, endFrame: totalDurationInFrames });
  }

  assertPlanTilesTimeline(chunks, totalDurationInFrames);
  return { chunks, contentEndFrame, totalDurationInFrames };
}

/**
 * A gap would drop frames and a overlap would duplicate them — either desyncs
 * every frame after the fault against the untouched audio track. Cheap to check,
 * catastrophic to miss, so it's an invariant rather than a test.
 */
function assertPlanTilesTimeline(chunks: RenderChunk[], totalDurationInFrames: number): void {
  let expected = 0;
  for (const chunk of chunks) {
    if (chunk.startFrame !== expected) {
      throw new Error(
        `Chunk plan is not contiguous: expected chunk "${chunk.id}" to start at frame ${expected}, got ${chunk.startFrame}`,
      );
    }
    if (chunk.endFrame <= chunk.startFrame) {
      throw new Error(`Chunk "${chunk.id}" is empty or negative: [${chunk.startFrame}, ${chunk.endFrame})`);
    }
    expected = chunk.endFrame;
  }
  if (expected !== totalDurationInFrames) {
    throw new Error(`Chunk plan covers ${expected} frames but the video is ${totalDurationInFrames} frames`);
  }
}

/**
 * The frame ranges genuinely invalidated by changing the given segments.
 *
 * Wider than the segments themselves: the composition cross-fades segment
 * backgrounds, mounting each one SEGMENT_TRANSITION_FRAMES early and holding it
 * the same amount past its end. So a swapped clip is already fading in during
 * the *previous* segment's frames and still fading out during the *next* one's.
 * Re-rendering only the segment's own range would leave the old clip visible on
 * both sides of the join.
 */
export function computeDirtyRanges(
  props: NewsVideoRenderProps,
  changedSegmentIds: readonly number[],
  totalDurationInFrames: number,
): Array<{ startFrame: number; endFrame: number }> {
  const transitionFrames = props.transitionFrames ?? DEFAULT_TRANSITION_FRAMES;
  return changedSegmentIds.map((id) => {
    const segment = props.segments.find((s) => s.id === id);
    if (!segment) {
      throw new Error(`Cannot re-render unknown segment id ${id}`);
    }
    return {
      startFrame: Math.max(0, segment.startFrame - transitionFrames),
      endFrame: Math.min(
        totalDurationInFrames,
        segment.startFrame + segment.durationInFrames + transitionFrames,
      ),
    };
  });
}

/** Every chunk overlapping a dirty range — these must be re-rendered; the rest are reused from cache. */
export function selectDirtyChunks(plan: ChunkPlan, props: NewsVideoRenderProps, changedSegmentIds: readonly number[]): RenderChunk[] {
  const ranges = computeDirtyRanges(props, changedSegmentIds, plan.totalDurationInFrames);
  return plan.chunks.filter((chunk) =>
    ranges.some((range) => chunk.startFrame < range.endFrame && range.startFrame < chunk.endFrame),
  );
}
