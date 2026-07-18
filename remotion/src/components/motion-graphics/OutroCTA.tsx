import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useScale } from "../../utils/scale";

interface OutroCTAProps {
  channelName: string;
  accentColor: string;
}

export const OutroCTA: React.FC<OutroCTAProps> = ({ channelName, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();
  const enter = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ background: "#0b0d12", justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          opacity: interpolate(enter, [0, 1], [0, 1]),
          transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: accentColor,
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 52 * scale,
            marginBottom: 24 * scale,
          }}
        >
          SUBSCRIBE FOR MORE
        </div>
        <div
          style={{
            color: "#fff",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 700,
            fontSize: 32 * scale,
          }}
        >
          {channelName}
        </div>
      </div>
    </AbsoluteFill>
  );
};
