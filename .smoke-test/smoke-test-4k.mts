// Proves the render + targeted-re-render + stitch path holds at the production
// resolution (3840x2160), and measures what it actually costs.
//
// Phase 1 (short): stitched 4K vs a monolithic 4K reference — confirms stitching
//   is still seam-free at full resolution, not just at the 640x360 used by the
//   main stitch suite.
// Phase 2 (long, many segments): cold render + targeted re-render across 8
//   segments / 9 chunks — exercises multi-chunk stitching and reports timings
//   and peak memory.
import { mkdtemp, copyFile, rm, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createLogger } from "@ai-news/shared";
import { getTheme } from "../services/shared/src/theme/index.ts";
import type { NewsVideoRenderProps } from "../infra/render-server/src/buildInputProps.ts";
import { renderSegmented } from "../infra/render-server/src/renderSegmented.ts";
import { comparePsnr, generateColorClip, probeVideo } from "./lib/media.mts";

const REPO = "E:\\Youtube Ai Automation Agent";
const W = 3840;
const H = 2160;
const FPS = 30;
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? "4");
const PSNR_THRESHOLD_DB = 40;

// broadsheet: wipeX at 18 frames — a hard-edged transition is the least forgiving
// of a stitch fault, and its 18 frames exercise a non-default invalidation width.
const THEME = getTheme("broadsheet");

// PHASE=1 runs only the stitch-fidelity check, PHASE=2 only the long
// multi-segment run; unset runs both. Split so each fits in a foreground turn
// and neither can be silently lost to a session teardown.
const PHASE = process.env.PHASE ?? "all";
const runPhase1 = PHASE === "1" || PHASE === "all";
const runPhase2 = PHASE === "2" || PHASE === "all";

const logger = createLogger("4k-smoke");
let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

const CLIPS = ["red", "green", "blue", "yellow", "magenta", "cyan", "orange", "purple", "white"];

function buildProps(segmentCount: number, segFrames: number, outroFrames: number, clips: string[]): NewsVideoRenderProps {
  return {
    title: "4K Production Resolution Test",
    resolution: { width: W, height: H },
    fps: FPS,
    outroDurationInFrames: outroFrames,
    segments: Array.from({ length: segmentCount }, (_, i) => ({
      id: i,
      text: `Segment ${i} narration for the 4K render test.`,
      startFrame: i * segFrames,
      durationInFrames: segFrames,
      media: [{ src: clips[i], startFrame: 0, durationInFrames: segFrames, trimBeforeFrames: 0, trimAfterFrames: segFrames }],
      lowerThirdText: `Segment ${i} Headline At Four K`,
      breaking: false,
    })),
    captionWords: Array.from({ length: segmentCount * 2 }, (_, i) => ({
      word: i % 2 === 0 ? "four" : "kay",
      start: i * 0.75,
      end: i * 0.75 + 0.5,
    })),
    tickerHeadlines: ["FOUR K RENDER TEST", "MULTI SEGMENT STITCH", "PRODUCTION RESOLUTION"],
    themeId: THEME.id,
    transitionFrames: THEME.transition.frames,
    audio: { voiceoverSrc: "voiceover.wav", musicSrc: "music.wav", musicVolume: 0.15, duckedVolume: 0.05 },
    branding: { channelName: "EuroWire News", accentColor: "#e11d2e" },
  };
}

function fmt(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(1)}s`;
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "4k-smoke-"));
  const publicDir = join(work, "public");
  await mkdir(publicDir, { recursive: true });

  let peakRssMb = 0;
  const sampler = setInterval(() => {
    peakRssMb = Math.max(peakRssMb, process.memoryUsage.rss() / 1024 / 1024);
  }, 1000);

  try {
    // 1080p source clips upscaled by objectFit:cover — matches reality, where
    // stock footage is rarely native 4K.
    for (const c of CLIPS) {
      await generateColorClip(c, 6, FPS, 1920, 1080, join(publicDir, `clip-${c}.mp4`));
    }
    await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(publicDir, "voiceover.wav"));
    await copyFile(join(REPO, "remotion", "public", "sample", "music.wav"), join(publicDir, "music.wav"));

    const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts"), publicDir });
    console.log(`Bundled. Rendering at ${W}x${H}, concurrency ${CONCURRENCY}, theme "${THEME.id}" (${THEME.transition.style}, T=${THEME.transition.frames})\n`);

    // ── Phase 1: 4K stitch fidelity vs a monolithic 4K reference ─────────────
    if (runPhase1) {
    console.log("PHASE 1: 4K stitched render vs monolithic 4K reference (3 segments)");
    const shortProps = buildProps(3, 45, 45, CLIPS.slice(0, 3).map((c) => `clip-${c}.mp4`));
    const shortFrames = 3 * 45 + 45;
    const shortCache = join(work, "cache-short");
    await mkdir(shortCache, { recursive: true });

    const monoPath = join(work, "mono-4k.mp4");
    const t0 = Date.now();
    const monoComposition = await selectComposition({
      serveUrl,
      id: "NewsVideo",
      inputProps: shortProps as unknown as Record<string, unknown>,
    });
    await renderMedia({
      composition: monoComposition,
      serveUrl,
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: 18,
      concurrency: CONCURRENCY,
      outputLocation: monoPath,
      inputProps: shortProps as unknown as Record<string, unknown>,
    });
    const monoSeconds = (Date.now() - t0) / 1000;
    console.log(`  monolithic 4K reference: ${fmt(monoSeconds)} for ${shortFrames} frames`);

    const stitchedShort = join(work, "stitched-4k.mp4");
    const t1 = Date.now();
    await renderSegmented({
      serveUrl,
      compositionId: "NewsVideo",
      inputProps: shortProps,
      cacheDir: shortCache,
      outputPath: stitchedShort,
      concurrency: CONCURRENCY,
      logger,
    });
    const stitchedSeconds = (Date.now() - t1) / 1000;
    console.log(`  segmented + stitched:    ${fmt(stitchedSeconds)} for ${shortFrames} frames`);

    const monoProbe = await probeVideo(monoPath);
    const stitchedProbe = await probeVideo(stitchedShort);
    check(
      "renders at production resolution",
      stitchedProbe.width === W && stitchedProbe.height === H,
      `${stitchedProbe.width}x${stitchedProbe.height}`,
    );
    check(
      "4K frame count exact",
      stitchedProbe.frameCount === shortFrames && monoProbe.frameCount === shortFrames,
      `stitched ${stitchedProbe.frameCount}, monolithic ${monoProbe.frameCount}, expected ${shortFrames}`,
    );
    check(
      "4K audio in sync",
      stitchedProbe.audioDurationSeconds !== null &&
        Math.abs(stitchedProbe.audioDurationSeconds - stitchedProbe.videoDurationSeconds) < 0.05,
      `audio ${stitchedProbe.audioDurationSeconds}s vs video ${stitchedProbe.videoDurationSeconds}s`,
    );
    const psnr4k = await comparePsnr(monoPath, stitchedShort);
    check(
      "4K stitch is seam-free vs monolithic",
      psnr4k >= PSNR_THRESHOLD_DB,
      `PSNR ${psnr4k.toFixed(2)} dB at ${W}x${H}`,
    );
    }

    // ── Phase 2: long multi-segment 4K + targeted re-render ──────────────────
    if (runPhase2) {
    console.log("\nPHASE 2: long multi-segment 4K (6 segments / 7 chunks) + targeted re-render");
    const SEGMENTS = 6;
    const SEG_FRAMES = 40;
    const OUTRO_FRAMES = 45;
    const longFrames = SEGMENTS * SEG_FRAMES + OUTRO_FRAMES;
    const longCache = join(work, "cache-long");
    await mkdir(longCache, { recursive: true });

    const originalClips = CLIPS.slice(0, SEGMENTS).map((c) => `clip-${c}.mp4`);
    const longProps = buildProps(SEGMENTS, SEG_FRAMES, OUTRO_FRAMES, originalClips);
    const longOut = join(work, "long-4k.mp4");

    const t2 = Date.now();
    const coldResult = await renderSegmented({
      serveUrl,
      compositionId: "NewsVideo",
      inputProps: longProps,
      cacheDir: longCache,
      outputPath: longOut,
      concurrency: CONCURRENCY,
      logger,
    });
    const coldSeconds = (Date.now() - t2) / 1000;

    const longProbe = await probeVideo(longOut);
    const { size: longSize } = await stat(longOut);
    console.log(
      `  cold render: ${fmt(coldSeconds)} for ${longFrames} frames across ${coldResult.plan.chunks.length} chunks ` +
        `(${(coldSeconds / longFrames).toFixed(2)} s/frame)`,
    );
    check(
      "long 4K render frame count exact",
      longProbe.frameCount === longFrames,
      `${longProbe.frameCount} frames across ${coldResult.plan.chunks.length} chunks, expected ${longFrames}`,
    );
    check(
      "long 4K audio in sync",
      longProbe.audioDurationSeconds !== null &&
        Math.abs(longProbe.audioDurationSeconds - longProbe.videoDurationSeconds) < 0.05,
      `audio ${longProbe.audioDurationSeconds}s vs video ${longProbe.videoDurationSeconds}s`,
    );

    // Swap a middle segment; only its chunk and immediate neighbours should rebuild.
    const swappedClips = [...originalClips];
    swappedClips[4] = "clip-white.mp4";
    const swappedProps = buildProps(SEGMENTS, SEG_FRAMES, OUTRO_FRAMES, swappedClips);
    const targetedOut = join(work, "long-4k-targeted.mp4");

    const t3 = Date.now();
    const targetedResult = await renderSegmented({
      serveUrl,
      compositionId: "NewsVideo",
      inputProps: swappedProps,
      cacheDir: longCache,
      outputPath: targetedOut,
      changedSegmentIds: [4],
      concurrency: CONCURRENCY,
      logger,
    });
    const targetedSeconds = (Date.now() - t3) / 1000;

    const targetedProbe = await probeVideo(targetedOut);
    console.log(
      `  targeted re-render: ${fmt(targetedSeconds)} rebuilding ${targetedResult.renderedChunkIds.length}/${coldResult.plan.chunks.length} chunks ` +
        `(${((1 - targetedSeconds / coldSeconds) * 100).toFixed(0)}% faster than a full re-render)`,
    );
    check(
      "targeted 4K re-render rebuilds only the dirty chunks",
      targetedResult.renderedChunkIds.join(",") === "segment-3,segment-4,segment-5",
      `rebuilt [${targetedResult.renderedChunkIds.join(", ")}], reused ${targetedResult.reusedChunkIds.length}`,
    );
    check(
      "targeted 4K re-render preserves frame count",
      targetedProbe.frameCount === longFrames,
      `${targetedProbe.frameCount} frames, expected ${longFrames}`,
    );
    check(
      "targeted 4K re-render keeps audio in sync",
      targetedProbe.audioDurationSeconds !== null &&
        Math.abs(targetedProbe.audioDurationSeconds - targetedProbe.videoDurationSeconds) < 0.05,
      `audio ${targetedProbe.audioDurationSeconds}s vs video ${targetedProbe.videoDurationSeconds}s`,
    );
    check(
      "targeted 4K re-render is faster than the cold render",
      targetedSeconds < coldSeconds,
      `${fmt(targetedSeconds)} vs ${fmt(coldSeconds)}`,
    );

    const secPerFrame = coldSeconds / longFrames;
    console.log("\n── 4K throughput on this machine ──");
    console.log(`  ${secPerFrame.toFixed(2)} s/frame  |  ${(1 / secPerFrame).toFixed(2)} fps`);
    console.log(`  output ${(longSize / 1024 / 1024).toFixed(1)} MB for ${(longFrames / FPS).toFixed(1)}s of 4K video`);
    console.log(`  extrapolated:  5 min video ~= ${fmt(secPerFrame * 5 * 60 * FPS)}   |   20 min video ~= ${fmt(secPerFrame * 20 * 60 * FPS)}`);
    }

    clearInterval(sampler);
    console.log(`\npeak node RSS ${peakRssMb.toFixed(0)} MB`);
    console.log(failures === 0 ? `ALL 4K TESTS PASSED (phase: ${PHASE})` : `${failures} failure(s)`);
  } finally {
    clearInterval(sampler);
    await rm(work, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
