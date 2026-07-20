import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import { lowerThirdBottom } from "../../utils/layout";
import { useScale } from "../../utils/scale";
import { hexWithAlpha } from "./ThemedBackdrop";
import { contrastOn } from "./ThemedTicker";

interface ThemedLowerThirdProps {
  text: string;
  theme: Theme;
  /** Small kicker above the headline, used by the stackedRule variant. */
  kicker?: string;
}

const VISIBLE_FRAMES = 130;
const EXIT_START = 100;

/**
 * Segment headline plate. Must be rendered inside a <Sequence> scoped to the
 * segment — reads the segment-local frame.
 *
 * Six structurally different treatments: a bar with an accent spine, a floating
 * rounded card, a bare rule-underline, a small corner tag, a kicker/rule/headline
 * stack, and a hard offset block shadow. Entry direction and animation are also
 * theme-driven, so themes differ in motion as well as form.
 */
export const ThemedLowerThird: React.FC<ThemedLowerThirdProps> = ({ text, theme, kicker }) => {
  const { fps } = useVideoConfig();
  const scale = useScale();
  const localFrame = useCurrentFrame();
  const { lowerThird, palette, fonts } = theme;

  if (!text || localFrame >= VISIBLE_FRAMES) {
    return null;
  }

  const enter = spring({ frame: localFrame, fps, config: { damping: 200 } });
  const exitProgress = interpolate(localFrame, [EXIT_START, VISIBLE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(enter, [0, 1], [0, 1]) * (1 - exitProgress);
  const fromRight = lowerThird.align === "right";
  const direction = fromRight ? 1 : -1;

  let transform = "";
  let clipPath: string | undefined;
  switch (lowerThird.enter) {
    case "fadeUp":
      transform = `translateY(${interpolate(enter, [0, 1], [40, 0]) + exitProgress * 30}px)`;
      break;
    case "scaleIn":
      transform = `scale(${interpolate(enter, [0, 1], [0.86, 1])})`;
      break;
    case "wipeX": {
      const revealed = interpolate(enter, [0, 1], [0, 100]) * (1 - exitProgress);
      clipPath = fromRight ? `inset(0 0 0 ${100 - revealed}%)` : `inset(0 ${100 - revealed}% 0 0)`;
      break;
    }
    case "slideX":
    default:
      transform = `translateX(${(interpolate(enter, [0, 1], [70, 0]) + exitProgress * 70) * direction}px)`;
      break;
  }

  const headlineStyle: React.CSSProperties = {
    fontFamily: fonts.headline,
    fontWeight: fonts.headlineWeight,
    fontSize: 34 * scale,
    letterSpacing: fonts.headlineTracking * scale,
    textTransform: fonts.headlineTransform,
    color: palette.textPrimary,
    whiteSpace: "nowrap",
  };

  const container: React.CSSProperties = {
    position: "absolute",
    bottom: lowerThirdBottom() * scale,
    [fromRight ? "right" : "left"]: 80 * scale,
    opacity,
    transform,
    clipPath,
    width: "fit-content",
  };

  switch (lowerThird.variant) {
    case "card":
      return (
        <div
          style={{
            ...container,
            display: "flex",
            alignItems: "center",
            gap: 18 * scale,
            background: palette.surface,
            color: palette.textPrimary,
            borderRadius: 14 * scale,
            padding: `${18 * scale}px ${32 * scale}px`,
            boxShadow: `0 ${14 * scale}px ${40 * scale}px rgba(0,0,0,0.45)`,
          }}
        >
          <div style={{ width: 14 * scale, height: 14 * scale, borderRadius: 999, background: palette.accent }} />
          <span style={headlineStyle}>{text}</span>
        </div>
      );

    case "underline":
      // No plate at all — type sits directly on the footage over a heavy rule.
      return (
        <div style={{ ...container, display: "flex", flexDirection: "column", gap: 10 * scale }}>
          <span style={{ ...headlineStyle, textShadow: `0 ${3 * scale}px ${14 * scale}px rgba(0,0,0,0.8)` }}>{text}</span>
          <div style={{ height: 6 * scale, background: palette.accent, width: "100%" }} />
        </div>
      );

    case "cornerTag":
      // Compact angled tag rather than a full-width plate.
      return (
        <div
          style={{
            ...container,
            display: "flex",
            alignItems: "stretch",
            transform: `${transform} skewX(-10deg)`,
          }}
        >
          <div
            style={{
              background: palette.accent,
              color: contrastOn(palette.accent, palette),
              padding: `${14 * scale}px ${28 * scale}px`,
            }}
          >
            <span style={{ ...headlineStyle, color: contrastOn(palette.accent, palette), transform: "skewX(10deg)", display: "inline-block" }}>
              {text}
            </span>
          </div>
        </div>
      );

    case "stackedRule":
      return (
        <div style={{ ...container, display: "flex", flexDirection: "column", gap: 8 * scale }}>
          <span
            style={{
              fontFamily: fonts.caption,
              fontWeight: fonts.captionWeight,
              fontSize: 20 * scale,
              letterSpacing: 3 * scale,
              textTransform: "uppercase",
              color: palette.accent,
            }}
          >
            {kicker ?? "REPORT"}
          </span>
          <div style={{ height: 3 * scale, width: 90 * scale, background: palette.accent }} />
          <span
            style={{
              ...headlineStyle,
              background: hexWithAlpha(palette.base, 0.72),
              padding: `${12 * scale}px ${24 * scale}px`,
            }}
          >
            {text}
          </span>
        </div>
      );

    case "blockShadow":
      // Solid block with a hard offset shadow — poster-like, no blur.
      return (
        <div
          style={{
            ...container,
            background: palette.surface,
            padding: `${18 * scale}px ${32 * scale}px`,
            boxShadow: `${10 * scale}px ${10 * scale}px 0 ${palette.accent}`,
          }}
        >
          <span style={headlineStyle}>{text}</span>
        </div>
      );

    case "accentBar":
    default:
      return (
        <div style={{ ...container, display: "flex", alignItems: "stretch", flexDirection: fromRight ? "row-reverse" : "row" }}>
          <div style={{ width: 10 * scale, background: palette.accent }} />
          <div style={{ background: palette.surface, padding: `${16 * scale}px ${30 * scale}px` }}>
            <span style={headlineStyle}>{text}</span>
          </div>
        </div>
      );
  }
};
