import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

/** Below this, a "downloaded" file is almost certainly an error page or a truncated transfer, not real video. */
const MIN_PLAUSIBLE_BYTES = 20_000;

export async function downloadClip(url: string, destPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath));
  const { size } = await stat(destPath);
  if (size < MIN_PLAUSIBLE_BYTES) {
    throw new Error(`Downloaded file from ${url} is suspiciously small (${size} bytes) — likely an error page, not video`);
  }
  return size;
}

export interface ProbedVideo {
  width: number;
  height: number;
  durationSeconds: number;
}

/**
 * Confirms a downloaded file is actually a decodable video with plausible
 * dimensions, rather than trusting the provider's own metadata. A provider API
 * occasionally serves a rendition that 404s or transcodes oddly; this is the
 * check that catches it before the file reaches the render pipeline.
 */
export async function probeClip(path: string): Promise<ProbedVideo> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const durationSeconds = Number.parseFloat(parsed.format?.duration ?? "");
  if (!stream?.width || !stream.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe could not read a valid video stream from ${path}`);
  }
  return { width: stream.width, height: stream.height, durationSeconds };
}
