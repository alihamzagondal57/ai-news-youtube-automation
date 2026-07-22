import { z } from "zod";

/**
 * Two-phase generation shapes.
 *
 * Phase 1 (the plan): one JSON call produces the title, the short opening and
 * outro prose, and a per-segment skeleton — headline, visualCue, and a one-line
 * `focus` telling the segment call what this segment covers. All short fields,
 * so JSON mode's length suppression doesn't bite.
 *
 * Phase 2 (the prose): one plain-text call per segment produces the long
 * `text` plus its `insight`. Splitting this out is the whole fix — asked for a
 * single focused passage, a model writes 300-500 words; asked for six at once
 * in JSON, the same model rations the budget down to ~150 each.
 */

export const planSegmentSchema = z.object({
  headline: z.string().min(1),
  visualCue: z.string().min(1),
  /** One line describing what THIS segment covers — the sub-angle handed to the prose call. */
  focus: z.string().min(1),
});

export const planSchema = z.object({
  title: z.string().min(1),
  opening: z.string().min(1),
  outro: z.string().min(1),
  segments: z.array(planSegmentSchema).min(1),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanSegment = z.infer<typeof planSegmentSchema>;

/** The assembled generated script, after both phases. Consumed by assembleScript(). */
export interface GeneratedScript {
  title: string;
  opening: string;
  outro: string;
  segments: Array<{
    id: number;
    text: string;
    headline: string;
    visualCue: string;
    insight: string;
  }>;
}

/** Marker separating a segment's prose from its declared insight in the plain-text response. */
export const INSIGHT_MARKER = "###INSIGHT###";

export interface SegmentProse {
  text: string;
  insight: string;
}

/**
 * Splits a segment prose response into passage + insight on INSIGHT_MARKER.
 *
 * A missing marker yields an empty insight rather than throwing — validation
 * then rejects it (missing_insight) and the segment is retried, which is the
 * same recovery path as any other shortfall. Uses the LAST marker so a stray
 * mention of the token inside the passage can't split it early.
 */
export function parseSegmentProse(raw: string): SegmentProse {
  const text = raw.trim();
  const idx = text.lastIndexOf(INSIGHT_MARKER);
  if (idx === -1) {
    return { text: stripCodeFences(text), insight: "" };
  }
  return {
    text: stripCodeFences(text.slice(0, idx).trim()),
    insight: text.slice(idx + INSIGHT_MARKER.length).trim(),
  };
}

/** Some models wrap plain-text prose in ``` fences despite being asked not to. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? text;
}

/**
 * Extracts a JSON object from a model response.
 *
 * Even in JSON mode, models occasionally wrap the object in prose or markdown
 * fences; failing the whole plan over that would waste a call. Falls back to the
 * outermost brace-balanced span.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();

  if (trimmed.startsWith("{")) return trimmed;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  return trimmed;
}
