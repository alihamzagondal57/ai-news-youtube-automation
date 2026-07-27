// Verifies targeted re-render (per-segment caching + ffmpeg stitching) is
// frame-exact and stays in A/V sync.
//
// The method throughout: render the same final state BOTH ways — once as a
// single monolithic Remotion render (the ground truth), once via the chunked
// render+stitch path — and assert the two are equivalent. If stitching dropped a
// frame, duplicated one, drifted the audio, or left a stale clip visible across
// a crossfade boundary, the comparison against the monolithic reference fails.
import { mkdtemp, copyFile, cp, rm, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createLogger } from "@ai-news/shared";
import type { NewsVideoRenderProps } from "../infra/render-server/src/buildInputProps.ts";
import { concatVideoChunks, muxAudioOntoVideo } from "../infra/render-server/src/ffmpeg.ts";
import { AUDIO_CACHE_FILE, chunkPath, renderSegmented } from "../infra/render-server/src/renderSegmented.ts";
import { buildChunkPlan, computeDirtyRanges } from "../infra/render-server/src/segmentPlan.ts";
import { getTheme } from "../services/shared/src/theme/index.ts";
import { comparePsnr, comparePsnrRange, generateColorClip, perFramePsnr, probeVideo } from "./lib/media.mts";

const REPO = "C:\\Users\\HP\\New folder";
const FPS = 30;
const WIDTH = 640;
const HEIGHT = 360;
const SEGMENT_FRAMES = 60; // 2s per segment
const OUTRO_FRAMES = 30; // 1s
const SEGMENT_COUNT = 4;

// Both encodes are lossy H.264 of identical source frames, so they won't be
// bit-identical; anything above this is "visually the same picture". A stale
// clip or a seam drops this into the teens.
const PSNR_THRESHOLD_DB = 40;

// Deliberately a theme whose transition is NOT the old hardcoded 15 frames.
// broadsheet uses wipeX at 18 frames: a hard-edged reveal makes the incoming
// clip visible immediately at the mount boundary, so bleed reaches ~17 frames
// out — past the old hardcoded 15. If invalidation reverts to a constant the
// bleed would extend 9 frames past the window and this suite fails.
const TEST_THEME = getTheme("broadsheet");

const logger = createLogger("stitch-smoke");

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  PASS  ${label} — ${detail}`);
  } else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function buildProps(clipBySegment: string[]): NewsVideoRenderProps {
  const segments = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
    id: i,
    text: `Segment ${i} narration text for the stitching smoke test.`,
    startFrame: i * SEGMENT_FRAMES,
    durationInFrames: SEGMENT_FRAMES,
    media: [{ src: clipBySegment[i], startFrame: 0, durationInFrames: SEGMENT_FRAMES, trimBeforeFrames: 0, trimAfterFrames: SEGMENT_FRAMES }],
    lowerThirdText: `Segment ${i} Headline`,
    breaking: false,
  }));

  return {
    title: "Stitch Smoke Test",
    resolution: { width: WIDTH, height: HEIGHT },
    fps: FPS,
    outroDurationInFrames: OUTRO_FRAMES,
    segments,
    // Deliberately includes words that straddle chunk boundaries (frames 60/120/180
    // fall at 2.0s/4.0s/6.0s) — captions are burned into the video, so a timing
    // shift at a join would show up as a mismatched frame against the reference.
    captionWords: [
      { word: "boundary", start: 1.9, end: 2.15 },
      { word: "straddling", start: 3.9, end: 4.2 },
      { word: "words", start: 5.85, end: 6.1 },
      { word: "here", start: 7.0, end: 7.4 },
    ],
    tickerHeadlines: ["STITCH TEST", "FRAME EXACT", "NO DRIFT"],
    themeId: TEST_THEME.id,
    transitionFrames: TEST_THEME.transition.frames,
    audio: { voiceoverSrc: "voiceover.wav", musicSrc: "music.wav", musicVolume: 0.15, duckedVolume: 0.05 },
    branding: { channelName: "EuroWire News", accentColor: "#e11d2e" },
  };
}

/** The ground-truth path: one uninterrupted Remotion render, exactly as before this feature existed. */
async function renderMonolithic(
  serveUrl: string,
  props: NewsVideoRenderProps,
  outputLocation: string,
): Promise<void> {
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "NewsVideo", inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    pixelFormat: "yuv420p",
    crf: 18,
    outputLocation,
    inputProps,
  });
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "stitch-smoke-"));
  const publicDir = join(work, "public");
  const cacheDir = join(work, "cache");
  await mkdir(publicDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  // Distinct flat colours per segment: with the default empty media every
  // segment renders the same gradient placeholder, which would make a "clip
  // swap" invisible and the whole test vacuous.
  const colors = { red: "red", green: "green", blue: "blue", yellow: "yellow", magenta: "magenta" };
  const clipSeconds = SEGMENT_FRAMES / FPS + 1;
  for (const [name, color] of Object.entries(colors)) {
    await generateColorClip(color, clipSeconds, FPS, WIDTH, HEIGHT, join(publicDir, `clip-${name}.mp4`));
  }
  await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(publicDir, "voiceover.wav"));
  await copyFile(join(REPO, "remotion", "public", "sample", "music.wav"), join(publicDir, "music.wav"));
  console.log("Generated test clips + audio in", publicDir);

  const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts"), publicDir });
  console.log("Bundled Remotion project\n");

  const originalClips = ["clip-red.mp4", "clip-green.mp4", "clip-blue.mp4", "clip-yellow.mp4"];
  const originalProps = buildProps(originalClips);
  const expectedFrames = SEGMENT_COUNT * SEGMENT_FRAMES + OUTRO_FRAMES;

  // ── Test A: a cold chunked render must equal a monolithic render ──────────
  console.log("TEST A: cold segmented+stitched render vs monolithic reference");
  const referencePath = join(work, "reference-original.mp4");
  const stitchedPath = join(work, "stitched-original.mp4");

  await renderMonolithic(serveUrl, originalProps, referencePath);
  const coldResult = await renderSegmented({
    serveUrl,
    compositionId: "NewsVideo",
    inputProps: originalProps,
    cacheDir,
    outputPath: stitchedPath,
    logger,
  });

  const refProbe = await probeVideo(referencePath);
  const stitchedProbe = await probeVideo(stitchedPath);

  check(
    "chunk count",
    coldResult.plan.chunks.length === SEGMENT_COUNT + 1,
    `${coldResult.plan.chunks.length} chunks (${SEGMENT_COUNT} segments + outro)`,
  );
  check(
    "reference frame count",
    refProbe.frameCount === expectedFrames,
    `${refProbe.frameCount} frames (expected ${expectedFrames})`,
  );
  check(
    "stitched frame count",
    stitchedProbe.frameCount === expectedFrames,
    `${stitchedProbe.frameCount} frames (expected ${expectedFrames}) — no dropped/duplicated frames`,
  );
  check(
    "dimensions + fps",
    stitchedProbe.width === refProbe.width && stitchedProbe.height === refProbe.height && stitchedProbe.fps === refProbe.fps,
    `${stitchedProbe.width}x${stitchedProbe.height} @ ${stitchedProbe.fps}fps`,
  );
  check(
    "audio track present",
    stitchedProbe.audioDurationSeconds !== null,
    `audio duration ${stitchedProbe.audioDurationSeconds}s`,
  );
  check(
    "audio length matches video",
    stitchedProbe.audioDurationSeconds !== null &&
      Math.abs(stitchedProbe.audioDurationSeconds - stitchedProbe.videoDurationSeconds) < 0.05,
    `audio ${stitchedProbe.audioDurationSeconds}s vs video ${stitchedProbe.videoDurationSeconds}s (<50ms apart)`,
  );

  const coldPsnr = await comparePsnr(referencePath, stitchedPath);
  check(
    "visually identical to monolithic",
    coldPsnr >= PSNR_THRESHOLD_DB,
    `PSNR ${coldPsnr.toFixed(2)} dB (threshold ${PSNR_THRESHOLD_DB})`,
  );

  console.log("");
  console.log(failures === 0 ? "TEST A PASSED\n" : `TEST A: ${failures} failure(s)\n`);

  // ── Test B: swap one MIDDLE segment and re-render only what's dirty ───────
  console.log("TEST B: targeted re-render after swapping segment 2 (blue -> magenta)");

  // Snapshot the warm cache so the negative control below starts from the same
  // state as the real path instead of inheriting its (correct) output.
  const naiveCacheDir = join(work, "cache-naive");
  await cp(cacheDir, naiveCacheDir, { recursive: true });

  // Segment 2, not segment 1: the intro stinger (75 frames, fading out from 55)
  // sits opaquely over the segment 0->1 boundary at frame 60, which would mask
  // the transition entirely and make the bleed measurement meaningless.
  // Segment 2 boundaries (120, 180) are clear of it and it is still a middle segment.
  const swappedClips = ["clip-red.mp4", "clip-green.mp4", "clip-magenta.mp4", "clip-yellow.mp4"];
  const swappedProps = buildProps(swappedClips);

  const referenceSwappedPath = join(work, "reference-swapped.mp4");
  await renderMonolithic(serveUrl, swappedProps, referenceSwappedPath);

  const audioPathInCache = join(cacheDir, AUDIO_CACHE_FILE);
  const audioMtimeBefore = (await stat(audioPathInCache)).mtimeMs;

  const targetedPath = join(work, "stitched-swapped.mp4");
  const targetedResult = await renderSegmented({
    serveUrl,
    compositionId: "NewsVideo",
    inputProps: swappedProps,
    cacheDir,
    outputPath: targetedPath,
    changedSegmentIds: [2],
    logger,
  });

  const audioMtimeAfter = (await stat(audioPathInCache)).mtimeMs;

  // The crossfade means segment 1's clip is already fading in during segment 0's
  // frames and still fading out during segment 2's, so all three are dirty.
  check(
    "dirty chunk selection accounts for crossfade bleed",
    targetedResult.renderedChunkIds.join(",") === "segment-1,segment-2,segment-3",
    `re-rendered [${targetedResult.renderedChunkIds.join(", ")}]`,
  );
  check(
    "untouched chunks reused from cache",
    targetedResult.reusedChunkIds.join(",") === "segment-0,outro",
    `reused [${targetedResult.reusedChunkIds.join(", ")}]`,
  );
  check(
    "audio track byte-identical (never re-rendered)",
    audioMtimeBefore === audioMtimeAfter,
    "cached audio.wav untouched — no mechanism for A/V drift",
  );

  const targetedProbe = await probeVideo(targetedPath);
  const refSwappedProbe = await probeVideo(referenceSwappedPath);

  check(
    "frame count after targeted re-render",
    targetedProbe.frameCount === expectedFrames,
    `${targetedProbe.frameCount} frames (expected ${expectedFrames}) — no drops/duplicates at the joins`,
  );
  check(
    "audio still matches video length",
    targetedProbe.audioDurationSeconds !== null &&
      Math.abs(targetedProbe.audioDurationSeconds - targetedProbe.videoDurationSeconds) < 0.05,
    `audio ${targetedProbe.audioDurationSeconds}s vs video ${targetedProbe.videoDurationSeconds}s`,
  );
  check(
    "reference frame count",
    refSwappedProbe.frameCount === expectedFrames,
    `${refSwappedProbe.frameCount} frames`,
  );

  const targetedPsnr = await comparePsnr(referenceSwappedPath, targetedPath);
  check(
    "targeted re-render matches monolithic reference",
    targetedPsnr >= PSNR_THRESHOLD_DB,
    `PSNR ${targetedPsnr.toFixed(2)} dB — no visual seam anywhere in the video`,
  );

  // ── The invalidation logic must be a superset of reality ─────────────────
  // Compare the two MONOLITHIC renders to find every frame the swap genuinely
  // changes — this is ground truth about the composition, independent of the
  // stitcher. Then assert those frames all fall inside the range we mark dirty.
  // If the composition's TRANSITION_FRAMES ever changes without segmentPlan.ts
  // following, this fails instead of silently shipping a seam.
  const perFrame = await perFramePsnr(referencePath, referenceSwappedPath, join(work, "psnr-stats.log"));

  // Threshold at 35 dB, not 45. Both references are H.264, and inter-frame
  // prediction propagates a real difference forward: once frames diverge, later
  // frames reference them and the encoder emits small deltas even where the
  // source pixels are identical. Genuine content changes here measure 13-22 dB;
  // that propagation trails at 40-44 dB. Counting it as "changed" would claim
  // segment 2 affects frames after its <Sequence> has unmounted, which is
  // impossible by construction.
  const CONTENT_CHANGE_DB = 35;
  const changedFrames = perFrame.filter((f) => f.psnr < CONTENT_CHANGE_DB).map((f) => f.frame);
  const dirtyRanges = computeDirtyRanges(swappedProps, [2], coldResult.plan.totalDurationInFrames);
  const dirty = dirtyRanges[0];
  const firstChanged = Math.min(...changedFrames);
  const lastChanged = Math.max(...changedFrames);

  // What actually protects against stale cache is whole-CHUNK coverage, not the
  // raw dirty range: invalidation selects any chunk the range touches, so the
  // re-rendered span is always a superset of the range.
  const rerendered = coldResult.plan.chunks.filter((c) => targetedResult.renderedChunkIds.includes(c.id));
  const coveredStart = Math.min(...rerendered.map((c) => c.startFrame));
  const coveredEnd = Math.max(...rerendered.map((c) => c.endFrame));

  console.log(
    `  swap changes frames ${firstChanged}-${lastChanged}; dirty range [${dirty.startFrame}, ${dirty.endFrame}); re-rendered chunks cover [${coveredStart}, ${coveredEnd})`,
  );
  check(
    "re-rendered chunks cover every genuinely changed frame",
    firstChanged >= coveredStart && lastChanged < coveredEnd,
    `changed [${firstChanged}, ${lastChanged}] inside re-rendered [${coveredStart}, ${coveredEnd}) — no changed frame is served from stale cache`,
  );
  check(
    "changed frames stay inside the swapped segment's mount window",
    firstChanged >= dirty.startFrame && lastChanged < dirty.endFrame,
    `changed [${firstChanged}, ${lastChanged}] inside mount window [${dirty.startFrame}, ${dirty.endFrame}) — a segment cannot affect frames where it is unmounted`,
  );
  check(
    "changed frames extend beyond the swapped segment's own range",
    firstChanged < SEGMENT_FRAMES * 2 || lastChanged >= SEGMENT_FRAMES * 3,
    `segment 2 owns frames [${SEGMENT_FRAMES * 2}, ${SEGMENT_FRAMES * 3}) but changes reach ${firstChanged}-${lastChanged} — neighbouring chunks really are dirty`,
  );
  console.log("");

  // ── Negative control: prove the comparison can actually fail ──────────────
  // Re-render ONLY the swapped segment's own chunk, ignoring the crossfade
  // bleed. This is the naive implementation; if the assertions above can't
  // catch it, they aren't testing anything.
  console.log("NEGATIVE CONTROL: naive re-render of only segment-2 own range (expected to FAIL comparison)");
  const naivePlan = buildChunkPlan(swappedProps);
  const naiveComposition = await selectComposition({
    serveUrl,
    id: "NewsVideo",
    inputProps: swappedProps as unknown as Record<string, unknown>,
  });
  const naiveChunk = naivePlan.chunks.find((c) => c.id === "segment-2")!;
  await renderMedia({
    composition: naiveComposition,
    serveUrl,
    codec: "h264",
    pixelFormat: "yuv420p",
    crf: 18,
    frameRange: [naiveChunk.startFrame, naiveChunk.endFrame - 1],
    muted: true,
    outputLocation: chunkPath(naiveCacheDir, naiveChunk),
    inputProps: swappedProps as unknown as Record<string, unknown>,
  });
  const naiveConcat = join(naiveCacheDir, "video-concat.mp4");
  const naivePath = join(work, "stitched-naive.mp4");
  await concatVideoChunks(
    naivePlan.chunks.map((c) => chunkPath(naiveCacheDir, c)),
    naiveCacheDir,
    naiveConcat,
  );
  await muxAudioOntoVideo(naiveConcat, join(naiveCacheDir, AUDIO_CACHE_FILE), naivePath);

  // Compare across the join windows specifically. A ~30-frame defect is invisible
  // in a whole-video average (it moved PSNR only 52 -> 46 dB), so the boundary
  // regions are measured on their own — this is the explicit stitch-boundary test.
  const joinBefore = { start: SEGMENT_FRAMES * 2 - TEST_THEME.transition.frames, end: SEGMENT_FRAMES * 2 };
  const joinAfter = { start: SEGMENT_FRAMES * 3, end: SEGMENT_FRAMES * 3 + TEST_THEME.transition.frames };

  const targetedJoinIn = await comparePsnrRange(referenceSwappedPath, targetedPath, joinBefore.start, joinBefore.end);
  const targetedJoinOut = await comparePsnrRange(referenceSwappedPath, targetedPath, joinAfter.start, joinAfter.end);
  const naiveJoinIn = await comparePsnrRange(referenceSwappedPath, naivePath, joinBefore.start, joinBefore.end);
  const naiveJoinOut = await comparePsnrRange(referenceSwappedPath, naivePath, joinAfter.start, joinAfter.end);

  console.log(
    `  boundary PSNR — targeted: fade-in ${targetedJoinIn.toFixed(1)} dB, fade-out ${targetedJoinOut.toFixed(1)} dB`,
  );
  console.log(
    `  boundary PSNR — naive:    fade-in ${naiveJoinIn.toFixed(1)} dB, fade-out ${naiveJoinOut.toFixed(1)} dB`,
  );

  check(
    "targeted re-render is clean AT the join",
    targetedJoinIn >= PSNR_THRESHOLD_DB && targetedJoinOut >= PSNR_THRESHOLD_DB,
    `both crossfade windows >= ${PSNR_THRESHOLD_DB} dB — no seam where the chunks meet`,
  );
  check(
    "negative control is detected at the join",
    naiveJoinIn < PSNR_THRESHOLD_DB || naiveJoinOut < PSNR_THRESHOLD_DB,
    `naive leaves a stale clip in the crossfade (fade-in ${naiveJoinIn.toFixed(1)} dB, fade-out ${naiveJoinOut.toFixed(1)} dB) — the test has teeth`,
  );

  console.log("");
  console.log(
    failures === 0
      ? "ALL STITCH TESTS PASSED: targeted re-render is frame-exact, in sync, and seam-free."
      : `${failures} failure(s)`,
  );

  await rm(work, { recursive: true, force: true });
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
