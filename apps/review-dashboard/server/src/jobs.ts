import {
  jobManifestSchema,
  mediaManifestSchema,
  scriptSchema,
  segmentTimingSchema,
  type JobStore,
  type MediaAsset,
  type SegmentClipOverride,
} from "@ai-news/shared";
import { z } from "zod";
import { config } from "./config.js";
import { getReviewState } from "./reviewState.js";

const jobThemeSchema = z.object({ themeId: z.string() });
const jobVoiceSchema = z.object({ voiceId: z.string() });

export interface JobSummary {
  jobId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Every job parked at the human review gate (job.json.currentStep === "review" — see docs/REVIEW-DASHBOARD.md). */
export async function listJobsAwaitingReview(store: JobStore): Promise<JobSummary[]> {
  const keys = (await store.listKeys("jobs/")).filter((k) => k.endsWith("/job.json"));
  const manifests = await Promise.all(keys.map((key) => store.getJsonIfExists(key, jobManifestSchema)));

  const summaries: JobSummary[] = [];
  for (const manifest of manifests) {
    if (!manifest || manifest.currentStep !== "review") continue;
    const script = await store.getJsonIfExists(store.jobKey(manifest.jobId, "script.json"), scriptSchema);
    summaries.push({
      jobId: manifest.jobId,
      title: script?.title ?? "(untitled)",
      status: manifest.status,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    });
  }
  // Oldest first — the job that's been waiting longest surfaces at the top.
  return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

interface ClipSource {
  file: string;
  url: string;
}

export interface SegmentDetail {
  id: number;
  headline: string;
  text: string;
  visualCue: string;
  startSeconds: number;
  endSeconds: number;
  /** Whichever clip actually renders right now — the review override if one is set for this segment, otherwise media-sourcing's own pick. */
  currentClip: ClipSource | null;
  /** Every other known clip for this segment (offered by media-sourcing, or the clip an override moved out of the primary slot), each swappable in. */
  alternatives: ClipSource[];
  /** Mechanical fact-check output from script-generator (see services/script-generator/src/factCheck.ts) — numbers/dates not found in the sources. Advisory only; empty when nothing was flagged. */
  factCheckWarnings: string[];
}

export interface JobDetail {
  jobId: string;
  title: string;
  status: string;
  themeId: string;
  voiceId: string;
  segments: SegmentDetail[];
  /** By the time a job reaches "review" (after render + thumbnail-generator in the pipeline order), both of these exist — presigning itself can't fail on a missing key, it's pure signing with no R2 round-trip, so a bad URL would only surface if the browser actually requests it. */
  renderUrl: string;
  thumbnailUrl: string;
  reviewState: Awaited<ReturnType<typeof getReviewState>>;
}

/** Resolves which clip is "current" vs. "alternative" for the dashboard's clip-swap UI — same override-wins reasoning as render-server's buildInputProps.ts, kept separate rather than imported since render-server isn't set up as a library other workspaces depend on. */
function resolveDisplayClips(clip: MediaAsset, override: SegmentClipOverride | undefined): { file: string; otherFiles: string[] } {
  const allFiles = [clip.file, ...clip.alternatives.map((a) => a.file)];
  if (!override) {
    const [file, ...otherFiles] = allFiles;
    return { file, otherFiles };
  }
  if (!allFiles.includes(override.file)) {
    // Stale override (e.g. media-sourcing re-ran and this file no longer
    // exists) — fall back to the manifest's own primary rather than pointing
    // the video player at a file that was never downloaded.
    const [file, ...otherFiles] = allFiles;
    return { file, otherFiles };
  }
  return { file: override.file, otherFiles: allFiles.filter((f) => f !== override.file) };
}

export async function getJobDetail(store: JobStore, jobId: string): Promise<JobDetail> {
  const [script, segmentTiming, mediaManifest, jobTheme, jobVoice, reviewState, job] = await Promise.all([
    store.getJson(store.jobKey(jobId, "script.json"), scriptSchema),
    store.getJson(store.jobKey(jobId, "segment-timing.json"), segmentTimingSchema),
    store.getJson(store.jobKey(jobId, "media/media-manifest.json"), mediaManifestSchema),
    store.getJsonIfExists(store.jobKey(jobId, "theme.json"), jobThemeSchema),
    store.getJsonIfExists(store.jobKey(jobId, "voice.json"), jobVoiceSchema),
    getReviewState(store, jobId),
    store.getJson(store.jobKey(jobId, "job.json"), jobManifestSchema),
  ]);

  const timingById = new Map(segmentTiming.segments.map((s) => [s.id, s]));
  const clipById = new Map(mediaManifest.clips.map((c) => [c.segmentId, c]));
  const overrideById = new Map(reviewState.clipOverrides.map((o) => [o.segmentId, o]));

  const presign = (file: string) => store.getPresignedUrl(store.jobKey(jobId, `media/${file}`), config.presignedUrlTtlSeconds);

  const segments: SegmentDetail[] = await Promise.all(
    script.segments.map(async (segment): Promise<SegmentDetail> => {
      const timing = timingById.get(segment.id);
      const clip = clipById.get(segment.id);
      let currentClip: ClipSource | null = null;
      let alternatives: ClipSource[] = [];
      if (clip) {
        const { file, otherFiles } = resolveDisplayClips(clip, overrideById.get(segment.id));
        currentClip = { file, url: await presign(file) };
        alternatives = await Promise.all(otherFiles.map(async (f) => ({ file: f, url: await presign(f) })));
      }
      return {
        id: segment.id,
        headline: segment.headline,
        text: segment.text,
        visualCue: segment.visualCue,
        startSeconds: timing?.startSeconds ?? 0,
        endSeconds: timing?.endSeconds ?? 0,
        currentClip,
        alternatives,
        factCheckWarnings: segment.factCheckWarnings ?? [],
      };
    }),
  );

  const [renderUrl, thumbnailUrl] = await Promise.all([
    store.getPresignedUrl(store.jobKey(jobId, "render.mp4"), config.presignedUrlTtlSeconds),
    store.getPresignedUrl(store.jobKey(jobId, "thumbnail.png"), config.presignedUrlTtlSeconds),
  ]);

  return {
    jobId,
    title: script.title,
    status: job.status,
    themeId: reviewState.themeId ?? jobTheme?.themeId ?? "midnight-wire",
    voiceId: reviewState.voiceId ?? jobVoice?.voiceId ?? "kokoro-bf-emma",
    segments,
    renderUrl,
    thumbnailUrl,
    reviewState,
  };
}
