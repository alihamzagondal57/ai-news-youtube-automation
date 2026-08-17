import { z } from "zod";
import { renderStyleSchema, segmentClipOverrideSchema, type JobStore, type RenderStyle, type SegmentClipOverride } from "@ai-news/shared";

// Only the two fields this module cares about, same reasoning as
// themeSelection.ts's own narrow reviewOverrideSchema: a malformed or
// incomplete review-state.json in some OTHER field (say, a bad themeId)
// shouldn't break clip/style resolution, and vice versa. The sub-schemas
// themselves are reused verbatim from @ai-news/shared rather than
// re-declared, so the actual (nested, more drift-prone) shape can't diverge
// from the one the dashboard writes and youtube-uploader's full read expects.
const resolutionSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable().default(null);

const reviewClipStyleSchema = z
  .object({
    clipOverrides: z.array(segmentClipOverrideSchema).default([]),
    style: renderStyleSchema.default({}),
    resolution: resolutionSchema,
  })
  .passthrough();

export interface ReviewOverrides {
  clipOverrides: SegmentClipOverride[];
  style: RenderStyle;
  /** Per-job resolution override (see the review dashboard's "New job" screen) — null uses render-server's own config default. */
  resolution: { width: number; height: number } | null;
}

const EMPTY_OVERRIDES: ReviewOverrides = { clipOverrides: [], style: {}, resolution: null };

/** Reads the clip-swap, style, and resolution overrides a reviewer set in the dashboard, if any. Missing review-state.json (or any field unset) is the ordinary case, not an error. */
export async function resolveReviewOverrides(store: JobStore, jobId: string): Promise<ReviewOverrides> {
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewClipStyleSchema);
  if (!reviewState) return EMPTY_OVERRIDES;
  return { clipOverrides: reviewState.clipOverrides, style: reviewState.style, resolution: reviewState.resolution };
}
