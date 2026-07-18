import { rm } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { type JobStore, type Logger, type RenderResult } from "@ai-news/shared";
import { buildInputProps } from "./buildInputProps.js";
import { config } from "./config.js";
import { downloadJobAssets } from "./jobAssets.js";

export async function runRender(store: JobStore, jobId: string, logger: Logger): Promise<RenderResult> {
  const assets = await downloadJobAssets(store, jobId);
  logger.info({ jobId, dir: assets.dir }, "Downloaded job assets");

  try {
    // Remotion's renderer APIs take inputProps as Record<string, unknown> —
    // the real type safety here is NewsVideoRenderProps at construction time
    // (buildInputProps.ts) and the composition's own zod schema at render time.
    const inputProps = buildInputProps(assets) as unknown as Record<string, unknown>;

    // Bundled per render with publicDir pointed at this job's downloaded
    // assets, so staticFile() in the composition resolves this job's
    // voiceover/clips/music without needing them checked into remotion/public.
    const bundleLocation = await bundle({
      entryPoint: config.remotionEntryPoint,
      publicDir: assets.dir,
    });
    logger.info({ jobId }, "Bundled Remotion project");

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: config.remotionCompositionId,
      inputProps,
    });

    const outputLocation = join(assets.dir, "render.mp4");

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation,
      inputProps,
      concurrency: Math.max(1, cpus().length - 1),
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0) {
          logger.info({ jobId, progress: Math.round(progress * 100) }, "Render progress");
        }
      },
    });
    logger.info({ jobId }, "Render complete, uploading result");

    const renderKey = store.jobKey(jobId, "render.mp4");
    await store.putFile(renderKey, outputLocation, "video/mp4");

    return {
      jobId,
      status: "completed",
      renderKey,
      durationSeconds: composition.durationInFrames / composition.fps,
      error: null,
    };
  } finally {
    await rm(assets.dir, { recursive: true, force: true });
  }
}
