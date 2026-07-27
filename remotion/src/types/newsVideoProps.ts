import { z } from "zod";
import { DEFAULT_THEME_ID } from "@ai-news/shared/theme";

export const mediaClipPropsSchema = z.object({
  /** staticFile()-resolvable path to a stock clip. */
  src: z.string(),
  /** Frames into the SEGMENT's own (Sequence-local) timeline this beat starts at. */
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  trimBeforeFrames: z.number().int().nonnegative(),
  trimAfterFrames: z.number().int().positive(),
});
export type MediaClipProps = z.infer<typeof mediaClipPropsSchema>;

export const segmentPropsSchema = z.object({
  id: z.number().int().nonnegative(),
  text: z.string(),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  /**
   * One or more clips sequenced behind this segment (never a single source):
   * a stock clip is almost never exactly as long as the segment it backs, so
   * render-server either trims one clip to fit or cuts between several — see
   * infra/render-server/src/mediaTimeline.ts. Empty for a gradient placeholder.
   */
  media: z.array(mediaClipPropsSchema).default([]),
  lowerThirdText: z.string().default(""),
  breaking: z.boolean().default(false),
});
export type SegmentProps = z.infer<typeof segmentPropsSchema>;

export const captionWordPropsSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().positive(),
});
export type CaptionWordProps = z.infer<typeof captionWordPropsSchema>;

export const newsVideoPropsSchema = z.object({
  title: z.string(),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 3840, height: 2160 }),
  fps: z.number().int().positive().default(30),
  outroDurationInFrames: z.number().int().positive().default(150),
  segments: z.array(segmentPropsSchema).min(1),
  captionWords: z.array(captionWordPropsSchema),
  tickerHeadlines: z.array(z.string()).min(1),
  audio: z.object({
    voiceoverSrc: z.string(),
    musicSrc: z.string().default(""),
    musicVolume: z.number().min(0).max(1).default(0.15),
    duckedVolume: z.number().min(0).max(1).default(0.05),
  }),
  branding: z.object({
    channelName: z.string(),
    accentColor: z.string().default("#e11d2e"),
  }),
  /**
   * Visual theme for this video (see services/shared/src/theme). Unknown ids
   * fall back to the default rather than failing a render — a bad theme id
   * should not cost a 4K render that is otherwise fine.
   */
  themeId: z.string().default(DEFAULT_THEME_ID),
});
export type NewsVideoProps = z.infer<typeof newsVideoPropsSchema>;
