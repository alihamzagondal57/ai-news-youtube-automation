import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

interface BreakingNewsBumperProps {
  accentColor: string;
  enabled: boolean;
}

const FLASH_FRAMES = 18;

/** Brief accent-color flash at the start of a segment flagged as breaking news. Must be rendered inside the segment's <Sequence>. */
export const BreakingNewsBumper: React.FC<BreakingNewsBumperProps> = ({ accentColor, enabled }) => {
  const localFrame = useCurrentFrame();
  if (!enabled || localFrame >= FLASH_FRAMES) {
    return null;
  }
  const opacity = interpolate(localFrame, [0, 4, FLASH_FRAMES], [0, 0.55, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: accentColor, opacity, mixBlendMode: "screen" }} />;
};
