import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  JobStore,
  createLogger,
  scriptSchema,
  mediaManifestSchema,
  type MediaAsset,
  type MediaManifest,
  type Script,
} from "@ai-news/shared";
import { config } from "./config.js";
import { EMPTY_MEDIA_USAGE, MEDIA_USAGE_KEY, recordUsage, selectForSegment } from "./dedupe.js";
import { downloadClip, probeClip } from "./download.js";
import { licenseFor } from "./license.js";
import { searchPexels } from "./providers/pexels.js";
import { searchPixabay } from "./providers/pixabay.js";
import { buildSearchQuery, extractKeywords } from "./query.js";
import { rankCandidates } from "./rank.js";
import type { Candidate, ScoredCandidate } from "./types.js";
import { assetKey } from "./types.js";

const mediaUsageStateSchema = z.object({ recentAssetIds: z.array(z.string()) });

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `script.json`, and for EVERY segment (opening and outro included —
 * render-server maps a clip onto every entry in `script.segments`, not just the
 * body) searches Pexels and Pixabay concurrently against the segment's
 * `visualCue`, ranks the merged pool for relevance/orientation/duration/
 * resolution, and downloads the best clip plus `config.alternativesCount`
 * runners-up. Writes `media/media-manifest.json` and every clip file under
 * `media/`.
 *
 * Depends only on `script.json`, so it can run in parallel with
 * voiceover/caption-sync once script-generator has finished
 * (docs/PIPELINE.md).
 */
export async function runMediaSourcing(jobId: string): Promise<void> {
  const logger = createLogger("media-sourcing");
  const store = JobStore.fromEnv();

  const script: Script = await store.getJson(store.jobKey(jobId, "script.json"), scriptSchema);
  const usage = (await store.getJsonIfExists(MEDIA_USAGE_KEY, mediaUsageStateSchema)) ?? EMPTY_MEDIA_USAGE;

  const work = await mkdtemp(join(tmpdir(), `media-sourcing-${jobId}-`));
  try {
    const pickedThisJob: Candidate[] = [];
    const clips: MediaAsset[] = [];

    for (const segment of script.segments) {
      const query = buildSearchQuery(segment.visualCue);
      const keywords = extractKeywords(segment.visualCue);

      const [pexelsResult, pixabayResult] = await Promise.allSettled([searchPexels(query), searchPixabay(query)]);
      const merged: Candidate[] = [];
      if (pexelsResult.status === "fulfilled") merged.push(...pexelsResult.value);
      else logger.warn({ jobId, segmentId: segment.id, error: pexelsResult.reason?.message }, "Pexels search failed for this segment");
      if (pixabayResult.status === "fulfilled") merged.push(...pixabayResult.value);
      else logger.warn({ jobId, segmentId: segment.id, error: pixabayResult.reason?.message }, "Pixabay search failed for this segment");

      if (merged.length === 0) {
        throw new Error(
          `No stock footage found for segment ${segment.id} (query "${query}") from either provider — ` +
            "cannot ship a segment with no clip.",
        );
      }

      const ranked: ScoredCandidate[] = rankCandidates(merged, keywords, segment.estSeconds);
      const selected = selectForSegment(ranked, pickedThisJob, usage, config.alternativesCount + 1);
      if (selected.length === 0) {
        throw new Error(`Dedupe left zero usable candidates for segment ${segment.id} (query "${query}")`);
      }

      const [primary, ...alternatives] = selected;
      logger.info(
        {
          jobId,
          segmentId: segment.id,
          query,
          candidates: merged.length,
          picked: `${primary.provider}:${primary.id}`,
          score: Number(primary.score.toFixed(3)),
          alternatives: alternatives.length,
        },
        "Selected clip for segment",
      );

      const primaryFile = `clip-${segment.id}.mp4`;
      const primaryDuration = await downloadAndUpload(store, jobId, work, primary, primaryFile, logger);

      const altAssets = [];
      for (let i = 0; i < alternatives.length; i++) {
        const file = `clip-${segment.id}-alt${i + 1}.mp4`;
        const altDuration = await downloadAndUpload(store, jobId, work, alternatives[i], file, logger);
        altAssets.push({ file, license: licenseFor(alternatives[i]), durationSeconds: altDuration });
      }

      clips.push({
        segmentId: segment.id,
        file: primaryFile,
        license: licenseFor(primary),
        durationSeconds: primaryDuration,
        alternatives: altAssets,
      });
      pickedThisJob.push(primary, ...alternatives);
    }

    // Music/SFX sourcing is out of scope for this pass — buildInputProps
    // already treats a null music track as silence (musicSrc: "").
    const manifest: MediaManifest = mediaManifestSchema.parse({
      jobId,
      clips,
      music: null,
      sfx: [],
    });
    await store.putJson(store.jobKey(jobId, "media/media-manifest.json"), manifest);

    const nextUsage = recordUsage(usage, pickedThisJob.map(assetKey));
    await store.putJson(MEDIA_USAGE_KEY, nextUsage);

    logger.info(
      { jobId, segments: clips.length, totalClips: clips.reduce((n, c) => n + 1 + c.alternatives.length, 0) },
      "Wrote media/media-manifest.json",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Returns the real, ffprobe-measured duration — not the provider's own
 * metadata — since that's what render-server's media timeline (trim/sequence
 * logic) is built from. Trusting the provider's claimed duration would risk a
 * render-time mismatch against the actual decodable footage.
 */
async function downloadAndUpload(
  store: JobStore,
  jobId: string,
  workDir: string,
  candidate: Candidate,
  file: string,
  logger: ReturnType<typeof createLogger>,
): Promise<number> {
  const localPath = join(workDir, file);
  await downloadClip(candidate.downloadUrl, localPath);
  const probed = await probeClip(localPath);
  if (probed.durationSeconds < 0.5) {
    throw new Error(`Downloaded clip ${file} (${candidate.provider}:${candidate.id}) is unusably short (${probed.durationSeconds}s)`);
  }
  await store.putFile(store.jobKey(jobId, `media/${file}`), localPath, "video/mp4");
  logger.debug({ jobId, file, provider: candidate.provider, width: probed.width, height: probed.height, durationSeconds: probed.durationSeconds }, "Downloaded and uploaded clip");
  return probed.durationSeconds;
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: node dist/index.js <jobId>");
    process.exit(1);
  }
  runMediaSourcing(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
