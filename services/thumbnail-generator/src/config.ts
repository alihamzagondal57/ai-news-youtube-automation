import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  // Sibling workspace, not a dependency — same reasoning as render-server's
  // config.ts: Remotion compositions must stay free of this service's
  // Node-only deps (ffmpeg-static, ffprobe-static, the AWS SDK).
  remotionEntryPoint: join(__dirname, "..", "..", "..", "remotion", "src", "index.ts"),
  remotionCompositionId: "Thumbnail",

  width: Number(process.env.THUMBNAIL_WIDTH ?? 1280),
  height: Number(process.env.THUMBNAIL_HEIGHT ?? 720),

  branding: {
    channelName: process.env.CHANNEL_NAME ?? "NationScope",
  },

  /**
   * A Hugging Face User Access Token (fine-grained, "Make calls to Inference
   * Providers" permission) for the AI-generated background image (FLUX.1
   * [schnell] — docs/LICENSING.md §3.6). Deliberately OPTIONAL, not
   * requireEnv'd: this pipeline uses only the free monthly credit, no
   * payment method configured, so running dry is an expected, not
   * exceptional, condition. Missing or exhausted, imageGen.ts falls back to
   * the real-frame/gradient backdrop rather than failing the job.
   */
  huggingFaceToken: process.env.HUGGINGFACE_API_TOKEN || null,

  /**
   * The representative frame is picked from several candidates spread across
   * the middle of render.mp4 (skipping marginFraction at both ends — the
   * intro stinger and the outro card), keeping whichever candidate looks
   * most visually detailed (see frame.ts's pickBestFrame). No dependency on
   * segment-timing.json as an input.
   */
  frame: {
    candidateCount: Number(process.env.THUMBNAIL_FRAME_CANDIDATES ?? 6),
    marginFraction: Number(process.env.THUMBNAIL_FRAME_MARGIN_FRACTION ?? 0.1),
  },
};
