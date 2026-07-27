import "dotenv/config";

/**
 * `WHISPER_MODEL` was originally specced for Python's `faster-whisper`, which
 * takes bare size names ("base", "medium"). transformers.js takes a HuggingFace
 * repo id, so a leftover bare name produces a baffling 401 on
 * `huggingface.co/medium/...` rather than an obvious configuration error.
 * Translating the legacy names keeps an existing .env working and keeps the
 * failure legible.
 */
const LEGACY_SIZE_ALIASES: Record<string, string> = {
  tiny: "Xenova/whisper-tiny.en",
  base: "Xenova/whisper-base.en",
  small: "Xenova/whisper-small.en",
  medium: "Xenova/whisper-medium.en",
};

const DEFAULT_MODEL = "Xenova/whisper-base.en";

/** Set when a legacy size name was translated, so the service can log it once. */
export let modelAliasNotice: string | null = null;

function resolveModel(): string {
  const raw = (process.env.WHISPER_MODEL || "").trim();
  if (!raw) return DEFAULT_MODEL;

  const alias = LEGACY_SIZE_ALIASES[raw.toLowerCase()];
  if (alias) {
    modelAliasNotice =
      `WHISPER_MODEL="${raw}" is a faster-whisper size name; using "${alias}". ` +
      (raw.toLowerCase() === "medium" || raw.toLowerCase() === "small"
        ? `That checkpoint is much larger and markedly slower on CPU — set WHISPER_MODEL="${DEFAULT_MODEL}" unless you specifically want it.`
        : `Set WHISPER_MODEL to a full repo id to silence this.`);
    return alias;
  }

  // A real repo id always has an owner/name form; anything else is a typo we
  // should reject up front rather than fail on mid-download.
  if (!raw.includes("/")) {
    throw new Error(
      `WHISPER_MODEL="${raw}" is not a HuggingFace repo id (expected "owner/name", e.g. "${DEFAULT_MODEL}"). ` +
        `Known size aliases: ${Object.keys(LEGACY_SIZE_ALIASES).join(", ")}.`,
    );
  }
  return raw;
}

export const config = {
  /**
   * Whisper checkpoint. `base.en` is the accuracy/speed sweet spot for clean
   * synthetic narration on CPU: `tiny.en` drops and mistimes words often enough
   * to be visible in karaoke captions, while `small.en` costs several times the
   * runtime for a marginal gain on audio this clean (our input is Kokoro TTS —
   * no accents, no crosstalk, no background noise).
   *
   * English-only (`.en`) on purpose: the channel is English, and the monolingual
   * checkpoints are more accurate than the multilingual ones at the same size.
   */
  model: resolveModel(),

  /** Quantization. q8 keeps the download ~50MB and runs comfortably on CPU. */
  dtype: process.env.WHISPER_DTYPE || "q8",

  /** "cpu" uses onnxruntime-node; the pipeline has no GPU requirement. */
  device: process.env.WHISPER_DEVICE || "cpu",

  /**
   * Whisper's receptive field is a hard 30 seconds, so long-form audio must be
   * chunked. transformers.js handles the windowing and re-bases timestamps into
   * whole-file time itself, given these two values.
   */
  chunkLengthSeconds: Number(process.env.WHISPER_CHUNK_SECONDS ?? 30),
  /**
   * Overlap between consecutive windows. Without it a word straddling a chunk
   * boundary is cut in half and mistimed; the pipeline uses the overlap to
   * stitch boundary words back together.
   */
  strideSeconds: Number(process.env.WHISPER_STRIDE_SECONDS ?? 5),

  /** Whisper wants 16 kHz mono float32 — not negotiable, it's what the model was trained on. */
  sampleRate: 16000,
} as const;
