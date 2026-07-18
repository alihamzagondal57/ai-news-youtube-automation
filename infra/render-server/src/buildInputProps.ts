import { config } from "./config.js";
import type { JobAssets } from "./jobAssets.js";

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
    mediaSrc: string;
    lowerThirdText: string;
    breaking: boolean;
  }>;
  captionWords: Array<{ word: string; start: number; end: number }>;
  tickerHeadlines: string[];
  audio: { voiceoverSrc: string; musicSrc: string; musicVolume: number; duckedVolume: number };
  branding: { channelName: string; accentColor: string };
}

const OUTRO_SECONDS = 5;

export function buildInputProps(assets: JobAssets): NewsVideoRenderProps {
  const { script, segmentTiming, captions, mediaManifest } = assets;
  const { fps, width, height } = config.video;

  const timingById = new Map(segmentTiming.segments.map((s) => [s.id, s]));
  const clipById = new Map(mediaManifest.clips.map((c) => [c.segmentId, c]));

  const segments = script.segments.map((segment) => {
    const timing = timingById.get(segment.id);
    if (!timing) {
      throw new Error(`No segment-timing entry for segment ${segment.id} (job ${script.jobId})`);
    }
    const clip = clipById.get(segment.id);
    return {
      id: segment.id,
      text: segment.text,
      startFrame: Math.round(timing.startSeconds * fps),
      durationInFrames: Math.round((timing.endSeconds - timing.startSeconds) * fps),
      mediaSrc: clip?.file ?? "",
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
  };
}

function buildTickerHeadlines(script: JobAssets["script"]): string[] {
  return [script.title, ...script.segments.map((s) => s.headline)].map((h) => h.toUpperCase());
}
