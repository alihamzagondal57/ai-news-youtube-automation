import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
import { getThemeOrDefault } from "@ai-news/shared/theme";
import { ThemedBackdrop } from "../components/themed/ThemedBackdrop";
import { ThumbnailHeadline } from "../components/themed/ThumbnailHeadline";

export const thumbnailPropsSchema = z.object({
  themeId: z.string(),
  headline: z.string(),
  kicker: z.string().default(""),
  channelName: z.string().default(""),
  /**
   * staticFile()-resolvable path to a representative frame extracted from
   * render.mp4. Empty falls back to ThemedBackdrop's own gradient — the
   * "themed still" path used when no rendered video is available yet.
   */
  backgroundFrameSrc: z.string().default(""),
  /** 1080p-reference px; see services/thumbnail-generator/src/headline.ts. */
  fontSizePx: z.number().positive().default(96),
});
export type ThumbnailProps = z.infer<typeof thumbnailPropsSchema>;

/**
 * A single still: the job's own theme backdrop (real frame or gradient
 * fallback) plus one oversized, theme-coloured headline. Not part of the video
 * render pipeline — thumbnail-generator renders this once per job, the same
 * way ThemePreview renders a review-only contact-sheet still.
 */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  themeId,
  headline,
  kicker,
  channelName,
  backgroundFrameSrc,
  fontSizePx,
}) => {
  const theme = getThemeOrDefault(themeId);
  const media = backgroundFrameSrc
    ? [{ src: backgroundFrameSrc, startFrame: 0, durationInFrames: 1, trimBeforeFrames: 0, trimAfterFrames: 1 }]
    : [];

  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.base }}>
      <ThemedBackdrop theme={theme} media={media} />
      <ThumbnailHeadline
        theme={theme}
        headline={headline}
        kicker={kicker || undefined}
        channelName={channelName || undefined}
        fontSizePx={fontSizePx}
      />
    </AbsoluteFill>
  );
};
