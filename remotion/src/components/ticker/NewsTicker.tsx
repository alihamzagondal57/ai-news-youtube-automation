import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { TICKER_HEIGHT } from "../../utils/layout";
import { useScale } from "../../utils/scale";

interface NewsTickerProps {
  headlines: string[];
  accentColor: string;
}

const SEPARATOR = "     •     ";
const PIXELS_PER_SECOND_AT_1080P = 160;

/** Continuously scrolling breaking-news ticker, pinned to the bottom edge. */
export const NewsTicker: React.FC<NewsTickerProps> = ({ headlines, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const scale = useScale();

  const fontSize = 30 * scale;
  const tickerHeight = TICKER_HEIGHT * scale;
  const labelWidth = 190 * scale;

  const text = headlines.join(SEPARATOR) + SEPARATOR;
  // Rough width estimate (monospace-ish average glyph width) so the loop wraps
  // without needing a DOM measurement pass during rendering.
  const estimatedTextWidth = text.length * fontSize * 0.58;
  const scrollDistance = Math.max(estimatedTextWidth, width);
  const offset = ((frame / fps) * PIXELS_PER_SECOND_AT_1080P * scale) % scrollDistance;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ display: "flex", height: tickerHeight, background: "#0b0d12ee" }}>
        <div
          style={{
            width: labelWidth,
            background: accentColor,
            color: "#fff",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          BREAKING
        </div>
        <div style={{ position: "relative", overflow: "hidden", flex: 1 }}>
          <div
            style={{
              position: "absolute",
              whiteSpace: "nowrap",
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              color: "#f2f2f2",
              fontFamily: "Inter, Arial, sans-serif",
              fontSize,
              fontWeight: 600,
              transform: `translateX(${width - offset}px)`,
            }}
          >
            {text}
            {text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
