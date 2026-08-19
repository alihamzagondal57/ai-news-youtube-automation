import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import type { MediaClipProps } from "../../types/newsVideoProps";
import { KenBurnsMedia } from "../media/KenBurnsMedia";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|avif)$/i;

interface ThemedBackdropProps {
  theme: Theme;
  /** One or more clips to sequence for this segment's background, or empty for the theme's own gradient stand-in. */
  media?: MediaClipProps[];
}

function resolve(src: string): string {
  return src.startsWith("http") ? src : staticFile(src);
}

/**
 * Segment background plus the legibility scrim.
 *
 * A stock clip is almost never exactly as long as the segment it backs
 * (5-60s footage vs. this pipeline's 8-220+s segments), so `media` is a
 * SEQUENCE, not a single source: render-server has already decided (see
 * infra/render-server/src/mediaTimeline.ts) whether to trim one clip to fit
 * or cut between several, and this just draws each beat in its own nested
 * Sequence with the given trim window. Previously a single continuous
 * OffthreadVideo just held its last decoded frame once a short clip ran out —
 * this is the fix for that freeze.
 *
 * The scrim is theme-controlled (palette.scrimStrength) because light themes
 * need far less darkening than dark ones — a fixed scrim makes pale themes look
 * muddy and dark themes look washed out.
 */
export const ThemedBackdrop: React.FC<ThemedBackdropProps> = ({ theme, media = [] }) => {
  const { palette } = theme;
  const scrim = `linear-gradient(180deg, rgba(0,0,0,0) 45%, ${hexWithAlpha(palette.base, palette.scrimStrength)} 100%)`;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.base }}>
      {media.length > 0 ? (
        media.map((clip, i) => (
          <Sequence key={`${clip.src}-${i}`} from={clip.startFrame} durationInFrames={clip.durationInFrames} layout="none">
            {/* Stock sources return stills as well as clips; OffthreadVideo can't
                render a still, so dispatch on extension. Stills have no trim
                concept — they simply hold for the beat's full duration. Ken
                Burns needs a real per-clip seed so consecutive beats don't
                all zoom/pan identically; the clip's own index is enough
                (deterministic, and every clip already has a distinct one). */}
            <KenBurnsMedia
              src={resolve(clip.src)}
              isImage={IMAGE_EXTENSIONS.test(clip.src)}
              durationInFrames={clip.durationInFrames}
              trimBeforeFrames={clip.trimBeforeFrames}
              trimAfterFrames={clip.trimAfterFrames}
              seed={i}
            />
          </Sequence>
        ))
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
