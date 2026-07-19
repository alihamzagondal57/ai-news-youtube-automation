import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ffmpeg-static is CJS (`export =` a bare path string), which has no correct
// ESM default-import form — createRequire is the supported way to read it.
const ffmpegStatic = createRequire(import.meta.url)("ffmpeg-static") as string | null;

/**
 * A bundled ffmpeg binary rather than a system one: the render VM image is
 * provisioned from scratch (infra/gcp/setup) and Remotion's own ffmpeg is
 * internal to @remotion/renderer, not exposed as a CLI we can drive.
 */
export const ffmpegPath: string = (() => {
  if (!ffmpegStatic) {
    throw new Error("ffmpeg-static did not resolve a binary path for this platform");
  }
  return ffmpegStatic;
})();

/** ffmpeg writes normal progress to stderr, so a non-zero exit is the only real failure signal. */
async function runFfmpeg(args: string[]): Promise<void> {
  try {
    // Large concat/mux output can exceed the default 1MB pipe buffer.
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed: ${ffmpegPath} ${args.join(" ")}\n${stderr}`);
  }
}

/**
 * Losslessly concatenates video-only chunks with the concat demuxer (`-c copy`).
 * Every chunk comes out of the same Remotion render settings, so codec/pixel
 * format/resolution match and stream copy is safe — no re-encode, so no
 * generation loss and no chance of the encoder resampling frames at a join.
 */
export async function concatVideoChunks(chunkPaths: string[], workDir: string, outputPath: string): Promise<void> {
  // The concat demuxer resolves each `file` line relative to the list file.
  const listPath = join(workDir, "concat-list.txt");
  const listBody = chunkPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody, "utf8");

  await runFfmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    // Rebuild a single monotonic timestamp series across the join points;
    // without this the per-chunk timestamps restart at 0 and players read the
    // result as one long freeze followed by a jump.
    "-fflags",
    "+genpts",
    "-y",
    outputPath,
  ]);
}

/**
 * Muxes the single continuous audio track onto the concatenated video.
 *
 * This is the crux of A/V sync: the audio is rendered once for the whole
 * timeline and never cut at a chunk boundary, so stitching cannot introduce
 * drift, gaps, or doubled samples. Video is stream-copied; only the audio is
 * encoded, once, from frame 0.
 */
export async function muxAudioOntoVideo(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    // Deliberately no -shortest: it would silently paper over a video/audio
    // length mismatch, which is exactly the bug class we want to fail loudly on.
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ]);
}
