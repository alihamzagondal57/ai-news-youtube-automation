import { execFile } from "node:child_process";
import { createRequire } from "node:module";
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
  fractionOfDuration: number;
  minSeconds: number;
  maxSeconds: number;
}

/**
 * Clamps a fraction of the video's duration into [minSeconds, maxSeconds] —
 * representative of the video without depending on segment-timing.json, and
 * far enough in to skip the intro stinger's fade-from-black opening frame.
 * Also clamped below the video's own length so a very short render (under
 * minSeconds) still gets an in-bounds timestamp rather than seeking past EOF.
 */
export function pickRepresentativeTimestamp(durationSeconds: number, options: FrameTimestampOptions): number {
  const target = durationSeconds * options.fractionOfDuration;
  const withinWindow = Math.min(Math.max(target, options.minSeconds), options.maxSeconds);
  return Math.min(withinWindow, Math.max(durationSeconds - 0.1, 0));
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
