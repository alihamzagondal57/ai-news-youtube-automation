import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";

interface SegmentBackgroundProps {
  mediaSrc: string;
  accentColor: string;
}

/**
 * Stock footage for the segment, or an animated gradient placeholder when
 * no clip is available yet (keeps compositions renderable before
 * media-sourcing has run, e.g. in local preview or the smoke-test fixture).
 */
export const SegmentBackground: React.FC<SegmentBackgroundProps> = ({ mediaSrc, accentColor }) => {
  if (mediaSrc) {
    return (
      <AbsoluteFill>
        <OffthreadVideo
          src={mediaSrc.startsWith("http") ? mediaSrc : staticFile(mediaSrc)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)" }} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 120% at 20% 20%, ${accentColor}33 0%, #0b0d12 60%)`,
      }}
    />
  );
};
