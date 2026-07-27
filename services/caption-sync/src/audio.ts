import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// CJS packages exporting a bare path (ffmpeg-static) / { path } (ffprobe-static),
// so createRequire is the correct way to read them from ESM — mirrors
// services/voiceover/src/audio.ts and infra/render-server/src/ffmpeg.ts.
const ffmpegPath = require("ffmpeg-static") as string | null;
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not resolve a binary path for this platform");
}

/**
 * Exact media duration in seconds, decoded rather than read from the container
 * header. Used to bound-check every caption timestamp against the real audio.
 */
export async function probeDurationSeconds(path: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${path} (got "${stdout.trim()}")`);
  }
  return seconds;
}

/**
 * Decode any audio file to the exact buffer Whisper expects: mono, 16 kHz,
 * float32. ffmpeg does the resample (our voiceover.wav is 24 kHz), and we read
 * raw `f32le` so there is no WAV header to parse and no lossy intermediate.
 *
 * Routed through a temp file rather than stdout because a 20-minute narration is
 * ~75 MB of float32 — large enough that piping through a shell buffer is a
 * needless failure mode.
 */
export async function decodeToWhisperInput(inputPath: string, scratchPath: string): Promise<Float32Array> {
  try {
    await execFileAsync(
      ffmpegPath!,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", inputPath,
        "-ac", "1",
        "-ar", String(config.sampleRate),
        "-f", "f32le",
        scratchPath,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed decoding ${inputPath} for Whisper\n${stderr}`);
  }

  const buffer = await readFile(scratchPath);
  await rm(scratchPath, { force: true });

  if (buffer.byteLength === 0) {
    throw new Error(`Decoded audio for ${inputPath} was empty`);
  }
  // Copy into a fresh Float32Array: the Buffer's underlying ArrayBuffer is
  // pooled by Node and may not be 4-byte aligned at byteOffset.
  const samples = new Float32Array(buffer.byteLength / 4);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buffer.readFloatLE(i * 4);
  }
  return samples;
}
