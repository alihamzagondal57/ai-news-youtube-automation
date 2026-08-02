// Proves the two review-dashboard overrides render-server didn't apply before
// this feature (docs/REVIEW-DASHBOARD.md's own "still to do" note) now
// actually work:
//
//   1. buildInputProps() honours review-state.json's clipOverrides — a
//      segment's PRIMARY clip is genuinely swapped for one of its own
//      alternatives, not just recorded and ignored. Pure logic, no I/O.
//   2. A style override actually changes RENDERED PIXELS, not just the props
//      object — a real Remotion still render with ticker.backgroundColor set
//      produces a visibly different colour than the theme's own default.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { Captions, MediaLicense, MediaManifest, Script, SegmentTiming } from "../services/shared/src/schemas/job.ts";
import { getTheme } from "../services/shared/src/theme/index.ts";
import { buildInputProps } from "../infra/render-server/src/buildInputProps.ts";
import type { JobAssets } from "../infra/render-server/src/jobAssets.ts";
import { colorDistance, generateColorClip, regionAverageColor } from "./lib/media.mts";

const REPO = "E:\\Youtube Ai Automation Agent";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── Part 1: clip-override swap, pure logic (no rendering) ──────────────────
const FAKE_LICENSE: MediaLicense = { source: "pexels", licenseType: "Pexels License", url: "https://www.pexels.com/example" };
const JOB_ID = "99999999-1111-1111-1111-999999999999";

function fixtureAssets(): JobAssets {
  const script: Script = {
    jobId: JOB_ID,
    title: "Override Test",
    segments: [{ id: 0, text: "hello world", headline: "Hello World", visualCue: "x", estSeconds: 10 }],
  };
  const segmentTiming: SegmentTiming = {
    jobId: JOB_ID,
    totalDurationSeconds: 10,
    segments: [{ id: 0, startSeconds: 0, endSeconds: 10 }],
  };
  const captions: Captions = { jobId: JOB_ID, words: [] };
  const mediaManifest: MediaManifest = {
    jobId: JOB_ID,
    clips: [
      {
        segmentId: 0,
        file: "clip-primary.mp4",
        license: FAKE_LICENSE,
        durationSeconds: 10,
        alternatives: [
          { file: "clip-alt1.mp4", license: FAKE_LICENSE, durationSeconds: 10 },
          { file: "clip-alt2.mp4", license: FAKE_LICENSE, durationSeconds: 10 },
        ],
      },
    ],
    music: null,
    sfx: [],
  };
  return { dir: "/unused", script, segmentTiming, captions, mediaManifest };
}

function main1() {
  const assets = fixtureAssets();

  const noOverride = buildInputProps(assets, { themeId: "midnight-wire" });
  check(
    "with no override, the segment's own primary clip is used",
    noOverride.segments[0].media[0]?.src === "clip-primary.mp4",
    `src: ${noOverride.segments[0].media[0]?.src}`,
  );

  const withOverride = buildInputProps(assets, {
    themeId: "midnight-wire",
    clipOverrides: [{ segmentId: 0, file: "clip-alt1.mp4" }],
  });
  check(
    "a clip override swaps the alternative into the primary slot",
    withOverride.segments[0].media[0]?.src === "clip-alt1.mp4",
    `src: ${withOverride.segments[0].media[0]?.src}`,
  );

  let threw = false;
  try {
    buildInputProps(assets, { clipOverrides: [{ segmentId: 0, file: "not-a-known-file.mp4" }] });
  } catch {
    threw = true;
  }
  check(
    "an override naming a file this segment doesn't know throws rather than silently using the wrong footage",
    threw,
    "threw as expected",
  );

  const withStyle = buildInputProps(assets, { themeId: "midnight-wire", style: { ticker: { textColor: "#123456" } } });
  check(
    "a style option flows through unchanged into the returned render props",
    withStyle.style.ticker?.textColor === "#123456",
    JSON.stringify(withStyle.style),
  );

  const withoutStyle = buildInputProps(assets, { themeId: "midnight-wire" });
  check("style defaults to {} when no override is given", Object.keys(withoutStyle.style).length === 0, JSON.stringify(withoutStyle.style));
}

// ── Part 2: a style override actually changes rendered pixels ──────────────
const WIDTH = 960;
const HEIGHT = 540;
const OVERRIDE_BG = { r: 0, g: 200, b: 0 }; // saturated green — unlike any theme's own ticker fill
const THEME_ID = "midnight-wire"; // "band" variant: full-bleed solid fill, easiest to measure (see test-ticker-loop.mts)

// Thin strip right at the very bottom edge of the frame: the ticker sits
// flush at the bottom (justifyContent: flex-end) and its scrolling text is
// vertically CENTERED within the band, so the last few px are clear of glyphs
// regardless of the theme's own ticker.heightScale.
const BOTTOM_STRIP = { x: 40, y: HEIGHT - 8, width: WIDTH - 80, height: 5 };

async function main2() {
  const work = await mkdtemp(join(tmpdir(), "render-override-style-"));
  const publicDir = join(work, "public");
  await mkdir(publicDir, { recursive: true });
  try {
    await generateColorClip("gray", 12, 30, WIDTH, HEIGHT, join(publicDir, "clip.mp4"));
    await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(publicDir, "voiceover.wav"));
    const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts"), publicDir });

    const theme = getTheme(THEME_ID);
    const baseProps = {
      title: "Style Override Probe",
      resolution: { width: WIDTH, height: HEIGHT },
      fps: 30,
      outroDurationInFrames: 30,
      segments: [
        {
          id: 0,
          text: "probe",
          startFrame: 0,
          durationInFrames: 90,
          media: [{ src: "clip.mp4", startFrame: 0, durationInFrames: 90, trimBeforeFrames: 0, trimAfterFrames: 90 }],
          lowerThirdText: "",
          breaking: false,
        },
      ],
      captionWords: [],
      tickerHeadlines: ["OVERRIDE PROBE HEADLINE FOR SAMPLING"],
      themeId: theme.id,
      transitionFrames: theme.transition.frames,
      audio: { voiceoverSrc: "voiceover.wav", musicSrc: "", musicVolume: 0.15, duckedVolume: 0.05 },
      branding: { channelName: "EuroWire News", accentColor: "#e11d2e" },
    };

    const withoutOverride = { ...baseProps, style: {} } as unknown as Record<string, unknown>;
    const withOverride = {
      ...baseProps,
      style: { ticker: { backgroundColor: `rgb(${OVERRIDE_BG.r},${OVERRIDE_BG.g},${OVERRIDE_BG.b})` } },
    } as unknown as Record<string, unknown>;

    // Frame 80: past the intro stinger's 75-frame full-screen overlay (see
    // ThemedIntro.tsx's INTRO_DURATION_IN_FRAMES), still inside the one
    // 90-frame segment — otherwise both renders would just sample the intro,
    // which doesn't depend on style and would make this test a false pass.
    const SAMPLE_FRAME = 80;
    const compositionA = await selectComposition({ serveUrl, id: "NewsVideo", inputProps: withoutOverride });
    const outA = join(work, "no-override.png");
    await renderStill({ composition: compositionA, serveUrl, output: outA, frame: SAMPLE_FRAME, inputProps: withoutOverride });

    const compositionB = await selectComposition({ serveUrl, id: "NewsVideo", inputProps: withOverride });
    const outB = join(work, "with-override.png");
    await renderStill({ composition: compositionB, serveUrl, output: outB, frame: SAMPLE_FRAME, inputProps: withOverride });

    const colorA = await regionAverageColor(outA, BOTTOM_STRIP, work);
    const colorB = await regionAverageColor(outB, BOTTOM_STRIP, work);

    check(
      `without a style override, the ticker uses ${THEME_ID}'s own colour`,
      colorDistance(colorA, OVERRIDE_BG) > 60,
      `sampled rgb(${colorA.r},${colorA.g},${colorA.b}) vs override green`,
    );
    check(
      "WITH a style override, the ticker's rendered background actually changes to the override colour",
      colorDistance(colorB, OVERRIDE_BG) < 30,
      `sampled rgb(${colorB.r},${colorB.g},${colorB.b}) vs override green`,
    );
    check(
      "the two renders (same theme, same everything else) actually differ — the override isn't a no-op",
      colorDistance(colorA, colorB) > 60,
      `distance ${colorDistance(colorA, colorB).toFixed(1)}`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  main1();
  await main2();
  console.log(failures === 0 ? "\nALL RENDER-OVERRIDE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
