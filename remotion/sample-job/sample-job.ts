import { DEFAULT_THEME_ID } from "@ai-news/shared/theme";
import type { NewsVideoProps } from "../src/types/newsVideoProps";

const FPS = 30;
const SEGMENT_FRAMES = 120; // 4s per segment at 30fps

const SEGMENTS = [
  {
    text: "Markets across Europe opened higher this morning after a surprise rate decision.",
    lowerThirdText: "Markets React to Rate Decision",
    breaking: true,
  },
  {
    text: "Officials in Brussels announced a new package of energy measures for the winter.",
    lowerThirdText: "Brussels Unveils Energy Package",
    breaking: false,
  },
  {
    text: "And finally, researchers say the new transit line could open ahead of schedule.",
    lowerThirdText: "Transit Line Ahead of Schedule",
    breaking: false,
  },
];

/**
 * Local-dev fixture standing in for a real job's script.json / segment-timing.json /
 * captions.json / media-manifest.json, so the composition can be previewed and
 * rendered before the upstream pipeline services exist. Deliberately modest
 * (720p, ~15s) — real jobs pass full 4K, full-length inputProps at render time
 * (see remotion/README.md); this is just fast enough to iterate on locally.
 *
 * mediaSrc is left empty on purpose: no stock footage is committed to the repo
 * (copyright-safe sourcing happens at pipeline runtime), so segments fall back
 * to the gradient placeholder in SegmentBackground.
 */
export const sampleJobProps: NewsVideoProps = {
  title: "Sample Bulletin: Local Preview Fixture",
  resolution: { width: 1280, height: 720 },
  fps: FPS,
  outroDurationInFrames: 90,
  segments: SEGMENTS.map((segment, i) => ({
    id: i,
    text: segment.text,
    startFrame: i * SEGMENT_FRAMES,
    durationInFrames: SEGMENT_FRAMES,
    mediaSrc: "",
    lowerThirdText: segment.lowerThirdText,
    breaking: segment.breaking,
  })),
  captionWords: buildSampleCaptionWords(),
  tickerHeadlines: [
    "EU CENTRAL BANK HOLDS RATES STEADY",
    "ENERGY MINISTERS MEET IN BRUSSELS THURSDAY",
    "TRANSIT AUTHORITY CONFIRMS SPRING OPENING",
  ],
  audio: {
    voiceoverSrc: "sample/voiceover.wav",
    musicSrc: "sample/music.wav",
    musicVolume: 0.15,
    duckedVolume: 0.05,
  },
  branding: {
    channelName: "EuroWire News",
    accentColor: "#e11d2e",
  },
  themeId: DEFAULT_THEME_ID,
};

function buildSampleCaptionWords(): NewsVideoProps["captionWords"] {
  const words: NewsVideoProps["captionWords"] = [];
  let t = 0.4;
  const perWord = 0.32;
  for (const segment of SEGMENTS) {
    for (const word of segment.text.split(" ")) {
      words.push({ word, start: t, end: t + perWord * 0.85 });
      t += perWord;
    }
    t += 0.5; // pause between segments
  }
  return words;
}
