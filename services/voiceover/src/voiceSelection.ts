import { z } from "zod";
import type { JobStore, Logger } from "@ai-news/shared";
import {
  EMPTY_VOICE_ROTATION,
  VOICE_AVOID_WINDOW,
  VOICE_ROTATION_POOL,
  getVoice,
  selectVoice,
} from "./voices.js";

/** Global rotation history, outside any job's tree. */
export const VOICE_ROTATION_KEY = "state/voice-rotation.json";

/** Per-job record of the voice actually used. */
export const JOB_VOICE_FILE = "voice.json";

const rotationStateSchema = z.object({ recentVoiceIds: z.array(z.string()) });
const jobVoiceSchema = z.object({ voiceId: z.string() });
// Only the field we need; the dashboard owns the rest of this document.
const reviewOverrideSchema = z.object({ voiceId: z.string().nullable().optional() }).passthrough();

/**
 * Decides which narrator voice a job is spoken in, in priority order:
 *
 *   1. A manual override from the review dashboard (review-state.json.voiceId).
 *   2. The voice this job already used (voice.json).
 *   3. Auto-rotation over the top news-anchor voices, which then records the pick.
 *
 * Step 2 makes the voice sticky per job, and it matters more than for structure:
 * a voice change re-times the entire video (new audio, new offsets), so a retry
 * that re-rolled the voice would produce a voiceover.wav whose timing no longer
 * matches the captions/media/render the pipeline already built. Rotation happens
 * once per job, not once per attempt. Mirrors resolveJobStructure exactly, using
 * the same shared rotation helper — this is the third variety axis (voice) on
 * top of theme and script-structure.
 *
 * A review override may name ANY library voice (e.g. a Kokoro voice outside the
 * rotation pool); it's validated against the whole library. It only joins
 * rotation history when it's a pool member, since history is the pool's "don't
 * repeat" memory.
 *
 * Concurrency: read-modify-write with no lock, safe for the one-job-at-a-time
 * pipeline; concurrent jobs could pick the same voice, costing variety but
 * breaking nothing.
 */
export async function resolveJobVoice(store: JobStore, jobId: string, logger: Logger): Promise<string> {
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewOverrideSchema);
  const recorded = await store.getJsonIfExists(store.jobKey(jobId, JOB_VOICE_FILE), jobVoiceSchema);

  const override = reviewState?.voiceId ?? null;
  if (override) {
    // Validate against the whole library, not just the pool — the dashboard can
    // hand-pick any voice. Throws on an unknown id rather than silently defaulting.
    getVoice(override);
    if (recorded?.voiceId !== override) {
      if (VOICE_ROTATION_POOL.includes(override)) await recordRotation(store, override);
      await store.putJson(store.jobKey(jobId, JOB_VOICE_FILE), { voiceId: override });
      logger.info({ jobId, voiceId: override }, "Voice set from review override");
    }
    return override;
  }

  if (recorded?.voiceId) {
    logger.info({ jobId, voiceId: recorded.voiceId }, "Reusing voice already recorded for this job");
    return recorded.voiceId;
  }

  const state = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_VOICE_ROTATION;
  const selection = selectVoice({ state });
  await store.putJson(VOICE_ROTATION_KEY, selection.nextState);
  await store.putJson(store.jobKey(jobId, JOB_VOICE_FILE), { voiceId: selection.voiceId });
  logger.info(
    { jobId, voiceId: selection.voiceId, avoided: state.recentVoiceIds.slice(0, VOICE_AVOID_WINDOW) },
    "Voice selected by auto-rotation",
  );
  return selection.voiceId;
}

async function recordRotation(store: JobStore, voiceId: string): Promise<void> {
  const state = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_VOICE_ROTATION;
  const next = selectVoice({ state, override: voiceId }).nextState;
  await store.putJson(VOICE_ROTATION_KEY, next);
}
