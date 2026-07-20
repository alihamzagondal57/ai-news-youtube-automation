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
  // Human-in-the-loop approval gate between render and upload (see
  // docs/REVIEW-DASHBOARD.md). The pipeline parks here until review-state.json
  // reaches an "approved" status.
  "review",
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
  /**
   * YouTube "altered or synthetic content" disclosure. Every video this pipeline
   * makes uses a synthetic voice and an AI-written script, so this defaults to
   * true; youtube-uploader maps it onto the video resource's
   * status.containsSyntheticMedia field (mandatory disclosure since 2025-05-21).
   */
  containsSyntheticMedia: z.boolean().default(true),
});
export type Metadata = z.infer<typeof metadataSchema>;

/** POST /render request body, handled by infra/render-server */
export const renderJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  /**
   * Targeted re-render: only these segments' visuals changed (a clip swap from
   * the review dashboard), so render-server rebuilds just the affected chunks
   * and reuses the rest from its per-segment cache. Omit for a full render.
   *
   * Only valid for changes that don't move any segment's timing. A voice change
   * re-times the whole video and must be sent as a full render instead.
   */
  changedSegmentIds: z.array(z.number().int().nonnegative()).optional(),
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

// ── Review layer (docs/REVIEW-DASHBOARD.md) ──────────────────────────────────

/**
 * User-configurable on-screen text styling, applied at render time. All fields
 * optional — the Remotion composition falls back to the channel default for
 * anything unset, so an empty object renders exactly as the current pipeline does.
 */
export const renderStyleSchema = z.object({
  captions: z
    .object({
      fontFamily: z.string(),
      fontSizePx: z.number().positive(),
      color: z.string(),
      highlightColor: z.string(),
    })
    .partial()
    .optional(),
  ticker: z
    .object({
      backgroundColor: z.string(),
      textColor: z.string(),
      speedPxPerSecond: z.number().positive(),
    })
    .partial()
    .optional(),
  lowerThird: z
    .object({
      backgroundColor: z.string(),
      textColor: z.string(),
      accentColor: z.string(),
    })
    .partial()
    .optional(),
});
export type RenderStyle = z.infer<typeof renderStyleSchema>;

export const reviewStatusSchema = z.enum([
  "awaiting-review", // render done, parked for a human
  "changes-requested", // edits queued; a targeted re-gen/re-render is in flight
  "approved", // released to youtube-uploader
  "rejected", // abandoned, never published
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** A per-segment clip swap chosen in the review dashboard. */
export const segmentClipOverrideSchema = z.object({
  segmentId: z.number().int().nonnegative(),
  /** The media/ filename the reviewer selected from the offered alternatives. */
  file: z.string(),
});
export type SegmentClipOverride = z.infer<typeof segmentClipOverrideSchema>;

/**
 * jobs/{jobId}/review-state.json — the single source of truth for the human
 * review gate. Written by the review dashboard, read by n8n to decide whether to
 * release the job to youtube-uploader, and by render-server to apply voice/style/
 * clip choices on a re-render.
 */
export const reviewStateSchema = z.object({
  jobId: z.string().uuid(),
  status: reviewStatusSchema,
  /** Selected Edge-TTS voice id (e.g. "en-GB-RyanNeural"); null = pipeline default. */
  voiceId: z.string().nullable().default(null),
  /**
   * Manual theme override from the review dashboard; null leaves the job on
   * whatever auto-rotation picked. Changing this re-skins the entire video, so
   * it requires a full re-render, not a targeted one.
   */
  themeId: z.string().nullable().default(null),
  /** Named saved preset this styling came from, if any (for the preset library). */
  stylePresetId: z.string().nullable().default(null),
  style: renderStyleSchema.default({}),
  clipOverrides: z.array(segmentClipOverrideSchema).default([]),
  reviewedBy: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

/**
 * A saved style/voice preset the operator can reuse across videos. Stored
 * outside the per-job tree at presets/{presetId}.json.
 */
export const stylePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  voiceId: z.string().nullable().default(null),
  style: renderStyleSchema.default({}),
});
export type StylePreset = z.infer<typeof stylePresetSchema>;
