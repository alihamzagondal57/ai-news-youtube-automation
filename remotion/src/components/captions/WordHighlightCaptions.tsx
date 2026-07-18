import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionWordProps } from "../../types/newsVideoProps";
import { CAPTIONS_BAND_HEIGHT, captionsBandBottom } from "../../utils/layout";
import { useScale } from "../../utils/scale";

interface WordHighlightCaptionsProps {
  words: CaptionWordProps[];
  accentColor: string;
}

const WORDS_PER_LINE = 6;

/** Karaoke-style word-synced captions: a rolling window of words, active word highlighted. Occupies a fixed band directly above the ticker (see utils/layout.ts) so it never collides with the lower-third. */
export const WordHighlightCaptions: React.FC<WordHighlightCaptionsProps> = ({ words, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useScale();
  const t = frame / fps;

  const activeIndex = words.findIndex((w) => t >= w.start && t < w.end);
  if (activeIndex === -1) {
    return null;
  }

  const lineStart = Math.floor(activeIndex / WORDS_PER_LINE) * WORDS_PER_LINE;
  const line = words.slice(lineStart, lineStart + WORDS_PER_LINE);

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
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "80%",
          gap: `${0.4}em`,
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 52 * scale,
          fontWeight: 800,
          textShadow: "0 4px 18px rgba(0,0,0,0.85)",
        }}
      >
        {line.map((word, i) => {
          const globalIndex = lineStart + i;
          const isActive = globalIndex === activeIndex;
          return (
            <span
              key={`${globalIndex}-${word.word}`}
              style={{
                color: isActive ? accentColor : "#ffffff",
                transform: isActive ? "scale(1.08)" : "scale(1)",
                display: "inline-block",
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
