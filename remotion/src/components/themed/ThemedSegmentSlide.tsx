import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Theme } from "@ai-news/shared/theme";
import type { MediaClipProps } from "../../types/newsVideoProps";
import { ThemedBackdrop, hexWithAlpha } from "./ThemedBackdrop";

interface ThemedSegmentSlideProps {
  media: MediaClipProps[];
  theme: Theme;
  /** Local duration of the Sequence this sits in, including overlap padding. */
  durationInFrames: number;
  transitionFrames: number;
  fadeInAtStart: boolean;
  fadeOutAtEnd: boolean;
}

/**
 * One segment's background, transitioning at the boundaries it shares with its
 * neighbours. The style is theme-driven; the *timing* is not.
 *
 * Deliberately NOT built on @remotion/transitions' TransitionSeries: that API
 * shortens total sequence duration by the transition length, which would
 * progressively desync the visual track from the voiceover (fixed, absolute-timed,
 * generated once by the voiceover step). Every style here only extends a
 * segment's Sequence slightly into its neighbours' territory — none of them
 * change when a segment's content frame is considered to start, so captions and
 * lower-thirds stay locked to the audio regardless of which theme is applied.
 */
export const ThemedSegmentSlide: React.FC<ThemedSegmentSlideProps> = ({
  media,
  theme,
  durationInFrames,
  transitionFrames,
  fadeInAtStart,
  fadeOutAtEnd,
}) => {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  // 0 at the very edge of a shared boundary, 1 once fully established.
  const inProgress = fadeInAtStart ? interpolate(frame, [0, transitionFrames], [0, 1], clamp) : 1;
  const outProgress = fadeOutAtEnd
    ? interpolate(frame, [durationInFrames - transitionFrames, durationInFrames], [1, 0], clamp)
    : 1;
  const settled = Math.min(inProgress, outProgress);

  let opacity = settled;
  let transform: string | undefined;
  let clipPath: string | undefined;
  let dipOverlay = 0;

  switch (theme.transition.style) {
    case "slideX": {
      const enter = (1 - inProgress) * 40;
      const exit = (1 - outProgress) * -40;
      transform = `translateX(${enter + exit}px)`;
      break;
    }
    case "zoomIn": {
      // Incoming settles from slightly oversized; outgoing keeps drifting in.
      const scale = 1 + (1 - inProgress) * 0.08 + (1 - outProgress) * 0.04;
      transform = `scale(${scale})`;
      break;
    }
    case "wipeX": {
      // Hard-edged reveal rather than a dissolve — opacity stays solid.
      opacity = 1;
      const revealed = inProgress * 100;
      const retreated = outProgress * 100;
      clipPath = `inset(0 ${100 - retreated}% 0 ${100 - revealed}%)`;
      break;
    }
    case "dipToColor":
      // Fades through the accent rather than through the frame beneath.
      dipOverlay = 1 - settled;
      break;
    case "crossfade":
    default:
      break;
  }

  return (
    <AbsoluteFill style={{ opacity, transform, clipPath }}>
      <ThemedBackdrop theme={theme} media={media} />
      {dipOverlay > 0 ? (
        <AbsoluteFill style={{ background: hexWithAlpha(theme.palette.accent, dipOverlay * 0.85) }} />
      ) : null}
    </AbsoluteFill>
  );
};
