import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useScale } from "../../utils/scale";

interface IntroStingerProps {
  channelName: string;
  title: string;
  accentColor: string;
}

export const INTRO_DURATION_IN_FRAMES = 75;

export const IntroStinger: React.FC<IntroStingerProps> = ({ channelName, title, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();

  const wipe = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const titleIn = spring({ frame: frame - 15, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [INTRO_DURATION_IN_FRAMES - 20, INTRO_DURATION_IN_FRAMES], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#0b0d12", opacity: fadeOut }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(120deg, ${accentColor} 0%, #0b0d12 70%)`,
          clipPath: `inset(0 ${interpolate(wipe, [0, 1], [100, 0])}% 0 0)`,
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            opacity: interpolate(titleIn, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(titleIn, [0, 1], [30, 0])}px)`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              color: "#fff",
              fontFamily: "Inter, Arial, sans-serif",
              fontWeight: 900,
              fontSize: 30 * scale,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 18 * scale,
            }}
          >
            {channelName}
          </div>
          <div
            style={{
              color: "#fff",
              fontFamily: "Inter, Arial, sans-serif",
              fontWeight: 800,
              fontSize: 64 * scale,
              maxWidth: 1400 * scale,
              lineHeight: 1.15,
            }}
          >
            {title}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
