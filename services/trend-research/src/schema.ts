import { z } from "zod";

/**
 * What the ranking LLM call is responsible for: picking the topic and writing
 * the source summaries. `sourceIndices` names which candidates (by position
 * in the list the prompt showed it) it actually drew on, so index.ts can map
 * back to real URLs without asking the model to reproduce them verbatim
 * (models mangle long URLs; indices don't).
 */
export const generatedTrendSchema = z.object({
  topic: z.string().min(1),
  angle: z.string().min(1),
  sourceIndices: z.array(z.number().int().nonnegative()).min(1),
  /** Same order and length as sourceIndices — one paraphrased summary per chosen source. */
  sourceSummaries: z.array(z.string().min(1)).min(1),
});
export type GeneratedTrend = z.infer<typeof generatedTrendSchema>;

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}
