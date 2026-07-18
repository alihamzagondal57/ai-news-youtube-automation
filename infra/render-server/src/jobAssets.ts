import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captionsSchema,
  mediaManifestSchema,
  scriptSchema,
  segmentTimingSchema,
  type Captions,
  type JobStore,
  type MediaManifest,
  type Script,
  type SegmentTiming,
} from "@ai-news/shared";

export interface JobAssets {
  dir: string;
  script: Script;
  segmentTiming: SegmentTiming;
  captions: Captions;
  mediaManifest: MediaManifest;
}

/** Downloads everything render-server needs for a job into a fresh local temp dir. */
export async function downloadJobAssets(store: JobStore, jobId: string): Promise<JobAssets> {
  const dir = await mkdtemp(join(tmpdir(), `render-${jobId}-`));

  const [script, segmentTiming, captions, mediaManifest] = await Promise.all([
    store.getJson(store.jobKey(jobId, "script.json"), scriptSchema),
    store.getJson(store.jobKey(jobId, "segment-timing.json"), segmentTimingSchema),
    store.getJson(store.jobKey(jobId, "captions.json"), captionsSchema),
    store.getJson(store.jobKey(jobId, "media/media-manifest.json"), mediaManifestSchema),
  ]);

  const downloads: Promise<void>[] = [
    store.downloadToFile(store.jobKey(jobId, "voiceover.wav"), join(dir, "voiceover.wav")),
  ];

  for (const clip of mediaManifest.clips) {
    downloads.push(store.downloadToFile(store.jobKey(jobId, `media/${clip.file}`), join(dir, clip.file)));
  }
  if (mediaManifest.music) {
    const musicFile = mediaManifest.music.file;
    downloads.push(store.downloadToFile(store.jobKey(jobId, `media/${musicFile}`), join(dir, musicFile)));
  }

  await Promise.all(downloads);

  return { dir, script, segmentTiming, captions, mediaManifest };
}
