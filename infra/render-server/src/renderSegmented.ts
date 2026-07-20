import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderMedia, selectComposition, type RenderMediaOptions } from "@remotion/renderer";
import type { Logger } from "@ai-news/shared";
import type { NewsVideoRenderProps } from "./buildInputProps.js";
import { concatVideoChunks, muxAudioOntoVideo } from "./ffmpeg.js";
import { buildChunkPlan, selectDirtyChunks, type ChunkPlan, type RenderChunk } from "./segmentPlan.js";

export const AUDIO_CACHE_FILE = "audio.wav";

/**
 * Encoder settings pinned across every chunk. The concat demuxer stream-copies,
 * which requires byte-compatible streams — letting any of these drift between
 * chunks would make the join either fail or silently re-time.
 */
const SHARED_ENCODE_OPTIONS = {
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 18,
} satisfies Partial<RenderMediaOptions>;

export interface SegmentedRenderOptions {
  serveUrl: string;
  compositionId: string;
  inputProps: NewsVideoRenderProps;
  /** Holds per-chunk mp4s + audio.wav between renders; the targeted-re-render cache. */
  cacheDir: string;
  outputPath: string;
  /**
   * Segment ids whose visuals changed. Omit for a cold render (everything).
   * The audio track is reused as-is — a voice change alters every segment's
   * timing and must go through a full re-render instead.
   */
  changedSegmentIds?: readonly number[];
  /** Parallel frame workers; undefined lets Remotion pick from the CPU count. */
  concurrency?: number;
  logger: Logger;
}

export interface SegmentedRenderResult {
  plan: ChunkPlan;
  renderedChunkIds: string[];
  reusedChunkIds: string[];
  durationInFrames: number;
  fps: number;
}

export async function renderSegmented(options: SegmentedRenderOptions): Promise<SegmentedRenderResult> {
  const { serveUrl, compositionId, inputProps, cacheDir, outputPath, changedSegmentIds, concurrency, logger } = options;

  const plan = buildChunkPlan(inputProps);
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps: inputProps as unknown as Record<string, unknown>,
  });

  // The plan is derived from inputProps; the composition derives its own length
  // the same way. If they disagree, every frame after the discrepancy is offset
  // against the audio — fail before writing anything.
  if (composition.durationInFrames !== plan.totalDurationInFrames) {
    throw new Error(
      `Chunk plan covers ${plan.totalDurationInFrames} frames but the composition is ` +
        `${composition.durationInFrames} frames — refusing to stitch a desynced video`,
    );
  }

  const audioPath = join(cacheDir, AUDIO_CACHE_FILE);
  const isColdRender = changedSegmentIds === undefined;
  const chunksToRender: RenderChunk[] = isColdRender
    ? plan.chunks
    : selectDirtyChunks(plan, inputProps, changedSegmentIds);
  const chunkIdsToRender = new Set(chunksToRender.map((c) => c.id));

  // Any chunk we're not re-rendering has to already exist, or the concat would
  // silently produce a shorter video.
  for (const chunk of plan.chunks) {
    if (!chunkIdsToRender.has(chunk.id) && !existsSync(chunkPath(cacheDir, chunk))) {
      throw new Error(`Cache miss: chunk "${chunk.id}" is not being re-rendered but has no cached file`);
    }
  }

  logger.info(
    {
      totalChunks: plan.chunks.length,
      rendering: chunksToRender.map((c) => c.id),
      mode: isColdRender ? "cold" : "targeted",
    },
    "Segmented render plan",
  );

  // --- Audio: rendered once, for the whole timeline, never cut at a boundary.
  if (isColdRender || !existsSync(audioPath)) {
    await renderMedia({
      composition,
      serveUrl,
      codec: "wav",
      outputLocation: audioPath,
      inputProps: inputProps as unknown as Record<string, unknown>,
    });
    logger.info({ audioPath }, "Rendered continuous audio track");
  } else {
    logger.info("Reusing cached audio track (visual-only change)");
  }

  // --- Video chunks: rendered muted, at absolute frame ranges.
  for (const chunk of chunksToRender) {
    await renderMedia({
      ...SHARED_ENCODE_OPTIONS,
      composition,
      serveUrl,
      // Remotion's frameRange is inclusive at both ends; chunk.endFrame is exclusive.
      frameRange: [chunk.startFrame, chunk.endFrame - 1],
      muted: true,
      concurrency,
      outputLocation: chunkPath(cacheDir, chunk),
      inputProps: inputProps as unknown as Record<string, unknown>,
    });
    logger.info({ chunk: chunk.id, frames: chunk.endFrame - chunk.startFrame }, "Rendered chunk");
  }

  // --- Stitch: concat video, then mux the untouched audio over the top.
  const concatPath = join(cacheDir, "video-concat.mp4");
  await concatVideoChunks(
    plan.chunks.map((chunk) => chunkPath(cacheDir, chunk)),
    cacheDir,
    concatPath,
  );
  await muxAudioOntoVideo(concatPath, audioPath, outputPath);

  return {
    plan,
    renderedChunkIds: chunksToRender.map((c) => c.id),
    reusedChunkIds: plan.chunks.filter((c) => !chunkIdsToRender.has(c.id)).map((c) => c.id),
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
  };
}

export function chunkPath(cacheDir: string, chunk: RenderChunk): string {
  return join(cacheDir, `${chunk.id}.mp4`);
}
