import React from "react";
import type { Theme } from "@ai-news/shared/theme";
import { useScale } from "../../utils/scale";
import { hexWithAlpha } from "./ThemedBackdrop";
import { contrastOn } from "./ThemedTicker";

interface ThumbnailHeadlineProps {
  theme: Theme;
  headline: string;
  /** "BREAKING"-style corner tag; omitted renders no badge. */
  kicker?: string;
  channelName?: string;
  /** 1080p-reference px, scaled via useScale(). See services/thumbnail-generator/src/headline.ts for how callers pick this. */
  fontSizePx: number;
}

/**
 * Static, oversized headline treatment for the thumbnail composition.
 *
 * Deliberately ONE layout rather than ThemedLowerThird's six theme-specific
 * variants: a thumbnail is judged at postage-stamp size in a results grid, so
 * the differentiator that matters is the theme's palette/fonts, not a bespoke
 * structural variant per theme. Reusing ThemedBackdrop for the background is
 * what actually carries per-theme identity here (gradient tint or scrim
 * strength); this component only needs to stay legible on top of it.
 */
export const ThumbnailHeadline: React.FC<ThumbnailHeadlineProps> = ({
  theme,
  headline,
  kicker,
  channelName,
  fontSizePx,
}) => {
  const { palette, fonts } = theme;
  const scale = useScale();

  return (
    <>
      {kicker ? (
        <div
          style={{
            position: "absolute",
            top: 48 * scale,
            left: 48 * scale,
            background: palette.accent,
            color: contrastOn(palette.accent, palette),
            fontFamily: fonts.headline,
            fontWeight: fonts.headlineWeight,
            fontSize: 30 * scale,
            letterSpacing: 2 * scale,
            textTransform: "uppercase",
            padding: `${10 * scale}px ${28 * scale}px`,
          }}
        >
          {kicker}
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", alignItems: "stretch" }}>
        <div style={{ width: 16 * scale, background: palette.accent, flexShrink: 0 }} />
        <div
          style={{
            background: hexWithAlpha(palette.surface, 0.92),
            padding: `${40 * scale}px ${56 * scale}px`,
            display: "flex",
            flexDirection: "column",
            gap: 14 * scale,
            maxWidth: "100%",
          }}
        >
          <span
            style={{
              fontFamily: fonts.headline,
              fontWeight: fonts.headlineWeight,
              textTransform: fonts.headlineTransform,
              letterSpacing: fonts.headlineTracking * scale,
              color: palette.textPrimary,
              fontSize: fontSizePx * scale,
              lineHeight: 1.08,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {headline}
          </span>
          {channelName ? (
            <span
              style={{
                fontFamily: fonts.caption,
                fontWeight: fonts.captionWeight,
                fontSize: 22 * scale,
                letterSpacing: 2 * scale,
                textTransform: "uppercase",
                color: palette.accent,
              }}
            >
              {channelName}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
};
