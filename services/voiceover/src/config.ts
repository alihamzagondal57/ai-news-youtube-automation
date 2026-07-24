import "dotenv/config";

/**
 * How the service selects a synthesis engine.
 *  - "auto"   — run the resolved voice on its own engine (Kokoro for library
 *               voices; SAPI for the offline fallback voices). The default.
 *  - "kokoro" — force the self-hosted Kokoro neural engine, mapping any request
 *               to its gender-matched Kokoro voice.
 *  - "sapi"   — force the offline Windows engine, mapping the requested voice to
 *               its gender-matched offline voice. Used by tests and hosts that
 *               can't load the Kokoro weights.
 */
export type EngineMode = "auto" | "kokoro" | "sapi";

function engineMode(): EngineMode {
  const raw = (process.env.VOICEOVER_ENGINE ?? "auto").toLowerCase();
  if (raw === "auto" || raw === "kokoro" || raw === "sapi") return raw;
  throw new Error(`VOICEOVER_ENGINE must be auto|kokoro|sapi, got "${raw}"`);
}

export const config = {
  engineMode: engineMode(),

  /**
   * Silence inserted between segments, in seconds. A short beat gives the
   * narration a natural paragraph break and a moment for the segment's B-roll
   * to breathe. Folded into the *preceding* segment's timing span so the
   * timeline stays gapless (see timing.ts).
   */
  interSegmentPauseSeconds: Number(process.env.VOICEOVER_PAUSE_SECONDS ?? 0.45),

  /**
   * Canonical PCM format every piece is transcoded to before concatenation, so
   * the concat is sample-exact regardless of what each engine emitted (Kokoro:
   * 24kHz wav; SAPI: 22.05kHz wav). 24kHz mono is ample for speech.
   */
  audio: {
    sampleRate: 24000,
    channels: 1,
  },

  /**
   * EBU R128 loudness normalization target, applied once to the finished track.
   * -16 LUFS is the common target for spoken-word/streaming; true-peak -1.5 dBTP
   * leaves headroom so the encoder can't clip.
   */
  loudness: {
    integratedLufs: Number(process.env.VOICEOVER_LUFS ?? -16),
    truePeakDb: Number(process.env.VOICEOVER_TRUE_PEAK ?? -1.5),
    range: Number(process.env.VOICEOVER_LRA ?? 11),
  },
};
