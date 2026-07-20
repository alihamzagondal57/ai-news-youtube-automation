import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import { useScale } from "../../utils/scale";
import { hexWithAlpha } from "./ThemedBackdrop";
import { contrastOn } from "./ThemedTicker";

interface ThemedIntroProps {
  channelName: string;
  title: string;
  theme: Theme;
}

export const INTRO_DURATION_IN_FRAMES = 75;

/**
 * Opening stinger. Overlays the start of the first segment rather than
 * displacing it, so audio and captions never shift — the intro is purely
 * additive on the timeline.
 */
export const ThemedIntro: React.FC<ThemedIntroProps> = ({ channelName, title, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();
  const { palette, fonts } = theme;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const reveal = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const titleIn = spring({ frame: frame - 15, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [INTRO_DURATION_IN_FRAMES - 20, INTRO_DURATION_IN_FRAMES], [1, 0], clamp);

  const kickerStyle: React.CSSProperties = {
    color: palette.accent,
    fontFamily: fonts.caption,
    fontWeight: fonts.captionWeight,
    fontSize: 30 * scale,
    letterSpacing: 6 * scale,
    textTransform: "uppercase",
    marginBottom: 18 * scale,
  };
  const titleStyle: React.CSSProperties = {
    color: palette.textPrimary,
    fontFamily: fonts.headline,
    fontWeight: fonts.headlineWeight,
    fontSize: 64 * scale,
    letterSpacing: fonts.headlineTracking * scale,
    textTransform: fonts.headlineTransform,
    maxWidth: 1400 * scale,
    lineHeight: 1.15,
  };
  const titleBlock = (
    <div
      style={{
        textAlign: "center",
        opacity: interpolate(titleIn, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(titleIn, [0, 1], [30, 0])}px)`,
      }}
    >
      <div style={kickerStyle}>{channelName}</div>
      <div style={titleStyle}>{title}</div>
    </div>
  );

  const shell: React.CSSProperties = { background: palette.base, opacity: fadeOut };

  switch (theme.intro) {
    case "centerPulse": {
      const radius = interpolate(reveal, [0, 1], [0, 140], clamp);
      return (
        <AbsoluteFill style={shell}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at 50% 50%, ${hexWithAlpha(palette.accent, 0.55)} 0%, ${palette.base} ${radius}%)`,
            }}
          />
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>{titleBlock}</AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case "cornerSlate": {
      const slide = interpolate(reveal, [0, 1], [-100, 0], clamp);
      return (
        <AbsoluteFill style={shell}>
          <AbsoluteFill style={{ background: palette.base }} />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "18%",
              bottom: "18%",
              width: "72%",
              background: palette.surface,
              borderRight: `${10 * scale}px solid ${palette.accent}`,
              transform: `translateX(${slide}%)`,
              display: "flex",
              alignItems: "center",
              paddingLeft: 90 * scale,
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={kickerStyle}>{channelName}</div>
              <div style={titleStyle}>{title}</div>
            </div>
          </div>
        </AbsoluteFill>
      );
    }

    case "gridReveal": {
      const cells = 24;
      return (
        <AbsoluteFill style={shell}>
          <AbsoluteFill style={{ display: "flex", flexWrap: "wrap" }}>
            {Array.from({ length: cells }).map((_, i) => {
              const cellIn = spring({ frame: frame - i * 1.4, fps, config: { damping: 200 }, durationInFrames: 22 });
              return (
                <div
                  key={i}
                  style={{
                    width: `${100 / 6}%`,
                    height: `${100 / 4}%`,
                    background: i % 3 === 0 ? hexWithAlpha(palette.accent, 0.32) : palette.surface,
                    opacity: cellIn,
                  }}
                />
              );
            })}
          </AbsoluteFill>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>{titleBlock}</AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case "minimalRule": {
      const ruleWidth = interpolate(reveal, [0, 1], [0, 46], clamp);
      return (
        <AbsoluteFill style={shell}>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
            <div style={{ height: 4 * scale, width: `${ruleWidth}%`, background: palette.accent, marginBottom: 40 * scale }} />
            {titleBlock}
            <div style={{ height: 4 * scale, width: `${ruleWidth}%`, background: palette.accent, marginTop: 40 * scale }} />
          </AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case "barsWipe":
    default: {
      const bars = 5;
      return (
        <AbsoluteFill style={shell}>
          <AbsoluteFill>
            {Array.from({ length: bars }).map((_, i) => {
              const barIn = spring({ frame: frame - i * 3, fps, config: { damping: 200 }, durationInFrames: 26 });
              const fromLeft = i % 2 === 0;
              const offset = interpolate(barIn, [0, 1], [100, 0], clamp);
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${(100 / bars) * i}%`,
                    height: `${100 / bars}%`,
                    background: i % 2 === 0 ? palette.surface : hexWithAlpha(palette.accent, 0.4),
                    transform: `translateX(${fromLeft ? -offset : offset}%)`,
                  }}
                />
              );
            })}
          </AbsoluteFill>
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>{titleBlock}</AbsoluteFill>
        </AbsoluteFill>
      );
    }
  }
};

export { contrastOn };
