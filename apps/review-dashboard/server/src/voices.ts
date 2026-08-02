import { existsSync } from "node:fs";
import { join } from "node:path";
import { VOICE_LIBRARY } from "@ai-news/voiceover/voices";
import { config } from "./config.js";

export interface VoiceCatalogEntry {
  id: string;
  label: string;
  gender: string;
  locale: string;
  accent: string;
  engine: string;
  /** Whether services/voiceover/samples/{id}.wav exists — 6 of 10 voices currently do; the dashboard hides/disables preview for the rest rather than 404ing. */
  hasSample: boolean;
}

export function listVoiceCatalog(): VoiceCatalogEntry[] {
  return VOICE_LIBRARY.map((v) => ({
    id: v.id,
    label: v.label,
    gender: v.gender,
    locale: v.locale,
    accent: v.accent,
    engine: v.engine,
    hasSample: existsSync(join(config.voiceSamplesDir, `${v.id}.wav`)),
  }));
}

export function voiceSamplePath(voiceId: string): string | null {
  const path = join(config.voiceSamplesDir, `${voiceId}.wav`);
  return existsSync(path) ? path : null;
}
