import React from "react";
import { AbsoluteFill, Sequence, type CalculateMetadataFunction } from "remotion";
import { AudioMix } from "../audio/AudioMix";
import { BreakingNewsBumper } from "../components/motion-graphics/BreakingNewsBumper";
import { IntroStinger, INTRO_DURATION_IN_FRAMES } from "../components/motion-graphics/IntroStinger";
import { OutroCTA } from "../components/motion-graphics/OutroCTA";
import { LowerThird } from "../components/lower-thirds/LowerThird";
import { NewsTicker } from "../components/ticker/NewsTicker";
import { SegmentSlide } from "../components/transitions/SegmentSlide";
import { WordHighlightCaptions } from "../components/captions/WordHighlightCaptions";
import { newsVideoPropsSchema, type NewsVideoProps } from "../types/newsVideoProps";

const TRANSITION_FRAMES = 15;

export const calculateNewsVideoMetadata: CalculateMetadataFunction<NewsVideoProps> = ({ props }) => {
  const lastSegment = props.segments[props.segments.length - 1];
  const contentEndFrame = lastSegment.startFrame + lastSegment.durationInFrames;
  const durationInFrames = contentEndFrame + props.outroDurationInFrames;

  return {
    durationInFrames,
    fps: props.fps,
    width: props.resolution.width,
    height: props.resolution.height,
  };
};

export const NewsVideo: React.FC<NewsVideoProps> = ({
  title,
  segments,
  captionWords,
  tickerHeadlines,
  audio,
  branding,
  outroDurationInFrames,
}) => {
  const lastSegment = segments[segments.length - 1];
  const contentEndFrame = lastSegment.startFrame + lastSegment.durationInFrames;
  const totalDurationInFrames = contentEndFrame + outroDurationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Segment backgrounds, each in its own (overlap-padded) Sequence for boundary crossfades. */}
      {segments.map((segment, i) => {
        const isFirst = i === 0;
        const isLast = i === segments.length - 1;
        const overlapStart = segment.startFrame - (isFirst ? 0 : TRANSITION_FRAMES);
        const overlapEnd = segment.startFrame + segment.durationInFrames + (isLast ? 0 : TRANSITION_FRAMES);
        const localDuration = overlapEnd - overlapStart;

        return (
          <Sequence key={segment.id} from={overlapStart} durationInFrames={localDuration}>
            <SegmentSlide
              mediaSrc={segment.mediaSrc}
              accentColor={branding.accentColor}
              durationInFrames={localDuration}
              transitionFrames={TRANSITION_FRAMES}
              fadeInAtStart={!isFirst}
              fadeOutAtEnd={!isLast}
            />
          </Sequence>
        );
      })}

      {/* Lower-thirds + breaking-news flash: exact segment timing (no transition padding), independent of background fades. */}
      {segments.map((segment) => (
        <Sequence key={`overlay-${segment.id}`} from={segment.startFrame} durationInFrames={segment.durationInFrames}>
          <LowerThird text={segment.lowerThirdText} accentColor={branding.accentColor} />
          <BreakingNewsBumper accentColor={branding.accentColor} enabled={segment.breaking} />
        </Sequence>
      ))}

      {/* Word-synced captions run on the absolute video timeline, matching the Whisper output exactly. */}
      <Sequence from={0} durationInFrames={contentEndFrame}>
        <WordHighlightCaptions words={captionWords} accentColor={branding.accentColor} />
      </Sequence>

      {/* Ticker runs for the whole video, including over the outro. */}
      <NewsTicker headlines={tickerHeadlines} accentColor={branding.accentColor} />

      {/* Intro stinger overlays the start of the first segment rather than displacing it, so audio/captions never shift. */}
      <Sequence from={0} durationInFrames={INTRO_DURATION_IN_FRAMES}>
        <IntroStinger channelName={branding.channelName} title={title} accentColor={branding.accentColor} />
      </Sequence>

      <Sequence from={contentEndFrame} durationInFrames={outroDurationInFrames}>
        <OutroCTA channelName={branding.channelName} accentColor={branding.accentColor} />
      </Sequence>

      <AudioMix
        voiceoverSrc={audio.voiceoverSrc}
        musicSrc={audio.musicSrc}
        musicVolume={audio.musicVolume}
        duckedVolume={audio.duckedVolume}
        swellFrames={INTRO_DURATION_IN_FRAMES}
        totalDurationInFrames={totalDurationInFrames}
      />
    </AbsoluteFill>
  );
};

export { newsVideoPropsSchema };
