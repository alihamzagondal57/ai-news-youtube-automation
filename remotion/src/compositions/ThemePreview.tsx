import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { z } from "zod";
import { getThemeOrDefault } from "@ai-news/shared/theme";
import { ThemedBackdrop, hexWithAlpha } from "../components/themed/ThemedBackdrop";
import { ThemedCaptions } from "../components/themed/ThemedCaptions";
import { ThemedLowerThird } from "../components/themed/ThemedLowerThird";
import { ThemedTicker } from "../components/themed/ThemedTicker";
import { useScale } from "../utils/scale";

export const themePreviewPropsSchema = z.object({
  themeId: z.string(),
  /** Drawn in the corner so a contact sheet is self-labelling. */
  showLabel: z.boolean().default(true),
  /**
   * A neutral footage stand-in, identical across every theme. Without it the
   * backdrop is the theme's own gradient, which (a) makes the legibility scrim a
   * no-op, since it grades toward that same base colour, and (b) dominates any
   * visual comparison between themes with background tint rather than design.
   */
  mediaSrc: z.string().default(""),
});
export type ThemePreviewProps = z.infer<typeof themePreviewPropsSchema>;

const SAMPLE_HEADLINE = "ECB Holds Rates As Inflation Cools";
const SAMPLE_TICKER = [
  "MARKETS OPEN HIGHER ACROSS THE EUROZONE",
  "ENERGY PRICES EASE FOR A THIRD WEEK",
  "BRUSSELS SUMMIT ENTERS SECOND DAY",
];
const SAMPLE_WORDS = [
  { word: "The", start: 0.0, end: 0.18 },
  { word: "central", start: 0.18, end: 0.52 },
  { word: "bank", start: 0.52, end: 0.8 },
  { word: "held", start: 0.8, end: 1.1 },
  { word: "rates", start: 1.1, end: 1.6 },
  { word: "steady", start: 1.6, end: 2.4 },
];

/**
 * A single still that exercises every themed surface at once — backdrop scrim,
 * ticker, lower-third and captions — so 18 of these tiled together show whether
 * the themes actually read as different designs rather than recoloured copies.
 *
 * Not part of the render pipeline; it exists to review the catalog.
 */
export const ThemePreview: React.FC<ThemePreviewProps> = ({ themeId, showLabel, mediaSrc }) => {
  const theme = getThemeOrDefault(themeId);
  const scale = useScale();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.base }}>
      <ThemedBackdrop theme={theme} mediaSrc={mediaSrc} />

      {/* Segment-scoped so the lower-third's entry animation resolves the same
          way it does in the real composition. */}
      <Sequence from={0} durationInFrames={200}>
        <ThemedLowerThird text={SAMPLE_HEADLINE} theme={theme} kicker="ECONOMY" />
      </Sequence>

      <ThemedCaptions words={SAMPLE_WORDS} theme={theme} />
      <ThemedTicker headlines={SAMPLE_TICKER} theme={theme} />

      {showLabel ? (
        <div
          style={{
            position: "absolute",
            top: 26 * scale,
            left: 30 * scale,
            display: "flex",
            flexDirection: "column",
            gap: 4 * scale,
            background: hexWithAlpha(theme.palette.base, 0.72),
            padding: `${12 * scale}px ${20 * scale}px`,
            borderLeft: `${5 * scale}px solid ${theme.palette.accent}`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.headline,
              fontWeight: theme.fonts.headlineWeight,
              fontSize: 26 * scale,
              color: theme.palette.textPrimary,
              letterSpacing: theme.fonts.headlineTracking * scale,
            }}
          >
            {theme.name}
          </span>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 17 * scale,
              color: theme.palette.textMuted,
            }}
          >
            {theme.id} · {theme.ticker.variant} · {theme.lowerThird.variant} · {theme.transition.style}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
