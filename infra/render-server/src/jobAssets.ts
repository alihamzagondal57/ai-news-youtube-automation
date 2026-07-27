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
import type { NewsVideoRenderProps } from "./buildInputProps.js";

export interface JobAssets {
  dir: string;
  script: Script;
  segmentTiming: SegmentTiming;
  captions: Captions;
  mediaManifest: MediaManifest;
}

/**
 * Reads every JSON artifact render-server needs for a job — no video/audio
 * bytes yet. Deliberately separate from downloading media: `buildInputProps`
 * decides exactly which clips a job's timeline actually uses (a segment whose
 * stock clip already covers it never touches its alternatives; only a segment
 * short on footage sequences through some of them — see mediaTimeline.ts), and
 * that decision needs these JSON manifests but not the media files themselves.
 * Downloading everything up front would waste bandwidth on alternatives most
 * segments never end up needing.
 */
export async function readJobManifests(store: JobStore, jobId: string): Promise<JobAssets> {
  const dir = await mkdtemp(join(tmpdir(), `render-${jobId}-`));

  const [script, segmentTiming, captions, mediaManifest] = await Promise.all([
    store.getJson(store.jobKey(jobId, "script.json"), scriptSchema),
    store.getJson(store.jobKey(jobId, "segment-timing.json"), segmentTimingSchema),
    store.getJson(store.jobKey(jobId, "captions.json"), captionsSchema),
    store.getJson(store.jobKey(jobId, "media/media-manifest.json"), mediaManifestSchema),
  ]);

  return { dir, script, segmentTiming, captions, mediaManifest };
}

/**
 * Downloads voiceover.wav plus exactly the media files a BUILT
 * `NewsVideoRenderProps` actually references — read off `segment.media[].src`
 * rather than blindly fetching every clip and alternative in the manifest.
 * Must run after `buildInputProps`, since that's what decides the set.
 */
export async function downloadReferencedMedia(
  store: JobStore,
  jobId: string,
  dir: string,
  inputProps: NewsVideoRenderProps,
): Promise<void> {
  const files = new Set<string>();
  for (const segment of inputProps.segments) {
    for (const clip of segment.media) files.add(clip.src);
  }
  if (inputProps.audio.musicSrc) files.add(inputProps.audio.musicSrc);

  const downloads: Promise<void>[] = [
    store.downloadToFile(store.jobKey(jobId, "voiceover.wav"), join(dir, "voiceover.wav")),
    ...[...files].map((file) => store.downloadToFile(store.jobKey(jobId, `media/${file}`), join(dir, file))),
  ];
  await Promise.all(downloads);
}
