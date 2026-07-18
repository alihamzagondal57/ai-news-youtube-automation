import { z } from "zod";

/** jobs/{jobId}/job.json — the pipeline's own state manifest. */
export const jobModeSchema = z.enum(["manual", "auto"]);
export type JobMode = z.infer<typeof jobModeSchema>;

export const pipelineStepSchema = z.enum([
  "trend-research",
  "script-generator",
  "voiceover",
  "caption-sync",
  "media-sourcing",
  "metadata-generator",
  "render",
  "youtube-uploader",
]);
export type PipelineStep = z.infer<typeof pipelineStepSchema>;

export const jobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobManifestSchema = z.object({
  jobId: z.string().uuid(),
  mode: jobModeSchema,
  status: jobStatusSchema,
  currentStep: pipelineStepSchema.nullable(),
  niche: z.string().default("news-europe"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().nullable().optional(),
});
export type JobManifest = z.infer<typeof jobManifestSchema>;

/** jobs/{jobId}/trend.json */
export const trendSchema = z.object({
  jobId: z.string().uuid(),
  topic: z.string(),
  angle: z.string(),
  sourceUrls: z.array(z.string().url()).min(1),
  sourceSummaries: z.array(z.string()).min(1),
});
export type Trend = z.infer<typeof trendSchema>;

/** jobs/{jobId}/script.json */
export const scriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  text: z.string().min(1),
  /** Short on-screen label for the segment (e.g. "Markets React to Rate Decision") — shown in the lower-third, not spoken. */
  headline: z.string().min(1),
  /** B-roll sourcing instruction for media-sourcing (e.g. "stock footage of the ECB building") — never rendered as on-screen text. */
  visualCue: z.string(),
  estSeconds: z.number().positive(),
});
export type ScriptSegment = z.infer<typeof scriptSegmentSchema>;

export const scriptSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string(),
  segments: z.array(scriptSegmentSchema).min(1),
});
export type Script = z.infer<typeof scriptSchema>;

/** jobs/{jobId}/segment-timing.json — written by voiceover once actual TTS audio exists */
export const segmentTimingEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
});
export type SegmentTimingEntry = z.infer<typeof segmentTimingEntrySchema>;

export const segmentTimingSchema = z.object({
  jobId: z.string().uuid(),
  totalDurationSeconds: z.number().positive(),
  segments: z.array(segmentTimingEntrySchema).min(1),
});
export type SegmentTiming = z.infer<typeof segmentTimingSchema>;

/** jobs/{jobId}/captions.json — word-level timestamps from Whisper */
export const captionWordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
});
export type CaptionWord = z.infer<typeof captionWordSchema>;

export const captionsSchema = z.object({
  jobId: z.string().uuid(),
  words: z.array(captionWordSchema),
});
export type Captions = z.infer<typeof captionsSchema>;

/** jobs/{jobId}/media/media-manifest.json */
export const mediaLicenseSchema = z.object({
  source: z.enum(["pexels", "pixabay"]),
  licenseType: z.string(),
  url: z.string().url(),
});
export type MediaLicense = z.infer<typeof mediaLicenseSchema>;

export const mediaAssetSchema = z.object({
  segmentId: z.number().int().nonnegative(),
  file: z.string(),
  license: mediaLicenseSchema,
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const mediaManifestSchema = z.object({
  jobId: z.string().uuid(),
  clips: z.array(mediaAssetSchema),
  music: z.object({ file: z.string(), license: mediaLicenseSchema }).nullable(),
  sfx: z.array(z.object({ file: z.string(), license: mediaLicenseSchema })),
});
export type MediaManifest = z.infer<typeof mediaManifestSchema>;

/** jobs/{jobId}/metadata.json */
export const chapterSchema = z.object({
  title: z.string(),
  startSeconds: z.number().nonnegative(),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const metadataSchema = z.object({
  jobId: z.string().uuid(),
  title: z.string().max(100),
  description: z.string().max(5000),
  tags: z.array(z.string()).max(500),
  hashtags: z.array(z.string()).max(15),
  chapters: z.array(chapterSchema),
});
export type Metadata = z.infer<typeof metadataSchema>;

/** POST /render request body, handled by infra/render-server */
export const renderJobRequestSchema = z.object({
  jobId: z.string().uuid(),
});
export type RenderJobRequest = z.infer<typeof renderJobRequestSchema>;

export const renderResultSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["completed", "failed"]),
  renderKey: z.string().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type RenderResult = z.infer<typeof renderResultSchema>;

/** jobs/{jobId}/youtube-result.json */
export const youtubeResultSchema = z.object({
  jobId: z.string().uuid(),
  videoId: z.string(),
  url: z.string().url(),
  status: z.enum(["uploaded", "failed"]),
  quotaUnitsUsed: z.number().nonnegative(),
});
export type YoutubeResult = z.infer<typeof youtubeResultSchema>;
