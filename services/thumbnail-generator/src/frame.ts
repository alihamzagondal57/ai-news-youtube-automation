import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// CJS packages exporting a bare path (ffmpeg-static) / { path } (ffprobe-static),
// so createRequire is the correct way to read them from ESM — mirrors
// services/caption-sync/src/audio.ts and infra/render-server/src/ffmpeg.ts.
const ffmpegPath = require("ffmpeg-static") as string | null;
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform");
}

/** Exact video duration in seconds, decoded rather than read from the container header. */
export async function probeVideoDurationSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${path} (got "${stdout.trim()}")`);
  }
  return seconds;
}

export interface FrameTimestampOptions {
  /** How many candidate timestamps to sample and compare. */
  candidateCount: number;
  /** Fraction of the duration to skip at both the start (intro stinger) and end (outro card). */
  marginFraction: number;
}

/**
 * Candidate timestamps spread evenly across the video's middle, skipping
 * `marginFraction` at both ends — replaces a previous fixed-fraction pick
 * (always ~12% in, clamped to an 8s ceiling) that put the frame inside the
 * intro stinger for any video longer than about a minute, which is the
 * opposite of what it was meant to avoid.
 */
export function pickCandidateTimestamps(durationSeconds: number, options: FrameTimestampOptions): number[] {
  const { candidateCount, marginFraction } = options;
  const lastValidSecond = Math.max(durationSeconds - 0.1, 0);
  const start = durationSeconds * marginFraction;
  const end = durationSeconds * (1 - marginFraction);
  const span = end - start;

  if (candidateCount <= 1 || span <= 0) {
    return [Math.min(Math.max(durationSeconds * 0.4, 0), lastValidSecond)];
  }
  const timestamps: number[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const t = start + (span * (i + 0.5)) / candidateCount;
    timestamps.push(Math.min(t, lastValidSecond));
  }
  return timestamps;
}

export interface BestFrameResult {
  timestampSeconds: number;
  outputPath: string;
}

/**
 * Extracts a frame at each candidate timestamp and keeps the one whose PNG
 * is largest on disk, as a cheap proxy for visual complexity: a flat title
 * card, a near-solid transition frame, or a plain gradient background all
 * compress to a noticeably smaller PNG than a frame with real footage detail
 * and color variety. No extra dependency (OpenCV, image-analysis libs) —
 * just the ffmpeg extraction this file already does, run a handful of times.
 */
export async function pickBestFrame(
  videoPath: string,
  durationSeconds: number,
  workDir: string,
  options: FrameTimestampOptions,
): Promise<BestFrameResult> {
  const candidates = pickCandidateTimestamps(durationSeconds, options);

  let best: (BestFrameResult & { size: number }) | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const timestampSeconds = candidates[i];
    const candidatePath = join(workDir, `frame-candidate-${i}.png`);
    await extractFrame(videoPath, timestampSeconds, candidatePath);
    const { size } = await stat(candidatePath);
    if (!best || size > best.size) {
      best = { timestampSeconds, outputPath: candidatePath, size };
    }
  }
  if (!best) {
    throw new Error(`pickBestFrame produced no candidates for a ${durationSeconds}s video`);
  }
  return { timestampSeconds: best.timestampSeconds, outputPath: best.outputPath };
}

/**
 * Extracts one frame at `timestampSeconds` from `videoPath` into `outputPath`
 * (PNG, native resolution — the Thumbnail composition's <Img objectFit:
 * cover> scales it to the 1280x720 canvas, the same way ThemedBackdrop
 * already handles stock clips of arbitrary size).
 */
export async function extractFrame(videoPath: string, timestampSeconds: number, outputPath: string): Promise<void> {
  try {
    await execFileAsync(
      ffmpegPath!,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        timestampSeconds.toFixed(2),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-y",
        outputPath,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed extracting frame at ${timestampSeconds}s from ${videoPath}\n${stderr}`);
  }
}
