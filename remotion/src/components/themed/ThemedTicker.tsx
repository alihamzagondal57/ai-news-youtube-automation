import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import { TICKER_HEIGHT } from "../../utils/layout";
import { useScale } from "../../utils/scale";
import { hexWithAlpha } from "./ThemedBackdrop";

interface TickerStyleOverride {
  backgroundColor?: string;
  textColor?: string;
  speedPxPerSecond?: number;
}

interface ThemedTickerProps {
  headlines: string[];
  theme: Theme;
  /** Per-video override from the review dashboard (review-state.json.style.ticker). Unset fields keep the theme's own value. */
  styleOverride?: TickerStyleOverride;
}

const SEPARATOR = "     •     ";

/**
 * Scrolling headline strip. The five variants differ in structure, not colour:
 * a solid full-bleed band, discrete floating chips, a thin accent ribbon, an
 * unboxed minimal line, or nothing at all.
 */
export const ThemedTicker: React.FC<ThemedTickerProps> = ({ headlines, theme, styleOverride }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const scale = useScale();
  // Layered on top of the theme, not instead of it — see ThemedCaptions.tsx's
  // identical reasoning. textColor covers both textPrimary (band/ribbon) and
  // textMuted (minimal variant), since the operator picking one colour means
  // one colour regardless of which structural variant this theme happens to use.
  const { ticker: themeTicker, palette: themePalette, fonts } = theme;
  const palette = {
    ...themePalette,
    ...(styleOverride?.backgroundColor ? { surface: styleOverride.backgroundColor } : {}),
    ...(styleOverride?.textColor ? { textPrimary: styleOverride.textColor, textMuted: styleOverride.textColor } : {}),
  };
  const ticker = { ...themeTicker, ...(styleOverride?.speedPxPerSecond ? { speed: styleOverride.speedPxPerSecond } : {}) };

  if (ticker.variant === "none" || headlines.length === 0) {
    return null;
  }

  const height = TICKER_HEIGHT * ticker.heightScale * scale;
  const fontSize = 30 * scale * (ticker.heightScale || 1);
  const text = headlines.join(SEPARATOR) + SEPARATOR;

  // Rough glyph-width estimate so the loop wraps without a DOM measurement pass.
  const singleWidth = Math.max(text.length * fontSize * 0.58, 1);

  // The strip must be FULL at frame 0. Scrolling in from `width` left the ticker
  // visibly empty for the first ~12 seconds of every video (width / speed), which
  // is most of a short segment. Instead the content starts flush at x=0 and
  // translates negatively, cycling over exactly one copy's width so the repeats
  // line up seamlessly at the wrap.
  const offset = ((frame / fps) * ticker.speed * scale) % singleWidth;
  const translate = -offset;
  const repeats = Math.max(2, Math.ceil(width / singleWidth) + 1);

  const textStyle: React.CSSProperties = {
    fontFamily: fonts.caption,
    fontWeight: fonts.captionWeight,
    fontSize,
    whiteSpace: "nowrap",
  };

  const scroller: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    transform: `translateX(${translate}px)`,
  };

  if (ticker.variant === "chips") {
    // No continuous bar: each headline rides in its own pill, so the lower edge
    // of frame stays visually open.
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
        <div style={{ height, position: "relative", overflow: "hidden", marginBottom: 14 * scale }}>
          <div style={{ ...scroller, gap: 14 * scale }}>
            {Array.from({ length: repeats }).flatMap((_, r) =>
              headlines.map((headline, i) => (
                <span
                  key={`${r}-${i}`}
                  style={{
                    ...textStyle,
                    color: palette.textPrimary,
                    background: palette.surface,
                    border: `${2 * scale}px solid ${hexWithAlpha(palette.accent, 0.55)}`,
                    borderRadius: 999,
                    padding: `${8 * scale}px ${22 * scale}px`,
                  }}
                >
                  {headline}
                </span>
              )),
            )}
          </div>
        </div>
        {ticker.badge ? (
          <div style={{ position: "absolute", left: 0, bottom: 14 * scale, height }}>
            <Badge label={ticker.badge} theme={theme} scale={scale} />
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  if (ticker.variant === "minimal") {
    // Unboxed: a hairline rule and muted text, letting footage run to the edge.
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
        <div
          style={{
            height,
            position: "relative",
            overflow: "hidden",
            borderTop: `${2 * scale}px solid ${hexWithAlpha(palette.accent, 0.5)}`,
          }}
        >
          <div style={{ ...scroller, ...textStyle, color: palette.textMuted, letterSpacing: 1 * scale }}>
            {Array.from({ length: repeats }).map((_, r) => (
              <span key={r}>{text}</span>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (ticker.variant === "ribbon") {
    // A narrow inset ribbon that floats clear of the frame edge.
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
        <div
          style={{
            height,
            margin: `0 ${60 * scale}px ${26 * scale}px`,
            display: "flex",
            alignItems: "stretch",
            background: palette.surface,
            borderLeft: `${6 * scale}px solid ${palette.accent}`,
            overflow: "hidden",
          }}
        >
          {ticker.badge ? <Badge label={ticker.badge} theme={theme} scale={scale} inline /> : null}
          <div style={{ position: "relative", overflow: "hidden", flex: 1 }}>
            <div style={{ ...scroller, ...textStyle, color: palette.textPrimary }}>
              {Array.from({ length: repeats }).map((_, r) => (
                <span key={r}>{text}</span>
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // "band": full-bleed solid strip pinned to the bottom edge. Filled with the
  // panel token (not base+alpha, which is the same colour as the backdrop and so
  // rendered as nothing) and delineated with an accent rule so the band reads as
  // a distinct surface over both dark and light footage.
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
      <div
        style={{
          display: "flex",
          height,
          background: palette.surface,
          borderTop: `${3 * scale}px solid ${palette.accent}`,
        }}
      >
        {ticker.badge ? <Badge label={ticker.badge} theme={theme} scale={scale} inline /> : null}
        <div style={{ position: "relative", overflow: "hidden", flex: 1 }}>
          <div style={{ ...scroller, ...textStyle, color: palette.textPrimary }}>
            {Array.from({ length: repeats }).map((_, r) => (
              <span key={r}>{text}</span>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Badge: React.FC<{ label: string; theme: Theme; scale: number; inline?: boolean }> = ({
  label,
  theme,
  scale,
  inline,
}) => {
  const { palette, fonts } = theme;
  return (
    <div
      style={{
        background: palette.accent,
        color: contrastOn(palette.accent, palette),
        fontFamily: fonts.headline,
        fontWeight: fonts.headlineWeight,
        fontSize: 27 * scale,
        letterSpacing: 1.5 * scale,
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${26 * scale}px`,
        flexShrink: 0,
        borderRadius: inline ? 0 : 999,
        height: "100%",
      }}
    >
      {label}
    </div>
  );
};

/**
 * Picks the palette's dark or light text for legibility on an accent fill —
 * several themes use near-white accents where white-on-accent would vanish.
 */
export function contrastOn(background: string, palette: Theme["palette"]): string {
  const hex = background.length === 9 ? background.slice(0, 7) : background;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? palette.base : "#ffffff";
}
