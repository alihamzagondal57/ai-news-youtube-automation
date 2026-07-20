import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import type { Theme } from "@ai-news/shared/theme";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|avif)$/i;

interface ThemedBackdropProps {
  theme: Theme;
  /** Stock footage path, or empty for the theme's own gradient stand-in. */
  mediaSrc?: string;
}

/**
 * Segment background plus the legibility scrim.
 *
 * The scrim is theme-controlled (palette.scrimStrength) because light themes
 * need far less darkening than dark ones — a fixed scrim makes pale themes look
 * muddy and dark themes look washed out.
 */
export const ThemedBackdrop: React.FC<ThemedBackdropProps> = ({ theme, mediaSrc }) => {
  const { palette } = theme;
  const scrim = `linear-gradient(180deg, rgba(0,0,0,0) 45%, ${hexWithAlpha(palette.base, palette.scrimStrength)} 100%)`;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.base }}>
      {mediaSrc ? (
        // Stock sources return stills as well as clips; OffthreadVideo can't
        // render a still, so dispatch on extension.
        IMAGE_EXTENSIONS.test(mediaSrc) ? (
          <Img
            src={mediaSrc.startsWith("http") ? mediaSrc : staticFile(mediaSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <OffthreadVideo
            src={mediaSrc.startsWith("http") ? mediaSrc : staticFile(mediaSrc)}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 120% at 22% 18%, ${hexWithAlpha(palette.accent, 0.28)} 0%, ${palette.base} 62%)`,
          }}
        />
      )}
      <AbsoluteFill style={{ background: scrim }} />
    </AbsoluteFill>
  );
};

/** #rrggbb + 0..1 alpha -> #rrggbbaa. Tolerates values that already carry alpha. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const base = hex.length === 9 ? hex.slice(0, 7) : hex;
  const clamped = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `${base}${byte}`;
}
