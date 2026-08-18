import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Script, SegmentTiming } from "@ai-news/shared";

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

export interface TimeWindow {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Candidate timestamps spread evenly across `window` (defaulting to the
 * whole video's middle, skipping `marginFraction` at both ends — replaces a
 * previous fixed-fraction pick, always ~12% in and clamped to an 8s ceiling,
 * that put the frame inside the intro stinger for any video longer than
 * about a minute, which is the opposite of what it was meant to avoid).
 *
 * Passing a narrower `window` (see `selectTopicalWindow`) restricts
 * candidates to one scene instead of the whole timeline, so the
 * visual-detail tiebreaker in `pickBestFrame` picks the best MOMENT within
 * an already topic-relevant scene, rather than the most detailed moment
 * anywhere regardless of what it's actually a frame of.
 */
export function pickCandidateTimestamps(
  durationSeconds: number,
  options: FrameTimestampOptions,
  window?: TimeWindow,
): number[] {
  const { candidateCount, marginFraction } = options;
  const lastValidSecond = Math.max(durationSeconds - 0.1, 0);
  const windowStart = window?.startSeconds ?? 0;
  const windowEnd = window?.endSeconds ?? durationSeconds;
  const margin = (windowEnd - windowStart) * marginFraction;
  const start = windowStart + margin;
  const end = windowEnd - margin;
  const span = end - start;

  if (candidateCount <= 1 || span <= 0) {
    const fallback = window ? (windowStart + windowEnd) / 2 : durationSeconds * 0.4;
    return [Math.min(Math.max(fallback, 0), lastValidSecond)];
  }
  const timestamps: number[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const t = start + (span * (i + 0.5)) / candidateCount;
    timestamps.push(Math.min(t, lastValidSecond));
  }
  return timestamps;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "but", "is", "are", "was", "were",
  "as", "by", "with", "from", "this", "that", "these", "those", "it", "its", "be", "been", "has", "have",
  "had", "will", "would", "could", "should", "what", "why", "how", "who", "when", "where",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Which segment's own time range best represents the video's actual topic,
 * scored by how many of the video title's significant words show up in that
 * segment's headline/text/visualCue. Ties (including "no segment matched any
 * keyword" — a real, common case for a hook-style title's own invented
 * phrasing) go to the earliest segment, since this pipeline's scripts are
 * written hook-first: segment 0 is the one segment written specifically to
 * state the topic up front (see script-generator/src/prompt.ts) and is a
 * better topical bet than an unconstrained search of the whole video even
 * when title wording drifts from the segment prose.
 *
 * Returns null (meaning "search the whole video") only when segment timing
 * data doesn't actually cover any segment — malformed input, not a normal
 * runtime condition.
 */
export function selectTopicalWindow(
  script: Pick<Script, "title" | "segments">,
  segmentTiming: Pick<SegmentTiming, "segments">,
): TimeWindow | null {
  const titleWords = keywords(script.title);
  const timingById = new Map(segmentTiming.segments.map((s) => [s.id, s]));

  let best: { id: number; score: number; timing: SegmentTiming["segments"][number] } | null = null;
  for (const segment of script.segments) {
    const timing = timingById.get(segment.id);
    if (!timing) continue;
    const segmentWords = keywords(`${segment.headline} ${segment.text} ${segment.visualCue}`);
    let score = 0;
    for (const word of titleWords) if (segmentWords.has(word)) score++;
    if (!best || score > best.score || (score === best.score && segment.id < best.id)) {
      best = { id: segment.id, score, timing };
    }
  }
  if (!best) return null;
  return { startSeconds: best.timing.startSeconds, endSeconds: best.timing.endSeconds };
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
  window?: TimeWindow,
): Promise<BestFrameResult> {
  const candidates = pickCandidateTimestamps(durationSeconds, options, window);

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
