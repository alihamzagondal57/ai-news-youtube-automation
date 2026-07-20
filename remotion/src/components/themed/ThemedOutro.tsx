import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import { useScale } from "../../utils/scale";

interface ThemedOutroProps {
  channelName: string;
  theme: Theme;
}

/** Closing call-to-action, in the theme's own motion language. */
export const ThemedOutro: React.FC<ThemedOutroProps> = ({ channelName, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();
  const { palette, fonts } = theme;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const enter = spring({ frame, fps, config: { damping: 200 } });

  const ctaStyle: React.CSSProperties = {
    color: palette.accent,
    fontFamily: fonts.headline,
    fontWeight: fonts.headlineWeight,
    fontSize: 52 * scale,
    letterSpacing: fonts.headlineTracking * scale,
    textTransform: fonts.headlineTransform,
    marginBottom: 24 * scale,
  };
  const nameStyle: React.CSSProperties = {
    color: palette.textPrimary,
    fontFamily: fonts.caption,
    fontWeight: fonts.captionWeight,
    fontSize: 32 * scale,
  };
  const shell: React.CSSProperties = {
    background: palette.base,
    justifyContent: "center",
    alignItems: "center",
  };

  switch (theme.outro) {
    case "centerFade":
      return (
        <AbsoluteFill style={shell}>
          <div style={{ textAlign: "center", opacity: interpolate(enter, [0, 1], [0, 1]) }}>
            <div style={ctaStyle}>SUBSCRIBE FOR MORE</div>
            <div style={nameStyle}>{channelName}</div>
          </div>
        </AbsoluteFill>
      );

    case "sideSlide": {
      const slide = interpolate(enter, [0, 1], [-70, 0], clamp);
      return (
        <AbsoluteFill style={{ ...shell, alignItems: "flex-start", paddingLeft: 120 * scale }}>
          <div style={{ textAlign: "left", transform: `translateX(${slide}px)`, opacity: enter }}>
            <div style={{ height: 6 * scale, width: 120 * scale, background: palette.accent, marginBottom: 26 * scale }} />
            <div style={ctaStyle}>SUBSCRIBE FOR MORE</div>
            <div style={nameStyle}>{channelName}</div>
          </div>
        </AbsoluteFill>
      );
    }

    case "ruleCollapse": {
      // Two rules travel inward and meet around the text.
      const gap = interpolate(enter, [0, 1], [60, 6], clamp);
      return (
        <AbsoluteFill style={shell}>
          <div style={{ textAlign: "center", opacity: enter }}>
            <div style={{ height: 3 * scale, width: `${100 - gap}%`, background: palette.accent, margin: `0 auto ${30 * scale}px` }} />
            <div style={ctaStyle}>SUBSCRIBE FOR MORE</div>
            <div style={nameStyle}>{channelName}</div>
            <div style={{ height: 3 * scale, width: `${100 - gap}%`, background: palette.accent, margin: `${30 * scale}px auto 0` }} />
          </div>
        </AbsoluteFill>
      );
    }

    case "cardsUp":
    default: {
      const lift = (delay: number) =>
        spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 26 });
      const card = (content: React.ReactNode, delay: number, key: string) => {
        const p = lift(delay);
        return (
          <div
            key={key}
            style={{
              background: palette.surface,
              padding: `${22 * scale}px ${46 * scale}px`,
              marginBottom: 18 * scale,
              borderLeft: `${8 * scale}px solid ${palette.accent}`,
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [50, 0], clamp)}px)`,
            }}
          >
            {content}
          </div>
        );
      };
      return (
        <AbsoluteFill style={shell}>
          <div style={{ textAlign: "center" }}>
            {card(<div style={{ ...ctaStyle, marginBottom: 0 }}>SUBSCRIBE FOR MORE</div>, 0, "cta")}
            {card(<div style={nameStyle}>{channelName}</div>, 8, "name")}
          </div>
        </AbsoluteFill>
      );
    }
  }
};
