import type { Logger } from "@ai-news/shared";
import { config, type EngineMode } from "../config.js";
import { getVoice, kokoroEquivalent, sapiEquivalent, type LibraryVoice } from "../voices.js";
import { KokoroEngine } from "./kokoro.js";
import { SapiEngine } from "./sapi.js";
import type { TtsEngine } from "./types.js";

export type { TtsEngine } from "./types.js";

const KOKORO = new KokoroEngine();
const SAPI = new SapiEngine();

export interface ResolvedEngine {
  engine: TtsEngine;
  /** The voice actually used — may differ from the requested one after a mode-forced substitution. */
  voice: LibraryVoice;
}

/**
 * Decide which engine synthesizes a job, honoring VOICEOVER_ENGINE.
 *
 * The production library is entirely self-hosted (Kokoro), so there is no
 * remote engine to be unreachable and no silent-degradation problem: each voice
 * runs on its own engine. The offline SAPI engine exists only as a
 * no-model-weights fallback for hosts that can't load Kokoro (and for tests).
 */
export async function resolveEngine(
  requestedVoice: LibraryVoice,
  logger: Logger,
  mode: EngineMode = config.engineMode,
): Promise<ResolvedEngine> {
  // Forced Kokoro: map any request onto its gender-matched Kokoro voice.
  if (mode === "kokoro") {
    const voice = requestedVoice.engine === "kokoro" ? requestedVoice : kokoroEquivalent(requestedVoice);
    if (voice.id !== requestedVoice.id) {
      logger.warn({ requested: requestedVoice.id, using: voice.id }, "VOICEOVER_ENGINE=kokoro: using Kokoro voice");
    }
    if (!(await KOKORO.probe())) {
      throw new Error("VOICEOVER_ENGINE=kokoro but the Kokoro model failed to load (check kokoro-js install / weights download)");
    }
    return { engine: KOKORO, voice };
  }

  // Forced offline: map any request onto its gender-matched offline voice.
  if (mode === "sapi") {
    const voice = requestedVoice.engine === "sapi" ? requestedVoice : sapiEquivalent(requestedVoice);
    if (!(await SAPI.probe())) {
      throw new Error("VOICEOVER_ENGINE=sapi but no System.Speech voices are available on this host");
    }
    if (voice.id !== requestedVoice.id) {
      logger.warn({ requested: requestedVoice.id, using: voice.id }, "VOICEOVER_ENGINE=sapi: using offline voice");
    }
    return { engine: SAPI, voice };
  }

  // ── Auto: run the voice on its own engine ─────────────────────────────────
  if (requestedVoice.engine === "sapi") {
    if (!(await SAPI.probe())) {
      throw new Error(`Offline voice "${requestedVoice.id}" selected but no System.Speech voice is available on this host`);
    }
    return { engine: SAPI, voice: requestedVoice };
  }

  // Kokoro voice — the default production path.
  if (!(await KOKORO.probe())) {
    throw new Error(`Kokoro voice "${requestedVoice.id}" selected but the Kokoro model failed to load (check kokoro-js install / weights download)`);
  }
  return { engine: KOKORO, voice: requestedVoice };
}

/** Convenience for callers that hold a voice id rather than the resolved record. */
export function voiceById(voiceId: string): LibraryVoice {
  return getVoice(voiceId);
}
