import { z } from "zod";

/**
 * What the LLM is asked to return.
 *
 * Deliberately NOT the same shape as `script.json`: the model produces the
 * opening and outro as separate fields (they have their own word budgets and
 * directives in the structural brief), and `estSeconds` is computed from the
 * generated text rather than asked for — models are unreliable at estimating
 * their own speaking time, and voiceover replaces the estimate with real
 * timings anyway. assembleScript() maps this into the pipeline contract.
 */
export const generatedSegmentSchema = z.object({
  text: z.string().min(1),
  headline: z.string().min(1),
  visualCue: z.string().min(1),
  /** The specific added context/analysis/implication — validated, not spoken. */
  insight: z.string().min(1),
});

export const generatedScriptSchema = z.object({
  title: z.string().min(1),
  opening: z.string().min(1),
  segments: z.array(generatedSegmentSchema).min(1),
  outro: z.string().min(1),
});

export type GeneratedScriptRaw = z.infer<typeof generatedScriptSchema>;

/** Post-parse shape with stable segment ids attached. */
export interface GeneratedScript {
  title: string;
  opening: string;
  outro: string;
  segments: Array<z.infer<typeof generatedSegmentSchema> & { id: number }>;
}

export function withSegmentIds(raw: GeneratedScriptRaw): GeneratedScript {
  return {
    ...raw,
    segments: raw.segments.map((segment, index) => ({ ...segment, id: index })),
  };
}

/**
 * Extracts a JSON object from a model response.
 *
 * Both providers are asked for bare JSON, but models still wrap it in prose or
 * markdown fences often enough that failing the whole generation over it would
 * waste a call. Falls back to the outermost brace-balanced span.
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
