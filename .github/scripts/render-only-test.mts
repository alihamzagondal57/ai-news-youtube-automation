// Isolated render-only diagnostic for .github/workflows/test-render-in-ci.yml.
// Same synthetic-clip pattern as .smoke-test/smoke-test-1080p.mts (real
// Remotion + ffmpeg, no LLM/TTS/Whisper/media-API dependency) — isolates
// exactly the variable in question: does a standard GitHub-hosted runner's
// SSD avoid the disk-I/O render bottleneck measured on local HDD hardware.
// Not part of the regular pipeline.
import { mkdtemp, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { createLogger } from "@ai-news/shared";
import { getTheme } from "@ai-news/shared/theme";
import type { NewsVideoRenderProps } from "../../infra/render-server/src/buildInputProps.ts";
import { renderSegmented } from "../../infra/render-server/src/renderSegmented.ts";
import { generateColorClip, probeVideo } from "../../.smoke-test/lib/media.mts";

const REPO = process.cwd();
const W = 1920;
const H = 1080;
const FPS = 30;
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? "2"); // matches the 2-vCPU standard runner
const OUT_DIR = "/tmp/ci-render-test";
const THEME = getTheme("broadsheet");
const CLIPS = ["red", "green", "blue", "yellow", "magenta", "cyan"];

function buildProps(segmentCount: number, segFrames: number, outroFrames: number, clips: string[]): NewsVideoRenderProps {
  return {
    title: "GitHub Actions Render Test",
    resolution: { width: W, height: H },
    fps: FPS,
    outroDurationInFrames: outroFrames,
    segments: Array.from({ length: segmentCount }, (_, i) => ({
      id: i,
      text: `Segment ${i} narration for the CI render test.`,
      startFrame: i * segFrames,
      durationInFrames: segFrames,
      media: [{ src: clips[i], startFrame: 0, durationInFrames: segFrames, trimBeforeFrames: 0, trimAfterFrames: segFrames }],
      lowerThirdText: `Segment ${i} Headline`,
      breaking: false,
    })),
    captionWords: Array.from({ length: segmentCount * 2 }, (_, i) => ({
      word: i % 2 === 0 ? "test" : "render",
      start: i * 0.75,
      end: i * 0.75 + 0.5,
    })),
    tickerHeadlines: ["GITHUB ACTIONS RENDER TEST", "SSD VS LOCAL HDD"],
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
  await mkdir(OUT_DIR, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "ci-render-only-"));
  const publicDir = join(work, "public");
  await mkdir(publicDir, { recursive: true });

  console.log(`Rendering at ${W}x${H}, concurrency ${CONCURRENCY} (standard GH-hosted runner: 2 vCPU / 7GB RAM, SSD-backed)`);

  for (const c of CLIPS) {
    await generateColorClip(c, 6, FPS, W, H, join(publicDir, `clip-${c}.mp4`));
  }
  await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(publicDir, "voiceover.wav"));
  await copyFile(join(REPO, "remotion", "public", "sample", "music.wav"), join(publicDir, "music.wav"));

  const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts"), publicDir });
  console.log("Bundled Remotion project.");

  const SEGMENTS = 6;
  const SEG_FRAMES = 40;
  const OUTRO_FRAMES = 45;
  const longFrames = SEGMENTS * SEG_FRAMES + OUTRO_FRAMES;
  const cacheDir = join(work, "cache");
  await mkdir(cacheDir, { recursive: true });

  const props = buildProps(SEGMENTS, SEG_FRAMES, OUTRO_FRAMES, CLIPS.map((c) => `clip-${c}.mp4`));
  const outPath = join(OUT_DIR, "render.mp4");

  const t0 = Date.now();
  const result = await renderSegmented({
    serveUrl,
    compositionId: "NewsVideo",
    inputProps: props,
    cacheDir,
    outputPath: outPath,
    concurrency: CONCURRENCY,
    logger: createLogger("render-only-ci"),
  });
  const coldSeconds = (Date.now() - t0) / 1000;

  const probe = await probeVideo(outPath);
  const { size } = await stat(outPath);
  const secPerFrame = coldSeconds / longFrames;

  console.log(`\ncold render: ${fmt(coldSeconds)} for ${longFrames} frames across ${result.plan.chunks.length} chunks (${secPerFrame.toFixed(2)} s/frame)`);
  console.log(`frame count exact: ${probe.frameCount === longFrames} (${probe.frameCount} vs expected ${longFrames})`);
  console.log(`output: ${(size / 1024 / 1024).toFixed(1)} MB for ${(longFrames / FPS).toFixed(1)}s of video`);
  console.log(`\n-- extrapolated to real script lengths (this machine) --`);
  console.log(`  5 min video  ~= ${fmt(secPerFrame * 5 * 60 * FPS)}`);
  console.log(`  10 min video ~= ${fmt(secPerFrame * 10 * 60 * FPS)}`);
  console.log(`  20 min video ~= ${fmt(secPerFrame * 20 * 60 * FPS)}`);

  const timings = {
    resolution: `${W}x${H}`,
    concurrency: CONCURRENCY,
    coldSeconds,
    frames: longFrames,
    chunks: result.plan.chunks.length,
    secPerFrame,
    frameCountExact: probe.frameCount === longFrames,
    outputSizeMb: size / 1024 / 1024,
    extrapolated5min: secPerFrame * 5 * 60 * FPS,
    extrapolated10min: secPerFrame * 10 * 60 * FPS,
    extrapolated20min: secPerFrame * 20 * 60 * FPS,
  };
  await writeFile(join(OUT_DIR, "timings.json"), JSON.stringify(timings, null, 2));
}

main().catch((err) => {
  console.error("RENDER-ONLY CI TEST FAILED:", err);
  process.exit(1);
});
