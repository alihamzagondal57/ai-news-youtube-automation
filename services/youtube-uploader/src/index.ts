import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, createLogger, metadataSchema, reviewStateSchema, youtubeResultSchema } from "@ai-news/shared";
import type { youtube_v3 } from "googleapis";
import { createYoutubeClient } from "./auth.js";
import { config } from "./config.js";
import { QUOTA_COSTS } from "./quota.js";
import { addToPlaylist, setThumbnail, uploadVideo } from "./youtube.js";

export interface RunYoutubeUploadOptions {
  /**
   * Injectable YouTube API client — defaults to a real OAuth2-authenticated
   * client. Overridable so tests can exercise the real gating/request/quota/
   * artifact-I/O logic without ever calling the real, quota-limited,
   * side-effectful YouTube API.
   */
  client?: youtube_v3.Youtube;
}

/**
 * Pipeline entry point, invoked per job by GitHub Actions — the final step,
 * and the only one gated on human approval rather than just its own inputs
 * existing (see docs/REVIEW-DASHBOARD.md).
 *
 * Uploads render.mp4 with metadata.json's title/description/tags and the
 * mandatory synthetic-content disclosure, sets thumbnail.png as the custom
 * thumbnail, optionally adds the video to a configured playlist, and writes
 * jobs/{jobId}/youtube-result.json either way.
 */
export async function runYoutubeUpload(jobId: string, options: RunYoutubeUploadOptions = {}): Promise<void> {
  const logger = createLogger("youtube-uploader");
  const store = JobStore.fromEnv();
  const client = options.client ?? createYoutubeClient();

  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewStateSchema);
  if (!reviewState || reviewState.status !== "approved") {
    throw new Error(
      `Job ${jobId} is not approved for upload (review-state.json status: ${reviewState?.status ?? "MISSING"}). ` +
        'youtube-uploader only runs once the review gate sets status to "approved" — see docs/REVIEW-DASHBOARD.md.',
    );
  }

  const metadata = await store.getJson(store.jobKey(jobId, "metadata.json"), metadataSchema);

  const work = await mkdtemp(join(tmpdir(), `youtube-upload-${jobId}-`));
  let quotaUnitsUsed = 0;
  try {
    const videoPath = join(work, "render.mp4");
    const thumbnailPath = join(work, "thumbnail.png");
    await Promise.all([
      store.downloadToFile(store.jobKey(jobId, "render.mp4"), videoPath),
      store.downloadToFile(store.jobKey(jobId, "thumbnail.png"), thumbnailPath),
    ]);

    let videoId: string;
    try {
      logger.info({ jobId, title: metadata.title }, "Uploading video to YouTube");
      const uploaded = await uploadVideo(client, {
        videoPath,
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        containsSyntheticMedia: metadata.containsSyntheticMedia,
      });
      videoId = uploaded.videoId;
      quotaUnitsUsed += QUOTA_COSTS.videosInsert;
      logger.info({ jobId, videoId }, "Video uploaded");

      await setThumbnail(client, videoId, thumbnailPath);
      quotaUnitsUsed += QUOTA_COSTS.thumbnailsSet;
      logger.info({ jobId, videoId }, "Thumbnail set");

      if (config.playlistId) {
        await addToPlaylist(client, videoId, config.playlistId);
        quotaUnitsUsed += QUOTA_COSTS.playlistItemsInsert;
        logger.info({ jobId, videoId, playlistId: config.playlistId }, "Added to playlist");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = youtubeResultSchema.parse({
        jobId,
        videoId: null,
        url: null,
        status: "failed",
        quotaUnitsUsed,
        error: message,
      });
      await store.putJson(store.jobKey(jobId, "youtube-result.json"), failed);
      throw new Error(`YouTube upload failed for job ${jobId} after using ${quotaUnitsUsed} quota units: ${message}`);
    }

    const result = youtubeResultSchema.parse({
      jobId,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      status: "uploaded",
      quotaUnitsUsed,
      error: null,
    });
    await store.putJson(store.jobKey(jobId, "youtube-result.json"), result);
    logger.info({ jobId, videoId, url: result.url, quotaUnitsUsed }, "Wrote youtube-result.json");
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
  runYoutubeUpload(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
