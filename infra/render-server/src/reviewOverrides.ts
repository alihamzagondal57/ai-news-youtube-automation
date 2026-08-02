import { z } from "zod";
import { renderStyleSchema, segmentClipOverrideSchema, type JobStore, type RenderStyle, type SegmentClipOverride } from "@ai-news/shared";

// Only the two fields this module cares about, same reasoning as
// themeSelection.ts's own narrow reviewOverrideSchema: a malformed or
// incomplete review-state.json in some OTHER field (say, a bad themeId)
// shouldn't break clip/style resolution, and vice versa. The sub-schemas
// themselves are reused verbatim from @ai-news/shared rather than
// re-declared, so the actual (nested, more drift-prone) shape can't diverge
// from the one the dashboard writes and youtube-uploader's full read expects.
const reviewClipStyleSchema = z
  .object({
    clipOverrides: z.array(segmentClipOverrideSchema).default([]),
    style: renderStyleSchema.default({}),
  })
  .passthrough();

export interface ReviewOverrides {
  clipOverrides: SegmentClipOverride[];
  style: RenderStyle;
}

const EMPTY_OVERRIDES: ReviewOverrides = { clipOverrides: [], style: {} };

/** Reads the clip-swap and style overrides a reviewer set in the dashboard, if any. Missing review-state.json (or either field unset) is the ordinary case, not an error. */
export async function resolveReviewOverrides(store: JobStore, jobId: string): Promise<ReviewOverrides> {
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewClipStyleSchema);
  if (!reviewState) return EMPTY_OVERRIDES;
  return { clipOverrides: reviewState.clipOverrides, style: reviewState.style };
}
