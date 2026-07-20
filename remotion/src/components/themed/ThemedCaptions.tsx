import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import type { CaptionWordProps } from "../../types/newsVideoProps";
import { CAPTIONS_BAND_HEIGHT, captionsBandBottom } from "../../utils/layout";
import { useScale } from "../../utils/scale";
import { hexWithAlpha } from "./ThemedBackdrop";
import { contrastOn } from "./ThemedTicker";

interface ThemedCaptionsProps {
  words: CaptionWordProps[];
  theme: Theme;
}

const WORDS_PER_LINE = 6;

/**
 * Word-synced captions in a fixed band above the ticker (see utils/layout.ts),
 * so they never collide with the lower-third.
 *
 * Four treatments of the active word: recoloured and scaled, sitting in a boxed
 * line, underlined, or given its own accent chip. Timing is identical across all
 * of them — only the presentation changes, so caption/voice sync is unaffected
 * by the theme.
 */
export const ThemedCaptions: React.FC<ThemedCaptionsProps> = ({ words, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();
  const { captions, palette, fonts } = theme;
  const t = frame / fps;

  const activeIndex = words.findIndex((w) => t >= w.start && t < w.end);
  if (activeIndex === -1) {
    return null;
  }

  const lineStart = Math.floor(activeIndex / WORDS_PER_LINE) * WORDS_PER_LINE;
  const line = words.slice(lineStart, lineStart + WORDS_PER_LINE);
  const fontSize = 52 * scale * captions.sizeScale;

  const lineStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    maxWidth: "82%",
    gap: "0.35em",
    fontFamily: fonts.caption,
    fontWeight: captions.weight,
    fontSize,
    lineHeight: 1.25,
  };

  const boxed = captions.variant === "boxedLine";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: captionsBandBottom() * scale,
        height: CAPTIONS_BAND_HEIGHT * scale,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        paddingBottom: 24 * scale,
      }}
    >
      <div
        style={{
          ...lineStyle,
          // The panel token, not base+alpha: base is the same colour as the
          // backdrop, so the "box" rendered as nothing at all. The accent rule
          // guarantees the box reads as a surface over any footage.
          ...(boxed
            ? {
                background: palette.surface,
                padding: `${14 * scale}px ${28 * scale}px`,
                borderRadius: 8 * scale,
                borderBottom: `${4 * scale}px solid ${palette.accent}`,
              }
            : { textShadow: `0 ${4 * scale}px ${18 * scale}px rgba(0,0,0,0.85)` }),
        }}
      >
        {line.map((word, i) => {
          const isActive = lineStart + i === activeIndex;
          return (
            <span
              key={`${lineStart + i}-${word.word}`}
              style={wordStyle(isActive, captions.variant, theme, scale)}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};

function wordStyle(
  isActive: boolean,
  variant: Theme["captions"]["variant"],
  theme: Theme,
  scale: number,
): React.CSSProperties {
  const { palette } = theme;
  const base: React.CSSProperties = { display: "inline-block", color: palette.textPrimary };

  if (!isActive) {
    return variant === "chipWord"
      ? { ...base, padding: `${2 * scale}px ${8 * scale}px` }
      : base;
  }

  switch (variant) {
    case "chipWord":
      return {
        ...base,
        color: contrastOn(palette.accent, palette),
        background: palette.accent,
        padding: `${2 * scale}px ${8 * scale}px`,
        borderRadius: 6 * scale,
      };
    case "underlineWord":
      return {
        ...base,
        color: palette.captionActive,
        borderBottom: `${5 * scale}px solid ${palette.accent}`,
        paddingBottom: 2 * scale,
      };
    case "boxedLine":
      return { ...base, color: palette.captionActive };
    case "highlightWord":
    default:
      return { ...base, color: palette.captionActive, transform: "scale(1.08)" };
  }
}
