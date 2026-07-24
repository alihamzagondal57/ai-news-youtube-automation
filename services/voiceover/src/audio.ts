import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// Both are CJS packages exporting a bare path (ffmpeg-static) / { path }
// (ffprobe-static), so createRequire is the correct way to read them from ESM —
// mirrors infra/render-server/src/ffmpeg.ts.
const ffmpegPath = require("ffmpeg-static") as string | null;
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform");
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed: ${args.join(" ")}\n${stderr}`);
  }
}

/**
 * Exact media duration in seconds, read from the decoded stream rather than the
 * container header. This number is the ground truth every timing offset is built
 * from, so it must reflect the real sample count, not a header estimate.
 */
export async function probeDurationSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Could not read a positive duration from ${path} (got "${stdout.trim()}")`);
  }
  return seconds;
}

/**
 * Re-encode any input to the canonical PCM format. Every segment and every
 * silence gap passes through this first, so the later concat joins streams that
 * are already identical in codec/rate/layout — a precondition for a
 * sample-accurate, drift-free join.
 */
export async function toCanonicalWav(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-i",
    inputPath,
    "-ar",
    String(config.audio.sampleRate),
    "-ac",
    String(config.audio.channels),
    "-c:a",
    "pcm_s16le",
    "-y",
    outputPath,
  ]);
}

/** A canonical-format silence clip of an exact duration, for the inter-segment beat. */
export async function makeSilence(seconds: number, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${config.audio.sampleRate}:cl=mono`,
    "-t",
    seconds.toFixed(6),
    "-c:a",
    "pcm_s16le",
    "-y",
    outputPath,
  ]);
}

/**
 * Concatenate canonical-format pieces losslessly with the concat demuxer.
 * Because every input is already the identical PCM format, `-c copy` streams the
 * samples through untouched: the output's sample count is exactly the sum of the
 * inputs', which is what lets the timing math (built from each piece's measured
 * duration) match the audio to the sample.
 */
export async function concatWav(piecePaths: string[], workDir: string, outputPath: string): Promise<void> {
  const listPath = join(workDir, "concat-list.txt");
  const body = piecePaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, body, "utf8");
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", outputPath]);
}

/**
 * Apply EBU R128 loudness normalization, once, to the finished track.
 *
 * `loudnorm` is a gain/dynamics filter: it does not add or drop samples, so the
 * output duration equals the input's and every timing offset computed before
 * this step still holds. `linear=true` requests a single linear gain pass
 * (measured→target) rather than dynamic compression, keeping the speech
 * unsquashed; ffmpeg falls back to dynamic only if the linear result would clip.
 */
export async function normalizeLoudness(inputPath: string, outputPath: string): Promise<void> {
  const { integratedLufs, truePeakDb, range } = config.loudness;
  await runFfmpeg([
    "-i",
    inputPath,
    "-af",
    `loudnorm=I=${integratedLufs}:TP=${truePeakDb}:LRA=${range}:linear=true`,
    "-ar",
    String(config.audio.sampleRate),
    "-ac",
    String(config.audio.channels),
    "-c:a",
    "pcm_s16le",
    "-y",
    outputPath,
  ]);
}
