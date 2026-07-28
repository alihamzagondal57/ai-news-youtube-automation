import { z } from "zod";

/** What the LLM call itself is responsible for — the creative SEO copy, not the structural fields (chapters, containsSyntheticMedia) that come from code. */
export const generatedMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  /** Bare words/phrases, no leading "#" — formatting is applied when assembling the description. */
  hashtags: z.array(z.string().min(1)).min(1),
});
export type GeneratedMetadata = z.infer<typeof generatedMetadataSchema>;

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}
