import type { Logger } from "@ai-news/shared";
import { config, type EngineMode } from "../config.js";
import { getVoice, kokoroEquivalent, sapiEquivalent, type LibraryVoice } from "../voices.js";
import { EdgeTtsEngine } from "./edge.js";
import { KokoroEngine } from "./kokoro.js";
import { SapiEngine } from "./sapi.js";
import type { TtsEngine } from "./types.js";

export type { TtsEngine } from "./types.js";

const EDGE = new EdgeTtsEngine();
const KOKORO = new KokoroEngine();
const SAPI = new SapiEngine();

function engineFor(kind: LibraryVoice["engine"]): TtsEngine {
  if (kind === "sapi") return SAPI;
  if (kind === "kokoro") return KOKORO;
  return EDGE;
}

export interface ResolvedEngine {
  engine: TtsEngine;
  /** The voice actually used — may differ from the requested one after a fallback. */
  voice: LibraryVoice;
}

/**
 * Decide which engine synthesizes a job, honoring VOICEOVER_ENGINE and the
 * fail-loud stance. The requested voice is what the operator chose; this only
 * substitutes it under an explicit mode or an explicitly-allowed fallback, and
 * says so loudly when it does.
 */
export async function resolveEngine(
  requestedVoice: LibraryVoice,
  logger: Logger,
  mode: EngineMode = config.engineMode,
): Promise<ResolvedEngine> {
  // Forced Kokoro: self-hosted, always available once weights are cached. Map
  // any request onto its gender-matched Kokoro voice.
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

  // Forced offline: map the request onto its gender-matched offline voice.
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

  // Forced neural Edge: never degrade, fail if unreachable.
  if (mode === "edge") {
    if (requestedVoice.engine !== "edge") {
      throw new Error(`VOICEOVER_ENGINE=edge but voice "${requestedVoice.id}" is not an Edge voice`);
    }
    if (!(await EDGE.probe())) {
      throw new Error("VOICEOVER_ENGINE=edge but the Edge TTS endpoint is unreachable (token/egress); see engines/edge.ts");
    }
    return { engine: EDGE, voice: requestedVoice };
  }

  // ── Auto ────────────────────────────────────────────────────────────────
  // Self-hosted and offline voices run on their own engine directly.
  if (requestedVoice.engine === "kokoro") {
    if (!(await KOKORO.probe())) {
      throw new Error(`Kokoro voice "${requestedVoice.id}" selected but the Kokoro model failed to load`);
    }
    return { engine: KOKORO, voice: requestedVoice };
  }
  if (requestedVoice.engine === "sapi") {
    return { engine: SAPI, voice: requestedVoice };
  }

  // Native engine is Edge. If it's reachable, use it.
  if (await EDGE.probe()) {
    return { engine: EDGE, voice: requestedVoice };
  }

  // Edge unreachable. Degrade only if explicitly allowed; otherwise halt — a
  // robotic voice on a video meant to be neural is a worse outcome than a
  // retryable failure (mirrors script-generator's "halt over ship weak").
  if (!config.allowSapiFallback) {
    throw new Error(
      `Edge TTS is unreachable for voice "${requestedVoice.id}" and VOICEOVER_ALLOW_SAPI_FALLBACK is not set. ` +
        "Edge 403s from datacenter IPs (including GitHub Actions), so prefer a Kokoro voice for the automated " +
        "pipeline, or set VOICEOVER_ENGINE=kokoro. Set VOICEOVER_ALLOW_SAPI_FALLBACK=true to allow offline degradation.",
    );
  }
  const voice = sapiEquivalent(requestedVoice);
  if (!(await SAPI.probe())) {
    throw new Error("Edge TTS is unreachable and no offline System.Speech voice is available to fall back to");
  }
  logger.warn(
    { requested: requestedVoice.id, using: voice.id },
    "Edge TTS unreachable — degrading to offline voice (VOICEOVER_ALLOW_SAPI_FALLBACK=true)",
  );
  return { engine: SAPI, voice };
}

/** Convenience for callers that hold a voice id rather than the resolved record. */
export function voiceById(voiceId: string): LibraryVoice {
  return getVoice(voiceId);
}
