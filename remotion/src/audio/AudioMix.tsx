import React from "react";
import { Audio, interpolate, staticFile } from "remotion";

interface AudioMixProps {
  voiceoverSrc: string;
  musicSrc: string;
  musicVolume: number;
  duckedVolume: number;
  /** Frames of headroom at the very start/end (intro/outro) where music can swell above the ducked level. */
  swellFrames: number;
  totalDurationInFrames: number;
}

const resolve = (src: string) => (src.startsWith("http") ? src : staticFile(src));

/** Voiceover at full volume throughout; music ducked under it, swelling only during intro/outro silence. */
export const AudioMix: React.FC<AudioMixProps> = ({
  voiceoverSrc,
  musicSrc,
  musicVolume,
  duckedVolume,
  swellFrames,
  totalDurationInFrames,
}) => {
  const musicVolumeAtFrame = (frame: number): number => {
    if (frame < swellFrames) {
      return interpolate(frame, [0, swellFrames], [musicVolume, duckedVolume], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (frame > totalDurationInFrames - swellFrames) {
      return interpolate(
        frame,
        [totalDurationInFrames - swellFrames, totalDurationInFrames],
        [duckedVolume, musicVolume],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
    }
    return duckedVolume;
  };

  return (
    <>
      <Audio src={resolve(voiceoverSrc)} />
      {musicSrc ? <Audio src={resolve(musicSrc)} volume={musicVolumeAtFrame} loop /> : null}
    </>
  );
};
