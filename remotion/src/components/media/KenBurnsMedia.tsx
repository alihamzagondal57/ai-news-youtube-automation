import React from "react";
import { Img, OffthreadVideo, interpolate, useCurrentFrame } from "remotion";

interface KenBurnsMediaProps {
  src: string;
  isImage: boolean;
  durationInFrames: number;
  trimBeforeFrames: number;
  trimAfterFrames: number;
  /** Deterministic seed (e.g. a clip's index within its segment) picking which of 4 zoom/pan variants this beat gets — same seed always renders identically, required for Remotion's frame-independent model. */
  seed: number;
}

/** #frames a rendered clip is up-close on ~4 zoom-direction/pan-direction combinations, cycled by `seed` so consecutive beats don't all move the same way. */
const VARIANTS: Array<{ zoomIn: boolean; panX: -1 | 0 | 1; panY: -1 | 0 | 1 }> = [
  { zoomIn: true, panX: 1, panY: 0 },
  { zoomIn: false, panX: -1, panY: 0 },
  { zoomIn: true, panX: 0, panY: 1 },
  { zoomIn: false, panX: 0, panY: -1 },
];

const MAX_ZOOM = 1.12;
const MAX_PAN_PERCENT = 4;

/**
 * Continuous slow zoom/pan over a clip's own on-screen duration — the
 * "Ken Burns" effect news/social editors apply to otherwise-static stock
 * footage and stills so nothing on screen sits completely still. Subtle by
 * design (12% zoom range, pan capped at 4% and shrinking with it): the point
 * is to add quiet motion, not distract from the voiceover or the captions
 * layered on top.
 *
 * Pan headroom is tied to the current zoom level rather than a fixed
 * percentage: object-fit: cover only guarantees full frame coverage at 1x
 * scale, so panning at 1x (no zoom yet) would reveal an edge nothing was
 * ever rendered large enough to cover. Headroom grows linearly as zoom does,
 * reaching its full 4% only once the clip is at MAX_ZOOM.
 */
export const KenBurnsMedia: React.FC<KenBurnsMediaProps> = ({ src, isImage, durationInFrames, trimBeforeFrames, trimAfterFrames, seed }) => {
  const frame = useCurrentFrame();
  const variant = VARIANTS[((seed % VARIANTS.length) + VARIANTS.length) % VARIANTS.length];

  const progress = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoomProgress = variant.zoomIn ? progress : 1 - progress;
  const scale = 1 + zoomProgress * (MAX_ZOOM - 1);

  // Pan headroom grows with how much oversized headroom the current zoom
  // level actually provides (0 at scale 1, MAX_PAN_PERCENT at MAX_ZOOM) --
  // panning further than that would reveal an edge object-fit: cover never
  // rendered content for.
  const panHeadroom = (MAX_PAN_PERCENT * (scale - 1)) / (MAX_ZOOM - 1);
  const translateX = variant.panX * progress * panHeadroom;
  const translateY = variant.panY * progress * panHeadroom;

  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
    transformOrigin: "center center",
  };

  return isImage ? (
    <Img src={src} style={style} />
  ) : (
    <OffthreadVideo src={src} muted trimBefore={trimBeforeFrames} trimAfter={trimAfterFrames} style={style} />
  );
};
