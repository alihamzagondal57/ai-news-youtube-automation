import { z } from "zod";
import type { JobStore, Logger } from "@ai-news/shared";
import {
  EMPTY_STRUCTURE_ROTATION,
  STRUCTURE_IDS,
  selectStructure,
} from "@ai-news/shared/script-structure";

/** Global rotation history, outside any job's tree. */
export const STRUCTURE_ROTATION_KEY = "state/script-structure-rotation.json";

/** Per-job record of the skeleton actually used. */
export const JOB_STRUCTURE_FILE = "script-structure.json";

const rotationStateSchema = z.object({ recentStructureIds: z.array(z.string()) });
const jobStructureSchema = z.object({ structureId: z.string() });
// Only the field we need; the dashboard owns the rest of this document.
const reviewOverrideSchema = z.object({ structureId: z.string().nullable().optional() }).passthrough();

/**
 * Decides which script skeleton a job is written against, in priority order:
 *
 *   1. A manual override from the review dashboard (review-state.json.structureId).
 *   2. The skeleton this job already used (script-structure.json).
 *   3. Auto-rotation, which then records the pick.
 *
 * Step 2 makes the structure sticky per job: re-running a failed script-generator
 * step (the pipeline's normal retry path) must not re-roll the video's shape,
 * or the retry would silently produce a structurally different script than the
 * one upstream steps were told about. Mirrors render-server's theme resolution.
 *
 * Concurrency: read-modify-write with no lock, safe for the one-job-at-a-time
 * pipeline; concurrent jobs could pick the same skeleton, which costs variety
 * but breaks nothing.
 */
export async function resolveJobStructure(store: JobStore, jobId: string, logger: Logger): Promise<string> {
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewOverrideSchema);
  const recorded = await store.getJsonIfExists(store.jobKey(jobId, JOB_STRUCTURE_FILE), jobStructureSchema);

  const override = reviewState?.structureId ?? null;
  if (override) {
    if (!STRUCTURE_IDS.includes(override)) {
      throw new Error(`review-state.json requests unknown script structure "${override}" for job ${jobId}`);
    }
    if (recorded?.structureId !== override) {
      await recordRotation(store, override);
      await store.putJson(store.jobKey(jobId, JOB_STRUCTURE_FILE), { structureId: override });
      logger.info({ jobId, structureId: override }, "Script structure set from review override");
    }
    return override;
  }

  if (recorded?.structureId) {
    logger.info({ jobId, structureId: recorded.structureId }, "Reusing script structure already recorded for this job");
    return recorded.structureId;
  }

  const state = (await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_STRUCTURE_ROTATION;
  const selection = selectStructure({ state });
  await store.putJson(STRUCTURE_ROTATION_KEY, selection.nextState);
  await store.putJson(store.jobKey(jobId, JOB_STRUCTURE_FILE), { structureId: selection.structureId });
  logger.info(
    { jobId, structureId: selection.structureId, avoided: state.recentStructureIds.slice(0, 4) },
    "Script structure selected by auto-rotation",
  );
  return selection.structureId;
}

async function recordRotation(store: JobStore, structureId: string): Promise<void> {
  const state = (await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_STRUCTURE_ROTATION;
  const next = selectStructure({ state, override: structureId }).nextState;
  await store.putJson(STRUCTURE_ROTATION_KEY, next);
}
