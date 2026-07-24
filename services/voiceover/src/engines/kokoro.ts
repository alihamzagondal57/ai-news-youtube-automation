import { writeFile } from "node:fs/promises";
import type { LibraryVoice } from "../voices.js";
import type { TtsEngine } from "./types.js";

/**
 * Kokoro-82M — a self-hosted neural TTS engine (Apache-2.0, 82M params, runs on
 * CPU, ~80-330MB ONNX weights, 24kHz native). Run through kokoro-js, so it lives
 * entirely inside this Node service: no external API, no egress, no key, no rate
 * limit — it behaves identically on a laptop, in GitHub Actions, and on the
 * render VM. That independence is the reason it exists here: Edge's neural
 * endpoint 403s from datacenter IPs (verified from both the dev sandbox and a
 * GitHub-hosted ubuntu runner), so it cannot back an automated pipeline.
 *
 * 24kHz output already matches the pipeline's canonical format, so the later
 * transcode is a near no-op for Kokoro audio.
 */

const MODEL_ID = process.env.VOICEOVER_KOKORO_MODEL ?? "onnx-community/Kokoro-82M-v1.0-ONNX";
// q8 keeps the download small (~86MB) and runs comfortably on CPU; override to
// "fp32" for maximum fidelity where the weights and time are affordable.
const DTYPE = process.env.VOICEOVER_KOKORO_DTYPE ?? "q8";
// "cpu" uses the native onnxruntime-node binary; "wasm" is the portable fallback.
const DEVICE = process.env.VOICEOVER_KOKORO_DEVICE ?? "cpu";
const SAMPLE_RATE = 24000;
const DEFAULT_VOICE = "af_heart";

// The model is heavy to construct and must be loaded exactly once per process;
// every synthesize call shares this promise.
let modelPromise: Promise<KokoroModel> | null = null;

interface RawAudioLike {
  audio: Float32Array;
  sampling_rate: number;
}
interface KokoroModel {
  generate(text: string, options: { voice: string }): Promise<RawAudioLike>;
}

async function loadModel(): Promise<KokoroModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      // Dynamic import: kokoro-js pulls in onnxruntime, which we don't want to
      // load unless a Kokoro voice is actually used.
      const { KokoroTTS } = (await import("kokoro-js")) as {
        KokoroTTS: { from_pretrained(id: string, opts: { dtype: string; device: string }): Promise<KokoroModel> };
      };
      return KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: DEVICE });
    })();
  }
  return modelPromise;
}

/**
 * Split narration into pieces the model can voice in one pass. Kokoro caps a
 * single generate() at roughly 510 phoneme tokens; ~350 characters stays safely
 * under that. Sentence-boundary splitting keeps prosody natural, and the pieces
 * are concatenated back into one segment file so the split is invisible.
 */
function splitForModel(text: string, maxChars = 350): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

/** Encode mono float samples as a 16-bit PCM WAV — the format the rest of the pipeline expects. */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), offset);
    offset += 2;
  }
  return buffer;
}

export class KokoroEngine implements TtsEngine {
  readonly kind = "kokoro" as const;

  /** Loading the model is the reachability test: it succeeds offline once the weights are cached. */
  async probe(): Promise<boolean> {
    try {
      await loadModel();
      return true;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, voice: LibraryVoice, outputPath: string): Promise<void> {
    const model = await loadModel();
    const voiceName = voice.engineVoice ?? DEFAULT_VOICE;

    const parts: Float32Array[] = [];
    for (const chunk of splitForModel(text)) {
      const audio = await model.generate(chunk, { voice: voiceName });
      if (!audio.audio || audio.audio.length === 0) {
        throw new Error(`Kokoro returned no audio for voice "${voiceName}"`);
      }
      parts.push(audio.audio);
    }

    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }

    await writeFile(outputPath, encodeWavPcm16(merged, SAMPLE_RATE));
  }
}

// Exposed for unit testing the pure helpers without loading the model.
export const __test = { splitForModel, encodeWavPcm16 };
