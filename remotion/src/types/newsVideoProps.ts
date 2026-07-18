import { z } from "zod";

export const segmentPropsSchema = z.object({
  id: z.number().int().nonnegative(),
  text: z.string(),
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  /** staticFile()-resolvable path to stock footage for this segment, or empty for a gradient placeholder. */
  mediaSrc: z.string().default(""),
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
});
export type NewsVideoProps = z.infer<typeof newsVideoPropsSchema>;
