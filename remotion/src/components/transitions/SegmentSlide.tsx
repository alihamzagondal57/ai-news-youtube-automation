import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { SegmentBackground } from "../media/SegmentBackground";

interface SegmentSlideProps {
  mediaSrc: string;
  accentColor: string;
  /** Local duration of the Sequence this is rendered inside (including any overlap padding). */
  durationInFrames: number;
  transitionFrames: number;
  fadeInAtStart: boolean;
  fadeOutAtEnd: boolean;
}

/**
 * Renders one segment's background inside its own (possibly overlap-extended)
 * Sequence, fading + sliding it in/out at the boundaries it shares with
 * neighboring segments.
 *
 * Deliberately NOT built on @remotion/transitions' TransitionSeries: that
 * API shortens total sequence duration by the transition length, which would
 * progressively desync the visual track from the voiceover audio (fixed,
 * absolute-timed, generated once by the voiceover step). This component
 * only ever extends a segment's Sequence bounds slightly into its
 * neighbors' territory — it never changes when a segment's *content* frame
 * (and therefore its captions/lower-third) is considered to start.
 */
export const SegmentSlide: React.FC<SegmentSlideProps> = ({
  mediaSrc,
  accentColor,
  durationInFrames,
  transitionFrames,
  fadeInAtStart,
  fadeOutAtEnd,
}) => {
  const frame = useCurrentFrame();

  const inOpacity = fadeInAtStart
    ? interpolate(frame, [0, transitionFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const outOpacity = fadeOutAtEnd
    ? interpolate(
        frame,
        [durationInFrames - transitionFrames, durationInFrames],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;

  const inSlide = fadeInAtStart
    ? interpolate(frame, [0, transitionFrames], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const outSlide = fadeOutAtEnd
    ? interpolate(
        frame,
        [durationInFrames - transitionFrames, durationInFrames],
        [0, -40],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;

  return (
    <AbsoluteFill style={{ opacity: Math.min(inOpacity, outOpacity), transform: `translateX(${inSlide + outSlide}px)` }}>
      <SegmentBackground mediaSrc={mediaSrc} accentColor={accentColor} />
    </AbsoluteFill>
  );
};
