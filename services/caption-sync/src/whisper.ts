import { config } from "./config.js";
import type { RawWord } from "./captions.js";

/**
 * Self-hosted Whisper via transformers.js (Apache-2.0, ONNX, CPU).
 *
 * Same reasoning as the Kokoro TTS engine: it runs entirely in-process, so
 * there is no API key, no egress, no rate limit, and no terms-of-use question
 * about commercial output — it behaves identically on a laptop, in GitHub
 * Actions, and on the render VM. (docs/LICENSING.md)
 */

// Constructing the pipeline downloads and initialises the model, so it happens
// once per process and every call shares the promise.
let pipelinePromise: Promise<TranscribeFn> | null = null;

type TranscribeFn = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<WhisperOutput>;

interface WhisperChunk {
  text: string;
  /** [start, end]; `end` is null when Whisper doesn't close the final word of a window. */
  timestamp: [number, number | null];
}
interface WhisperOutput {
  text: string;
  chunks?: WhisperChunk[];
}

async function loadPipeline(): Promise<TranscribeFn> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import: pulls in onnxruntime, which shouldn't load unless a
      // transcription actually happens.
      const { pipeline } = (await import("@huggingface/transformers")) as unknown as {
        pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<TranscribeFn>;
      };
      return pipeline("automatic-speech-recognition", config.model, {
        dtype: config.dtype,
        device: config.device,
      });
    })();
  }
  return pipelinePromise;
}

/** True when the model loads — used to fail a job up front rather than mid-run. */
export async function probe(): Promise<boolean> {
  try {
    await loadPipeline();
    return true;
  } catch {
    return false;
  }
}

/**
 * Transcribe 16 kHz mono float32 audio into word-level timings.
 *
 * `chunk_length_s` + `stride_length_s` are what make long-form work: Whisper
 * only sees 30 seconds at a time, and transformers.js slides that window with
 * overlap and re-bases each window's timestamps into whole-file time. Without
 * them a 15-minute narration would silently transcribe only its first 30
 * seconds — which is exactly the kind of failure the E2E's
 * "words span the whole audio" assertion is there to catch.
 */
export async function transcribeWords(audio: Float32Array): Promise<{ words: RawWord[]; text: string }> {
  const transcriber = await loadPipeline();

  const output = await transcriber(audio, {
    return_timestamps: "word",
    chunk_length_s: config.chunkLengthSeconds,
    stride_length_s: config.strideSeconds,
  });

  if (!output.chunks || output.chunks.length === 0) {
    throw new Error(
      "Whisper returned no word chunks — the model produced text without timestamps. " +
        "Check that WHISPER_MODEL supports word-level timestamps (it needs alignment heads).",
    );
  }

  const words: RawWord[] = output.chunks.map((chunk) => ({
    text: chunk.text,
    start: chunk.timestamp?.[0] ?? null,
    end: chunk.timestamp?.[1] ?? null,
  }));

  return { words, text: output.text ?? "" };
}
