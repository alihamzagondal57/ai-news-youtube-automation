import React from "react";
import { AbsoluteFill, Sequence, type CalculateMetadataFunction } from "remotion";
import { getThemeOrDefault } from "@ai-news/shared/theme";
import { AudioMix } from "../audio/AudioMix";
import { BreakingNewsBumper } from "../components/motion-graphics/BreakingNewsBumper";
import { ThemedCaptions } from "../components/themed/ThemedCaptions";
import { ThemedIntro, INTRO_DURATION_IN_FRAMES } from "../components/themed/ThemedIntro";
import { ThemedLowerThird } from "../components/themed/ThemedLowerThird";
import { ThemedOutro } from "../components/themed/ThemedOutro";
import { ThemedSegmentSlide } from "../components/themed/ThemedSegmentSlide";
import { ThemedTicker } from "../components/themed/ThemedTicker";
import { newsVideoPropsSchema, type NewsVideoProps } from "../types/newsVideoProps";

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
  themeId,
}) => {
  const theme = getThemeOrDefault(themeId);
  const lastSegment = segments[segments.length - 1];
  const contentEndFrame = lastSegment.startFrame + lastSegment.durationInFrames;
  const totalDurationInFrames = contentEndFrame + outroDurationInFrames;

  // Theme-driven, and load-bearing beyond looks: render-server widens
  // targeted-re-render invalidation by exactly this many frames, because a
  // segment's visuals bleed this far into each neighbour. buildInputProps reads
  // it from the same catalog entry, so the two can't disagree.
  const transitionFrames = theme.transition.frames;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.base }}>
      {/* Segment backgrounds, each in its own (overlap-padded) Sequence so
          adjacent segments can transition across their shared boundary. */}
      {segments.map((segment, i) => {
        const isFirst = i === 0;
        const isLast = i === segments.length - 1;
        const overlapStart = segment.startFrame - (isFirst ? 0 : transitionFrames);
        const overlapEnd = segment.startFrame + segment.durationInFrames + (isLast ? 0 : transitionFrames);
        const localDuration = overlapEnd - overlapStart;

        return (
          <Sequence key={segment.id} from={overlapStart} durationInFrames={localDuration}>
            <ThemedSegmentSlide
              media={segment.media}
              theme={theme}
              durationInFrames={localDuration}
              transitionFrames={transitionFrames}
              fadeInAtStart={!isFirst}
              fadeOutAtEnd={!isLast}
            />
          </Sequence>
        );
      })}

      {/* Lower-thirds + breaking-news flash: exact segment timing (no transition
          padding), independent of the background transition. */}
      {segments.map((segment) => (
        <Sequence key={`overlay-${segment.id}`} from={segment.startFrame} durationInFrames={segment.durationInFrames}>
          <ThemedLowerThird text={segment.lowerThirdText} theme={theme} />
          <BreakingNewsBumper accentColor={theme.palette.accent} enabled={segment.breaking} />
        </Sequence>
      ))}

      {/* Word-synced captions run on the absolute video timeline, matching the
          Whisper output exactly. The theme changes only their presentation. */}
      <Sequence from={0} durationInFrames={contentEndFrame}>
        <ThemedCaptions words={captionWords} theme={theme} />
      </Sequence>

      {/* Ticker runs for the whole video, including over the outro. */}
      <ThemedTicker headlines={tickerHeadlines} theme={theme} />

      {/* Intro overlays the start of the first segment rather than displacing
          it, so audio/captions never shift. */}
      <Sequence from={0} durationInFrames={INTRO_DURATION_IN_FRAMES}>
        <ThemedIntro channelName={branding.channelName} title={title} theme={theme} />
      </Sequence>

      <Sequence from={contentEndFrame} durationInFrames={outroDurationInFrames}>
        <ThemedOutro channelName={branding.channelName} theme={theme} />
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
