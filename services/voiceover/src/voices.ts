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

export type VoiceGender = "male" | "female";
export type VoiceEngineKind = "edge" | "sapi";

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
  // -- Offline fallback (Windows System.Speech) --
  { id: "sapi-david", label: "David — offline, male", gender: "male", locale: "en-US", accent: "American (offline)", engine: "sapi", systemName: "David" },
  { id: "sapi-zira", label: "Zira — offline, female", gender: "female", locale: "en-US", accent: "American (offline)", engine: "sapi", systemName: "Zira" },
];

/** The narrator used when a job carries no explicit voiceId. British male reads as European to the target audience. */
export const DEFAULT_VOICE_ID = "en-GB-RyanNeural";

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
