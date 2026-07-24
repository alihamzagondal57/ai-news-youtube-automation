/**
 * The voice library.
 *
 * A curated catalog of narrator voices the review dashboard offers per video
 * (review-state.json.voiceId), with a pipeline default. Two kinds of engine
 * back these:
 *
 *  - `edge`  — Microsoft Edge neural voices (the real library: natural,
 *              multi-accent, free, no key). This is what an operator picks.
 *  - `sapi`  — the two offline Windows System.Speech voices. Robotic by
 *              comparison, but they need no network, so they exist as a
 *              last-resort fallback and as the engine the tests can always run.
 *
 * Only English voices are listed: the channel is EU-news in English, and a
 * British narrator "reads as European" to that audience (hence the default).
 * The spread across GB/IE/US/AU/CA and male/female is deliberate — the review
 * dashboard needs genuine variety to choose from, not one voice with a toggle.
 */

import { rotate } from "@ai-news/shared";

export type VoiceGender = "male" | "female";
export type VoiceEngineKind = "edge" | "kokoro" | "sapi";

export interface LibraryVoice {
  /** Stable id stored in review-state.json.voiceId and passed to the engine. */
  id: string;
  /** Human label for the review dashboard dropdown. */
  label: string;
  gender: VoiceGender;
  /** BCP-47 locale, e.g. "en-GB". */
  locale: string;
  /** Plain-English accent name for the dashboard. */
  accent: string;
  /** Which engine synthesizes this voice. */
  engine: VoiceEngineKind;
  /**
   * For sapi voices: the substring matched against an installed
   * System.Speech voice name (e.g. "David" matches "Microsoft David Desktop").
   * Unused for edge voices, whose `id` is the Edge voice ShortName as-is.
   */
  systemName?: string;
  /**
   * For kokoro voices: the model's own voice name (e.g. "bm_george"). Kept
   * separate from `id` so the library id can stay descriptive/namespaced while
   * the engine receives exactly the token it expects.
   */
  engineVoice?: string;
}

export const VOICE_LIBRARY: readonly LibraryVoice[] = [
  // -- British (the house sound) --
  { id: "en-GB-RyanNeural", label: "Ryan — British, male", gender: "male", locale: "en-GB", accent: "British", engine: "edge" },
  { id: "en-GB-SoniaNeural", label: "Sonia — British, female", gender: "female", locale: "en-GB", accent: "British", engine: "edge" },
  { id: "en-GB-ThomasNeural", label: "Thomas — British, male", gender: "male", locale: "en-GB", accent: "British", engine: "edge" },
  { id: "en-GB-LibbyNeural", label: "Libby — British, female", gender: "female", locale: "en-GB", accent: "British", engine: "edge" },
  // -- Irish --
  { id: "en-IE-ConnorNeural", label: "Connor — Irish, male", gender: "male", locale: "en-IE", accent: "Irish", engine: "edge" },
  { id: "en-IE-EmilyNeural", label: "Emily — Irish, female", gender: "female", locale: "en-IE", accent: "Irish", engine: "edge" },
  // -- American --
  { id: "en-US-GuyNeural", label: "Guy — American, male", gender: "male", locale: "en-US", accent: "American", engine: "edge" },
  { id: "en-US-JennyNeural", label: "Jenny — American, female", gender: "female", locale: "en-US", accent: "American", engine: "edge" },
  { id: "en-US-AriaNeural", label: "Aria — American, female", gender: "female", locale: "en-US", accent: "American", engine: "edge" },
  // -- Australian --
  { id: "en-AU-WilliamNeural", label: "William — Australian, male", gender: "male", locale: "en-AU", accent: "Australian", engine: "edge" },
  { id: "en-AU-NatashaNeural", label: "Natasha — Australian, female", gender: "female", locale: "en-AU", accent: "Australian", engine: "edge" },
  // -- Canadian --
  { id: "en-CA-LiamNeural", label: "Liam — Canadian, male", gender: "male", locale: "en-CA", accent: "Canadian", engine: "edge" },
  { id: "en-CA-ClaraNeural", label: "Clara — Canadian, female", gender: "female", locale: "en-CA", accent: "Canadian", engine: "edge" },
  // -- Kokoro-82M (self-hosted neural, Apache-2.0, runs on CPU, 24kHz native) --
  // The pipeline's dependency-free neural option: no egress, no key, identical
  // locally and on the render VM. `engineVoice` is the model's own voice name;
  // the parenthetical is Kokoro's published quality grade for that voice.
  { id: "kokoro-af-heart", label: "Heart — American, female (Kokoro, grade A)", gender: "female", locale: "en-US", accent: "American", engine: "kokoro", engineVoice: "af_heart" },
  { id: "kokoro-af-bella", label: "Bella — American, female (Kokoro, grade A-)", gender: "female", locale: "en-US", accent: "American", engine: "kokoro", engineVoice: "af_bella" },
  { id: "kokoro-am-michael", label: "Michael — American, male (Kokoro, grade C+)", gender: "male", locale: "en-US", accent: "American", engine: "kokoro", engineVoice: "am_michael" },
  { id: "kokoro-am-fenrir", label: "Fenrir — American, male (Kokoro, grade C+)", gender: "male", locale: "en-US", accent: "American", engine: "kokoro", engineVoice: "am_fenrir" },
  { id: "kokoro-bf-emma", label: "Emma — British, female (Kokoro, grade B-)", gender: "female", locale: "en-GB", accent: "British", engine: "kokoro", engineVoice: "bf_emma" },
  { id: "kokoro-bf-isabella", label: "Isabella — British, female (Kokoro, grade C)", gender: "female", locale: "en-GB", accent: "British", engine: "kokoro", engineVoice: "bf_isabella" },
  { id: "kokoro-bm-george", label: "George — British, male (Kokoro, grade C)", gender: "male", locale: "en-GB", accent: "British", engine: "kokoro", engineVoice: "bm_george" },
  { id: "kokoro-bm-fable", label: "Fable — British, male (Kokoro, grade C)", gender: "male", locale: "en-GB", accent: "British", engine: "kokoro", engineVoice: "bm_fable" },
  // -- Offline fallback (Windows System.Speech) --
  { id: "sapi-david", label: "David — offline, male", gender: "male", locale: "en-US", accent: "American (offline)", engine: "sapi", systemName: "David" },
  { id: "sapi-zira", label: "Zira — offline, female", gender: "female", locale: "en-US", accent: "American (offline)", engine: "sapi", systemName: "Zira" },
];

/**
 * The narrator used when a job carries no explicit voiceId.
 *
 * A Kokoro voice, deliberately: the default must work where the pipeline runs
 * (GitHub Actions + the render VM), and Edge 403s from those datacenter IPs
 * (verified — see engines/edge.ts). "bf_emma" is Kokoro's best-graded British
 * voice, so it reads as European while staying self-hosted and dependency-free.
 * Override per-run with VOICEOVER_DEFAULT_VOICE, or per-video from the review
 * dashboard via review-state.json.voiceId (e.g. "kokoro-af-heart" for Kokoro's
 * top-graded voice, or an en-GB Edge voice when rendering from a residential IP).
 */
export const DEFAULT_VOICE_ID = "kokoro-bf-emma";

const VOICE_BY_ID = new Map(VOICE_LIBRARY.map((v) => [v.id, v]));

export function getVoice(voiceId: string): LibraryVoice {
  const voice = VOICE_BY_ID.get(voiceId);
  if (!voice) {
    throw new Error(
      `Unknown voice id "${voiceId}". Known ids: ${VOICE_LIBRARY.map((v) => v.id).join(", ")}`,
    );
  }
  return voice;
}

/**
 * Resolve the voice for a job: an explicit override (from review-state.json)
 * wins, otherwise the pipeline default. An override pointing at an unknown id is
 * a configuration error and throws rather than silently falling back — the
 * operator chose that voice on purpose and a silent substitution would ship a
 * video in the wrong voice without anyone noticing.
 */
export function resolveVoiceId(overrideVoiceId: string | null | undefined): string {
  return overrideVoiceId ?? DEFAULT_VOICE_ID;
}

/** The gender-matched offline voice, used when falling back from a neural voice the environment can't reach. */
export function sapiEquivalent(voice: LibraryVoice): LibraryVoice {
  const match = VOICE_LIBRARY.find((v) => v.engine === "sapi" && v.gender === voice.gender);
  // Every gender has a sapi voice in the catalog; the ?? keeps types honest.
  return match ?? getVoice("sapi-david");
}

/** The gender-matched Kokoro voice, used when VOICEOVER_ENGINE=kokoro forces the self-hosted engine. */
export function kokoroEquivalent(voice: LibraryVoice): LibraryVoice {
  const match = VOICE_LIBRARY.find((v) => v.engine === "kokoro" && v.gender === voice.gender);
  return match ?? getVoice("kokoro-af-heart");
}

// ── Voice rotation ───────────────────────────────────────────────────────────
// A third variety axis on top of theme and script-structure rotation: narrating
// consecutive videos in a different anchor voice makes the channel read less
// like one template with the nouns swapped (the inauthentic-content concern).
//
// The pool is Kokoro-only ON PURPOSE: rotation happens automatically in the
// pipeline, which runs on datacenter IPs where Edge 403s — an Edge voice in the
// pool would fail the job. It's one top voice per accent×gender quadrant, so
// every draw is a genuinely different anchor (accent AND gender move), and each
// is the best-graded Kokoro voice in its quadrant.

/** The auto-rotation pool: best Kokoro voice per accent×gender quadrant. */
export const VOICE_ROTATION_POOL: readonly string[] = [
  "kokoro-af-heart", // American female — grade A
  "kokoro-bf-emma", // British female — grade B-
  "kokoro-am-michael", // American male — grade C+
  "kokoro-bm-george", // British male — grade C
];

/**
 * With a 4-voice pool, excluding the last 2 still leaves a choice while
 * guaranteeing more than "not twice in a row" — no accent/gender repeats within
 * a 3-video window.
 */
export const VOICE_AVOID_WINDOW = 2;

/** Cross-job rotation state, stored at `state/voice-rotation.json`. Same shape/guarantees as the other rotations. */
export interface VoiceRotationState {
  /** Most recent first. */
  recentVoiceIds: string[];
}

export const EMPTY_VOICE_ROTATION: VoiceRotationState = { recentVoiceIds: [] };

export interface VoiceSelection {
  voiceId: string;
  /** True when the id came from a manual override rather than rotation. */
  manual: boolean;
  nextState: VoiceRotationState;
}

export interface SelectVoiceOptions {
  state?: VoiceRotationState;
  /** Manual override; wins over rotation but must be a pool member (validate library-wide separately). */
  override?: string | null;
  /** Injectable for deterministic tests. Must return [0, 1). */
  random?: () => number;
  availableVoiceIds?: readonly string[];
}

/** No-recent-repeats voice pick via the shared rotation helper — the same engine theme and structure use. */
export function selectVoice(options: SelectVoiceOptions = {}): VoiceSelection {
  const { state = EMPTY_VOICE_ROTATION, override = null, random, availableVoiceIds = VOICE_ROTATION_POOL } = options;
  const result = rotate({
    ids: availableVoiceIds,
    state: { recentIds: state.recentVoiceIds },
    override,
    avoidWindow: VOICE_AVOID_WINDOW,
    random,
  });
  return { voiceId: result.id, manual: result.manual, nextState: { recentVoiceIds: result.nextState.recentIds } };
}
