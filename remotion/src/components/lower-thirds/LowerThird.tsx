import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { lowerThirdBottom } from "../../utils/layout";
import { useScale } from "../../utils/scale";

interface LowerThirdProps {
  text: string;
  accentColor: string;
}

const VISIBLE_FRAMES = 130;
const EXIT_START = 100;

/** Must be rendered inside a <Sequence> scoped to the segment — reads the segment-local frame via useCurrentFrame(). Sits in its own band above the captions band (see utils/layout.ts), so it never overlaps word-highlight captions regardless of how many caption lines are showing. */
export const LowerThird: React.FC<LowerThirdProps> = ({ text, accentColor }) => {
  const { fps } = useVideoConfig();
  const scale = useScale();
  const localFrame = useCurrentFrame();
  if (!text || localFrame >= VISIBLE_FRAMES) {
    return null;
  }

  const enter = spring({ frame: localFrame, fps, config: { damping: 200 } });
  const exitProgress = interpolate(localFrame, [EXIT_START, VISIBLE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateX = interpolate(enter, [0, 1], [-60, 0]) - exitProgress * 60;
  const opacity = interpolate(enter, [0, 1], [0, 1]) * (1 - exitProgress);

  return (
    <div
      style={{
        position: "absolute",
        left: 80 * scale,
        bottom: lowerThirdBottom() * scale,
        display: "flex",
        alignItems: "stretch",
        opacity,
        transform: `translateX(${translateX}px)`,
        width: "fit-content",
      }}
    >
      <div style={{ width: 8 * scale, background: accentColor }} />
      <div
        style={{
          background: "#0b0d12dd",
          color: "#fff",
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: 700,
          fontSize: 34 * scale,
          padding: `${16 * scale}px ${28 * scale}px`,
        }}
      >
        {text}
      </div>
    </div>
  );
};
