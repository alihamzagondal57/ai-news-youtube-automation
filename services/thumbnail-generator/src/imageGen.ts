import { writeFile } from "node:fs/promises";
import { InferenceClient } from "@huggingface/inference";
import { config } from "./config.js";

/** Apache-2.0, unrestricted commercial use — see docs/LICENSING.md §3.6. */
const MODEL_ID = "black-forest-labs/FLUX.1-schnell";

export interface GenerateTopicImageResult {
  success: boolean;
  /** Present when success is false: missing token, exhausted free credit, rate limit, network error, etc. */
  reason?: string;
}

/**
 * Generates a topic-relevant background image via FLUX.1 [schnell] through
 * Hugging Face's Inference Providers.
 *
 * Never throws. A billing/rate-limit/availability failure is an EXPECTED
 * condition here — this pipeline runs on the free monthly credit only, with
 * no payment method configured (docs/LICENSING.md §3.6), so running dry some
 * months is by design, not a bug. The caller (index.ts) falls back to the
 * real-frame/gradient backdrop instead of failing the job.
 */
export async function generateTopicImage(prompt: string, outputPath: string): Promise<GenerateTopicImageResult> {
  if (!config.huggingFaceToken) {
    return { success: false, reason: "HUGGINGFACE_API_TOKEN is not configured" };
  }

  try {
    const client = new InferenceClient(config.huggingFaceToken);
    // No width/height requested: ThemedBackdrop's <Img objectFit: "cover">
    // already scales/crops an arbitrary-sized source into the 1280x720
    // canvas — the same mechanism that already handles stock clips and
    // extracted video frames of whatever size they come in at.
    //
    // outputType must be explicit: textToImage is overloaded on it ("url" |
    // "dataUrl" | "blob" | "json"), and with the param omitted entirely
    // TypeScript resolves to the FIRST overload (Promise<string>) rather
    // than the Blob one the JS SDK's own README example uses.
    const imageBlob = await client.textToImage({ model: MODEL_ID, inputs: prompt }, { outputType: "blob" });
    const buffer = Buffer.from(await imageBlob.arrayBuffer());
    await writeFile(outputPath, buffer);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, reason: message };
  }
}
