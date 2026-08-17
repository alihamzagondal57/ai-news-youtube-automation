import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { type JobStore, type Logger, type RenderResult } from "@ai-news/shared";
import { buildInputProps } from "./buildInputProps.js";
import { config } from "./config.js";
import { downloadReferencedMedia, readJobManifests } from "./jobAssets.js";
import { AUDIO_CACHE_FILE, chunkPath, renderSegmented } from "./renderSegmented.js";
import { resolveReviewOverrides } from "./reviewOverrides.js";
import { buildChunkPlan } from "./segmentPlan.js";
import { resolveJobTheme } from "./themeSelection.js";

/** Per-segment render cache, so a clip swap re-renders three chunks instead of the whole video. */
const RENDER_CACHE_PREFIX = "renders";

export interface RunRenderOptions {
  /**
   * Segment ids whose visuals changed, for a targeted re-render from the review
   * dashboard. Omit for a cold render. A voice change must NOT come through
   * here — new narration shifts every segment's timing, so it needs a full
   * re-render (omit this to rebuild everything).
   */
  changedSegmentIds?: readonly number[];
}

export async function runRender(
  store: JobStore,
  jobId: string,
  logger: Logger,
  options: RunRenderOptions = {},
): Promise<RenderResult> {
  const assets = await readJobManifests(store, jobId);
  logger.info({ jobId, dir: assets.dir }, "Read job manifests");

  const cacheDir = join(assets.dir, "render-cache");
  await mkdir(cacheDir, { recursive: true });

  try {
    // Resolved before rendering because it decides the whole video's look — and
    // it is sticky per job, so a targeted re-render can't silently re-skin the
    // video and invalidate the chunk cache it is about to reuse.
    const themeId = await resolveJobTheme(store, jobId, logger);
    const { clipOverrides, style, resolution } = await resolveReviewOverrides(store, jobId);
    const inputProps = buildInputProps(assets, { themeId, clipOverrides, style, resolution });
    const { changedSegmentIds } = options;

    if (clipOverrides.length > 0 || Object.keys(style).length > 0 || resolution) {
      logger.info(
        { jobId, clipOverrides: clipOverrides.map((o) => o.segmentId), styleKeys: Object.keys(style), resolution },
        "Applied review-dashboard clip/style/resolution overrides",
      );
    }

    // Only after inputProps exists do we know which clips it actually
    // references (a segment whose stock clip already covers it never touches
    // its alternatives) — download exactly those, not everything in the manifest.
    await downloadReferencedMedia(store, jobId, assets.dir, inputProps);
    logger.info({ jobId }, "Downloaded referenced media");

    // A targeted re-render is only meaningful if the previous chunks are still
    // around; pull whatever this job cached last time.
    if (changedSegmentIds !== undefined) {
      await restoreRenderCache(store, jobId, cacheDir, logger);
    }

    const bundleLocation = await bundle({
      entryPoint: config.remotionEntryPoint,
      publicDir: assets.dir,
    });
    logger.info({ jobId }, "Bundled Remotion project");

    const outputLocation = join(assets.dir, "render.mp4");
    const result = await renderSegmented({
      serveUrl: bundleLocation,
      compositionId: config.remotionCompositionId,
      inputProps,
      cacheDir,
      outputPath: outputLocation,
      changedSegmentIds,
      concurrency: config.renderConcurrency,
      logger: logger.child({ jobId }),
    });
    logger.info(
      { jobId, rendered: result.renderedChunkIds, reused: result.reusedChunkIds },
      "Render complete, uploading result",
    );

    const renderKey = store.jobKey(jobId, "render.mp4");
    await store.putFile(renderKey, outputLocation, "video/mp4");
    await persistRenderCache(store, jobId, cacheDir, result.renderedChunkIds, logger);

    return {
      jobId,
      status: "completed",
      renderKey,
      durationSeconds: result.durationInFrames / result.fps,
      error: null,
    };
  } finally {
    await rm(assets.dir, { recursive: true, force: true });
  }
}

/** Pulls the previously cached chunks + audio track for this job into the local cache dir. */
async function restoreRenderCache(store: JobStore, jobId: string, cacheDir: string, logger: Logger): Promise<void> {
  const prefix = store.jobKey(jobId, `${RENDER_CACHE_PREFIX}/`);
  const keys = await store.listKeys(prefix);
  await Promise.all(keys.map((key) => store.downloadToFile(key, join(cacheDir, basename(key)))));
  logger.info({ jobId, restored: keys.length }, "Restored render cache from store");
}

/**
 * Uploads only what actually changed: the re-rendered chunks, plus the audio
 * track the first time it exists. Cached chunks that were reused are already in
 * the store and identical.
 */
async function persistRenderCache(
  store: JobStore,
  jobId: string,
  cacheDir: string,
  renderedChunkIds: readonly string[],
  logger: Logger,
): Promise<void> {
  const uploads = renderedChunkIds.map((id) =>
    store.putFile(store.jobKey(jobId, `${RENDER_CACHE_PREFIX}/${id}.mp4`), join(cacheDir, `${id}.mp4`), "video/mp4"),
  );
  uploads.push(
    store.putFile(
      store.jobKey(jobId, `${RENDER_CACHE_PREFIX}/${AUDIO_CACHE_FILE}`),
      join(cacheDir, AUDIO_CACHE_FILE),
      "audio/wav",
    ),
  );
  await Promise.all(uploads);
  logger.info({ jobId, cached: renderedChunkIds.length }, "Persisted render cache to store");
}

export { buildChunkPlan, chunkPath };
