// ffprobe/ffmpeg helpers for asserting that a stitched render is frame-exact
// and in sync. Test-only.
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const ffmpegPath = require("ffmpeg-static") as string;
export const ffprobePath = (require("ffprobe-static") as { path: string }).path;

const BIG_BUFFER = { maxBuffer: 64 * 1024 * 1024 };

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return runIn(undefined, bin, args);
}

async function runIn(cwd: string | undefined, bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(bin, args, { ...BIG_BUFFER, cwd });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`${bin} failed: ${args.join(" ")}\n${e.stderr ?? e.message}`);
  }
}

export interface VideoProbe {
  frameCount: number;
  videoDurationSeconds: number;
  audioDurationSeconds: number | null;
  fps: number;
  width: number;
  height: number;
}

/**
 * Counts frames by actually decoding (`-count_frames`) rather than trusting the
 * container's metadata — a stitch that duplicates or drops frames often still
 * reports a plausible duration in the header.
 */
export async function probeVideo(path: string): Promise<VideoProbe> {
  const { stdout } = await run(ffprobePath, [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=codec_type,nb_read_frames,duration,r_frame_rate,width,height",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      nb_read_frames?: string;
      duration?: string;
      r_frame_rate?: string;
      width?: number;
      height?: number;
    }>;
  };

  const video = parsed.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`No video stream in ${path}`);
  const audio = parsed.streams.find((s) => s.codec_type === "audio");

  const [num, den] = (video.r_frame_rate ?? "0/1").split("/").map(Number);

  return {
    frameCount: Number(video.nb_read_frames ?? 0),
    videoDurationSeconds: Number(video.duration ?? 0),
    audioDurationSeconds: audio?.duration ? Number(audio.duration) : null,
    fps: den ? num / den : 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
  };
}

/**
 * Average PSNR between two videos' luma planes. Infinity = pixel-identical.
 * Only meaningful when both have the same dimensions and frame count, so callers
 * must assert those separately — ffmpeg silently stops at the shorter input.
 */
export async function comparePsnr(referencePath: string, testPath: string): Promise<number> {
  const { stderr } = await run(ffmpegPath, [
    "-hide_banner",
    "-i",
    referencePath,
    "-i",
    testPath,
    "-lavfi",
    "[0:v][1:v]psnr",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/average:([0-9.]+|inf)/);
  if (!match) throw new Error(`Could not parse PSNR from ffmpeg output:\n${stderr}`);
  return match[1] === "inf" ? Number.POSITIVE_INFINITY : Number(match[1]);
}

/**
 * PSNR over a frame window only. A stitch defect is localized to ~30 frames
 * around a join; averaged across a whole video that barely moves the number, so
 * boundary regions have to be compared on their own to be detectable.
 */
export async function comparePsnrRange(
  referencePath: string,
  testPath: string,
  startFrame: number,
  endFrame: number,
): Promise<number> {
  const trim = `trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS`;
  const { stderr } = await run(ffmpegPath, [
    "-hide_banner",
    "-i",
    referencePath,
    "-i",
    testPath,
    "-lavfi",
    `[0:v]${trim}[r];[1:v]${trim}[t];[r][t]psnr`,
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/average:([0-9.]+|inf)/);
  if (!match) throw new Error(`Could not parse PSNR from ffmpeg output:\n${stderr}`);
  return match[1] === "inf" ? Number.POSITIVE_INFINITY : Number(match[1]);
}

/**
 * Per-frame PSNR in a single ffmpeg pass (via the psnr filter's stats_file).
 * Lets a test find exactly *which* frames differ between two renders, instead of
 * sampling frame-by-frame with one process per frame.
 */
export async function perFramePsnr(
  referencePath: string,
  testPath: string,
  statsPath: string,
): Promise<Array<{ frame: number; psnr: number }>> {
  // The stats_file path is parsed as a filter option, where a Windows drive
  // colon ("C:") reads as an option separator. Running from the stats directory
  // and passing a bare filename sidesteps the escaping entirely.
  await runIn(dirname(statsPath), ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    referencePath,
    "-i",
    testPath,
    "-lavfi",
    `[0:v][1:v]psnr=stats_file=${basename(statsPath)}`,
    "-f",
    "null",
    "-",
  ]);
  const raw = await readFile(statsPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const frame = Number(line.match(/n:\s*(\d+)/)?.[1] ?? NaN);
      const psnrRaw = line.match(/psnr_avg:\s*([0-9.]+|inf)/)?.[1] ?? "inf";
      // stats_file frame numbers are 1-based; callers think in 0-based frames.
      return { frame: frame - 1, psnr: psnrRaw === "inf" ? Number.POSITIVE_INFINITY : Number(psnrRaw) };
    })
    .filter((entry) => Number.isFinite(entry.frame));
}

/** A flat, saturated colour clip — makes a wrong/stale clip at a boundary unmistakable. */
export async function generateColorClip(
  color: string,
  seconds: number,
  fps: number,
  width: number,
  height: number,
  outputPath: string,
): Promise<void> {
  await run(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=${seconds}:r=${fps}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath,
  ]);
}

/**
 * Average colour of a single frame, by scaling it to 1x1. Used to prove a
 * specific frame in the crossfade bleed zone actually changed.
 *
 * Written to a file rather than piped: execFile decodes stdout as UTF-8, which
 * mangles raw RGB bytes.
 */
export async function frameAverageColor(
  path: string,
  frameIndex: number,
  scratchDir: string,
): Promise<{ r: number; g: number; b: number }> {
  const rawPath = join(scratchDir, `frame-${frameIndex}-${Math.random().toString(36).slice(2)}.raw`);
  await run(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-vf",
    `select=eq(n\\,${frameIndex}),scale=1:1`,
    "-vframes",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-y",
    rawPath,
  ]);
  const buf = await readFile(rawPath);
  await rm(rawPath, { force: true });
  if (buf.length < 3) throw new Error(`Could not read frame ${frameIndex} from ${path}`);
  return { r: buf[0], g: buf[1], b: buf[2] };
}

/** Euclidean distance between two RGB samples (0 = identical, ~441 = black vs white). */
export function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
