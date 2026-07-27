import { DEFAULT_THEME_ID, getThemeOrDefault } from "@ai-news/shared/theme";
import { config } from "./config.js";
import type { JobAssets } from "./jobAssets.js";
import { buildSegmentMediaTimeline, mediaTimelineToFrames, type TimelineClipSource } from "./mediaTimeline.js";

export interface MediaClipProps {
  src: string;
  /** Frames into the SEGMENT's own (Sequence-local) timeline this beat starts at. */
  startFrame: number;
  durationInFrames: number;
  trimBeforeFrames: number;
  trimAfterFrames: number;
}

/**
 * Mirrors remotion/src/types/newsVideoProps.ts's NewsVideoProps shape.
 * Deliberately a separate type rather than an import: Remotion compositions
 * must stay free of this server's Node-only dependencies (AWS SDK, Express),
 * so the two workspaces don't share runtime code. Remotion's own
 * composition-side zod schema (attached via <Composition schema={...}>) is
 * the actual runtime source of truth — renderMedia will reject anything
 * built here that doesn't match it, so a drift between the two shapes fails
 * loudly at render time rather than silently.
 */
export interface NewsVideoRenderProps {
  title: string;
  resolution: { width: number; height: number };
  fps: number;
  outroDurationInFrames: number;
  segments: Array<{
    id: number;
    text: string;
    startFrame: number;
    durationInFrames: number;
    /**
     * One or more clips to sequence behind this segment — never a single
     * `mediaSrc` string. A stock clip is almost never exactly as long as its
     * segment (5-60s footage vs. 8-220+s segments), so the composition needs
     * either a trimmed excerpt of one clip or several cut together; see
     * mediaTimeline.ts for which. Empty when media-sourcing hasn't run yet
     * (falls back to the theme's gradient placeholder).
     */
    media: MediaClipProps[];
    lowerThirdText: string;
    breaking: boolean;
  }>;
  captionWords: Array<{ word: string; start: number; end: number }>;
  tickerHeadlines: string[];
  audio: { voiceoverSrc: string; musicSrc: string; musicVolume: number; duckedVolume: number };
  branding: { channelName: string; accentColor: string };
  themeId: string;
  /**
   * Mirrors the resolved theme's transition.frames. Carried explicitly so
   * segmentPlan can widen targeted-re-render invalidation by the right amount
   * without importing the composition — both sides resolve it from the same
   * catalog entry, so they cannot drift. Also the padding this file itself
   * uses to size each segment's media timeline (see buildSegmentMedia below).
   */
  transitionFrames: number;
}

const OUTRO_SECONDS = 5;

export interface BuildInputPropsOptions {
  /** Resolved upstream (review override or auto-rotation); falls back to the default theme. */
  themeId?: string;
}

export function buildInputProps(assets: JobAssets, options: BuildInputPropsOptions = {}): NewsVideoRenderProps {
  const { script, segmentTiming, captions, mediaManifest } = assets;
  const { fps, width, height } = config.video;
  const theme = getThemeOrDefault(options.themeId ?? DEFAULT_THEME_ID);
  const transitionFrames = theme.transition.frames;

  const timingById = new Map(segmentTiming.segments.map((s) => [s.id, s]));
  const clipById = new Map(mediaManifest.clips.map((c) => [c.segmentId, c]));

  const segments = script.segments.map((segment, i) => {
    const timing = timingById.get(segment.id);
    if (!timing) {
      throw new Error(`No segment-timing entry for segment ${segment.id} (job ${script.jobId})`);
    }
    const startFrame = Math.round(timing.startSeconds * fps);
    const durationInFrames = Math.round((timing.endSeconds - timing.startSeconds) * fps);

    const clip = clipById.get(segment.id);
    const isFirst = i === 0;
    const isLast = i === script.segments.length - 1;
    const media = clip
      ? buildSegmentMedia(clip, { startFrame, durationInFrames, isFirst, isLast, transitionFrames, fps })
      : [];

    return {
      id: segment.id,
      text: segment.text,
      startFrame,
      durationInFrames,
      media,
      lowerThirdText: segment.headline,
      breaking: false,
    };
  });

  return {
    title: script.title,
    resolution: { width, height },
    fps,
    outroDurationInFrames: Math.round(OUTRO_SECONDS * fps),
    segments,
    captionWords: captions.words,
    tickerHeadlines: buildTickerHeadlines(script),
    audio: {
      voiceoverSrc: "voiceover.wav",
      musicSrc: mediaManifest.music?.file ?? "",
      musicVolume: 0.15,
      duckedVolume: 0.05,
    },
    branding: config.branding,
    themeId: theme.id,
    transitionFrames,
  };
}

/**
 * Builds one segment's media timeline, sized to the PADDED window the
 * composition actually fills (`ThemedSegmentSlide`'s Sequence extends
 * `transitionFrames` into each non-edge neighbour so the cross-fade/wipe/etc.
 * has real footage to transition through — see NewsVideo.tsx). Mirrors that
 * padding math (also independently duplicated by segmentPlan.ts's
 * `computeDirtyRanges` for the same reason: both need transitionFrames-aware
 * ranges, computed from the same `theme.transition.frames` source, so they
 * can't drift even though the arithmetic is written twice).
 */
function buildSegmentMedia(
  clip: JobAssets["mediaManifest"]["clips"][number],
  options: { startFrame: number; durationInFrames: number; isFirst: boolean; isLast: boolean; transitionFrames: number; fps: number },
): MediaClipProps[] {
  const { startFrame, durationInFrames, isFirst, isLast, transitionFrames, fps } = options;

  const overlapStartFrame = startFrame - (isFirst ? 0 : transitionFrames);
  const overlapEndFrame = startFrame + durationInFrames + (isLast ? 0 : transitionFrames);
  const localDurationFrames = overlapEndFrame - overlapStartFrame;
  const localDurationSeconds = localDurationFrames / fps;

  const primary: TimelineClipSource = { file: clip.file, durationSeconds: clip.durationSeconds };
  const alternatives: TimelineClipSource[] = clip.alternatives.map((a) => ({ file: a.file, durationSeconds: a.durationSeconds }));

  const secondsTimeline = buildSegmentMediaTimeline(localDurationSeconds, primary, alternatives);
  const frameTimeline = mediaTimelineToFrames(secondsTimeline, fps);

  // localDurationSeconds -> frames and each entry's own seconds -> frames can
  // each round independently by up to half a frame; force the LAST entry to
  // close exactly on localDurationFrames so the media Sequence never falls a
  // frame short (a black flash) or a frame long (desyncs whatever mounts next).
  const last = frameTimeline[frameTimeline.length - 1];
  if (last) {
    const drift = localDurationFrames - (last.startFrame + last.durationInFrames);
    if (drift !== 0) {
      last.durationInFrames += drift;
      last.trimAfterFrames += drift;
    }
  }

  return frameTimeline.map((entry): MediaClipProps => ({
    src: entry.file,
    startFrame: entry.startFrame,
    durationInFrames: entry.durationInFrames,
    trimBeforeFrames: entry.trimBeforeFrames,
    trimAfterFrames: entry.trimAfterFrames,
  }));
}

function buildTickerHeadlines(script: JobAssets["script"]): string[] {
  return [script.title, ...script.segments.map((s) => s.headline)].map((h) => h.toUpperCase());
}
