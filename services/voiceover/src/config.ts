import "dotenv/config";

/**
 * How the service selects a synthesis engine.
 *  - "auto"   — use the resolved voice's native engine. Kokoro and offline
 *               voices just run; an Edge voice that is unreachable THROWS unless
 *               `allowSapiFallback` is set. No silent quality degradation.
 *  - "kokoro" — force the self-hosted Kokoro neural engine (maps any request to
 *               its gender-matched Kokoro voice). Dependency-free, so this is
 *               the reliable choice for the automated pipeline.
 *  - "edge"   — force the Edge neural engine (fail if unreachable — which it is
 *               from datacenter IPs, so this is really for residential/local use).
 *  - "sapi"   — force the offline Windows engine, mapping the requested voice to
 *               its gender-matched offline voice. Used by tests and hosts with no
 *               neural engine available.
 */
export type EngineMode = "auto" | "kokoro" | "edge" | "sapi";

function engineMode(): EngineMode {
  const raw = (process.env.VOICEOVER_ENGINE ?? "auto").toLowerCase();
  if (raw === "auto" || raw === "kokoro" || raw === "edge" || raw === "sapi") return raw;
  throw new Error(`VOICEOVER_ENGINE must be auto|kokoro|edge|sapi, got "${raw}"`);
}

export const config = {
  engineMode: engineMode(),

  /**
   * When true, an "auto" run whose Edge engine is unreachable degrades to the
   * gender-matched offline voice instead of failing the job. Off by default: a
   * robotic voice on a video the operator expected to be neural is a worse
   * failure than a retryable error, and the pipeline's stance is to halt rather
   * than ship something visibly worse.
   */
  allowSapiFallback: process.env.VOICEOVER_ALLOW_SAPI_FALLBACK === "true",

  /**
   * Silence inserted between segments, in seconds. A short beat gives the
   * narration a natural paragraph break and a moment for the segment's B-roll
   * to breathe. Folded into the *preceding* segment's timing span so the
   * timeline stays gapless (see timing.ts).
   */
  interSegmentPauseSeconds: Number(process.env.VOICEOVER_PAUSE_SECONDS ?? 0.45),

  /**
   * Canonical PCM format every piece is transcoded to before concatenation, so
   * the concat is sample-exact regardless of what each engine emitted (Edge:
   * 24kHz mp3; SAPI: 22.05kHz wav). 24kHz mono is ample for speech.
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
