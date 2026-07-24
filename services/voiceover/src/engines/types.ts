import type { LibraryVoice } from "../voices.js";

/**
 * A text-to-speech backend. The service is engine-agnostic: it resolves a voice
 * to an engine, then only ever calls `synthesize`. Adding a backend is one new
 * implementation of this interface plus a registry entry.
 */
export interface TtsEngine {
  readonly kind: "edge" | "sapi";

  /**
   * Whether this engine can run right now — network reachable, binary/runtime
   * present. Used by "auto" mode to decide whether to fall back before it starts
   * synthesizing, so a job fails (or degrades) up front rather than halfway
   * through a script.
   */
  probe(): Promise<boolean>;

  /**
   * Synthesize `text` in `voice` to an audio file at `outputPath`. The output
   * format may be anything ffmpeg can read (Edge emits mp3, SAPI emits wav); the
   * caller transcodes to the canonical format afterward. Must throw on failure
   * rather than write a truncated or empty file.
   */
  synthesize(text: string, voice: LibraryVoice, outputPath: string): Promise<void>;
}
