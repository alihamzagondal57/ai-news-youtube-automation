import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { JobStore, createLogger, scriptSchema, type Logger, type Script } from "@ai-news/shared";
import { DEFAULT_THEME_ID } from "@ai-news/shared/theme";
import { z } from "zod";
import { config } from "./config.js";
import { pickBestFrame, probeVideoDurationSeconds } from "./frame.js";
import { deriveThumbnailHeadline } from "./headline.js";
import { generateTopicImage, type GenerateTopicImageResult } from "./imageGen.js";
import { buildImagePrompt } from "./prompt.js";
import { renderThumbnailStill } from "./render.js";

type GenerateImageFn = (prompt: string, outputPath: string) => Promise<GenerateTopicImageResult>;

const jobThemeSchema = z.object({ themeId: z.string() });
const IMAGE_FILE = "thumbnail-background.png";

/** Mirrors JobStore's own not-found check (services/shared/src/job-store/r2.ts) — not exported, so re-derived here for the one raw-file case JobStore's typed helpers don't cover. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

interface BackgroundResolution {
  /** Filename relative to `work`, or "" for the theme's own gradient (ThemedBackdrop's built-in fallback). */
  src: string;
  source: "ai-image" | "video-frame" | "gradient";
}

/**
 * Three-tier background, in priority order:
 *
 *   1. An AI-generated, topic-relevant image (FLUX.1 [schnell] — see
 *      docs/LICENSING.md §3.6) from a prompt built off the script itself.
 *      Runs on Hugging Face's free monthly credit only, no payment method
 *      configured on purpose, so this is EXPECTED to become unavailable some
 *      months — that's not a bug, see imageGen.ts.
 *   2. A real frame from `render.mp4`, if AI generation was unavailable and
 *      the video has actually been rendered.
 *   3. The theme's own gradient (ThemedBackdrop's built-in fallback for
 *      empty media — nothing to do here, just pass through "").
 *
 * Every tier degrades to the next rather than failing the job.
 */
async function resolveBackground(
  jobId: string,
  script: Pick<Script, "title" | "segments">,
  store: JobStore,
  work: string,
  logger: Logger,
  generateImage: GenerateImageFn,
): Promise<BackgroundResolution> {
  const prompt = buildImagePrompt(script);
  const generated = await generateImage(prompt, join(work, IMAGE_FILE));
  if (generated.success) {
    logger.info({ jobId, prompt }, "Generated AI topic-image background (FLUX.1 [schnell])");
    return { src: IMAGE_FILE, source: "ai-image" };
  }
  logger.warn(
    { jobId, reason: generated.reason },
    "AI image generation unavailable — falling back to a real render.mp4 frame",
  );

  try {
    const videoPath = join(work, "render.mp4");
    await store.downloadToFile(store.jobKey(jobId, "render.mp4"), videoPath);

    const durationSeconds = await probeVideoDurationSeconds(videoPath);
    const best = await pickBestFrame(videoPath, durationSeconds, work, config.frame);

    logger.info(
      { jobId, timestampSeconds: Number(best.timestampSeconds.toFixed(2)), durationSeconds: Number(durationSeconds.toFixed(1)) },
      "Picked most visually detailed candidate frame from render.mp4",
    );
    return { src: basename(best.outputPath), source: "video-frame" };
  } catch (err) {
    if (!isNotFound(err)) throw err;
    logger.info({ jobId }, "No render.mp4 either — falling back to a themed still with no background image");
    return { src: "", source: "gradient" };
  }
}

export interface RunThumbnailGenerationOptions {
  /**
   * Injectable AI-image step — defaults to the real FLUX.1 [schnell] call.
   * Overridable so tests can force the tier-2/tier-3 fallback path
   * deterministically, regardless of whether a real HUGGINGFACE_API_TOKEN
   * happens to be configured in the environment (same reasoning as
   * youtube-uploader's injectable client).
   */
  generateImage?: GenerateImageFn;
}

/**
 * Pipeline entry point, invoked per job by GitHub Actions, after `render`.
 *
 * Composes `jobs/{jobId}/thumbnail.png` from the job's own theme (palette +
 * fonts, for visual consistency with the video itself), the opening
 * segment's on-screen headline, and a background resolved through the
 * three-tier fallback above.
 */
export async function runThumbnailGeneration(jobId: string, options: RunThumbnailGenerationOptions = {}): Promise<void> {
  const logger = createLogger("thumbnail-generator");
  const store = JobStore.fromEnv();
  const generateImage = options.generateImage ?? generateTopicImage;

  const work = await mkdtemp(join(tmpdir(), `thumbnail-${jobId}-`));
  try {
    const script = await store.getJson(store.jobKey(jobId, "script.json"), scriptSchema);
    const jobTheme = await store.getJsonIfExists(store.jobKey(jobId, "theme.json"), jobThemeSchema);
    const themeId = jobTheme?.themeId ?? DEFAULT_THEME_ID;

    const { text: headline, fontSizePx } = deriveThumbnailHeadline(script);
    const background = await resolveBackground(jobId, script, store, work, logger, generateImage);

    const outputPath = join(work, "thumbnail.png");
    await renderThumbnailStill({
      publicDir: work,
      inputProps: {
        themeId,
        headline,
        channelName: config.branding.channelName,
        backgroundFrameSrc: background.src,
        fontSizePx,
      },
      outputPath,
    });

    await store.putFile(store.jobKey(jobId, "thumbnail.png"), outputPath, "image/png");
    logger.info(
      { jobId, themeId, headline, fontSizePx, backgroundSource: background.source },
      "Wrote thumbnail.png",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: node dist/index.js <jobId>");
    process.exit(1);
  }
  runThumbnailGeneration(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
