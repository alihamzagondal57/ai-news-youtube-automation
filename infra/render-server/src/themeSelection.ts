import { z } from "zod";
import type { JobStore, Logger } from "@ai-news/shared";
import { EMPTY_ROTATION_STATE, THEME_IDS, selectTheme } from "@ai-news/shared/theme";

/** Global rotation history, outside any job's tree. */
export const THEME_ROTATION_KEY = "state/theme-rotation.json";

/** Per-job record of the theme actually used. */
export const JOB_THEME_FILE = "theme.json";

const rotationStateSchema = z.object({ recentThemeIds: z.array(z.string()) });
const jobThemeSchema = z.object({ themeId: z.string() });
// Only the field we need; the dashboard owns the rest of this document.
const reviewOverrideSchema = z.object({ themeId: z.string().nullable().optional() }).passthrough();

/**
 * Decides which theme a job renders with, in priority order:
 *
 *   1. A manual override from the review dashboard (review-state.json.themeId).
 *   2. The theme this job already rendered with (theme.json).
 *   3. Auto-rotation, which then records the pick.
 *
 * Step 2 is what makes the theme *sticky*, and it is load-bearing rather than an
 * optimisation: a targeted re-render after a clip swap must reuse the cached
 * chunks, and re-rolling the theme would re-skin the whole video and invalidate
 * every one of them. Rotation happens once per job, not once per render.
 *
 * Concurrency note: rotation state is read-modify-write with no lock. The
 * pipeline renders one video at a time on a single on-demand VM, so this is
 * safe today; two truly concurrent jobs could pick the same theme, which
 * degrades variety but breaks nothing.
 */
export async function resolveJobTheme(store: JobStore, jobId: string, logger: Logger): Promise<string> {
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewOverrideSchema);
  const recorded = await store.getJsonIfExists(store.jobKey(jobId, JOB_THEME_FILE), jobThemeSchema);

  const override = reviewState?.themeId ?? null;
  if (override) {
    if (!THEME_IDS.includes(override)) {
      throw new Error(`review-state.json requests unknown theme "${override}" for job ${jobId}`);
    }
    if (recorded?.themeId !== override) {
      // A newly chosen override still joins the history, so the next auto-pick
      // doesn't immediately repeat a hand-picked look.
      await recordRotation(store, override);
      await store.putJson(store.jobKey(jobId, JOB_THEME_FILE), { themeId: override });
      logger.info({ jobId, themeId: override }, "Theme set from review override");
    }
    return override;
  }

  if (recorded?.themeId) {
    logger.info({ jobId, themeId: recorded.themeId }, "Reusing theme already recorded for this job");
    return recorded.themeId;
  }

  const state = (await store.getJsonIfExists(THEME_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_ROTATION_STATE;
  const selection = selectTheme({ state });
  await store.putJson(THEME_ROTATION_KEY, selection.nextState);
  await store.putJson(store.jobKey(jobId, JOB_THEME_FILE), { themeId: selection.themeId });
  logger.info(
    { jobId, themeId: selection.themeId, avoided: state.recentThemeIds.slice(0, 5) },
    "Theme selected by auto-rotation",
  );
  return selection.themeId;
}

async function recordRotation(store: JobStore, themeId: string): Promise<void> {
  const state = (await store.getJsonIfExists(THEME_ROTATION_KEY, rotationStateSchema)) ?? EMPTY_ROTATION_STATE;
  const next = selectTheme({ state, override: themeId }).nextState;
  await store.putJson(THEME_ROTATION_KEY, next);
}
