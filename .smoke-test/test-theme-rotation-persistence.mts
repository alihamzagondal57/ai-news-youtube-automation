// Verifies theme rotation actually persists across jobs through the store, so
// consecutive videos get different themes — and that a job's theme is STICKY,
// which is what stops a targeted re-render from re-skinning the video and
// invalidating its own chunk cache.
//
// Runs against s3rver (in-process S3) — no rendering, so it finishes in seconds.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";

const S3_PORT = 4571;
const BUCKET = "ai-news-pipeline";

process.env.R2_ACCOUNT_ID = "rotation";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

const jobId = (n: number) => `${String(n).padStart(8, "0")}-1111-1111-1111-111111111111`;

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "rotation-s3-"));
  const server = new S3rver({
    port: S3_PORT,
    address: "localhost",
    silent: true,
    directory: dataDir,
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  await server.run();

  try {
    const { JobStore, createLogger } = await import("@ai-news/shared");
    const { THEMES } = await import("../services/shared/src/theme/index.ts");
    const { resolveJobTheme, THEME_ROTATION_KEY, JOB_THEME_FILE } = await import(
      "../infra/render-server/src/themeSelection.ts"
    );
    const store = JobStore.fromEnv();
    const logger = createLogger("rotation-test");
    // Quiet: the resolver logs a line per job and we run 40 of them.
    const quiet = { ...logger, info: () => {}, child: () => quiet } as unknown as typeof logger;

    // ── 40 sequential jobs, as if 40 videos were produced ────────────────────
    const JOBS = 40;
    const sequence: string[] = [];
    for (let i = 0; i < JOBS; i++) {
      sequence.push(await resolveJobTheme(store, jobId(i), quiet));
    }

    let consecutive = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1]) consecutive++;
    }
    check(
      "no two consecutive videos share a theme",
      consecutive === 0,
      `0 consecutive repeats across ${JOBS} jobs persisted through the store`,
    );
    check(
      "rotation spreads across the catalog",
      new Set(sequence).size >= Math.min(THEMES.length, 12),
      `${new Set(sequence).size} distinct themes used across ${JOBS} jobs`,
    );
    console.log(`        first 8: ${sequence.slice(0, 8).join(", ")}`);

    // ── Rotation state actually landed in the store ──────────────────────────
    const persisted = await store.getJsonIfExists(THEME_ROTATION_KEY, (await import("zod")).z.object({
      recentThemeIds: (await import("zod")).z.array((await import("zod")).z.string()),
    }));
    check(
      "rotation history persisted to state/theme-rotation.json",
      persisted !== null && persisted.recentThemeIds.length > 0,
      `${persisted?.recentThemeIds.length ?? 0} recent ids stored, newest "${persisted?.recentThemeIds[0]}"`,
    );
    check(
      "newest history entry matches the last job's theme",
      persisted?.recentThemeIds[0] === sequence[sequence.length - 1],
      `history head "${persisted?.recentThemeIds[0]}" === last pick "${sequence[sequence.length - 1]}"`,
    );

    // ── Stickiness: re-resolving a job must not re-roll ──────────────────────
    const resolvedAgain = await resolveJobTheme(store, jobId(0), quiet);
    check(
      "a job's theme is sticky across re-renders",
      resolvedAgain === sequence[0],
      `job 0 resolved "${resolvedAgain}" again — a targeted re-render cannot re-skin the video or invalidate its chunk cache`,
    );
    const recorded = await store.getJsonIfExists(
      store.jobKey(jobId(0), JOB_THEME_FILE),
      (await import("zod")).z.object({ themeId: (await import("zod")).z.string() }),
    );
    check(
      "per-job theme recorded in the store",
      recorded?.themeId === sequence[0],
      `jobs/{id}/${JOB_THEME_FILE} holds "${recorded?.themeId}"`,
    );

    const historyBefore = (await store.getJsonIfExists(THEME_ROTATION_KEY, (await import("zod")).z.object({
      recentThemeIds: (await import("zod")).z.array((await import("zod")).z.string()),
    })))!.recentThemeIds.join(",");
    await resolveJobTheme(store, jobId(0), quiet);
    const historyAfter = (await store.getJsonIfExists(THEME_ROTATION_KEY, (await import("zod")).z.object({
      recentThemeIds: (await import("zod")).z.array((await import("zod")).z.string()),
    })))!.recentThemeIds.join(",");
    check(
      "re-resolving a job does not disturb rotation history",
      historyBefore === historyAfter,
      "sticky reads are side-effect free",
    );

    // ── Manual override from the review dashboard ────────────────────────────
    const overrideJob = jobId(0);
    const overrideTheme = sequence[0] === "ember" ? "noir" : "ember";
    await store.putJson(store.jobKey(overrideJob, "review-state.json"), {
      jobId: overrideJob,
      status: "changes-requested",
      voiceId: null,
      themeId: overrideTheme,
      stylePresetId: null,
      style: {},
      clipOverrides: [],
      reviewedBy: "reviewer",
      updatedAt: new Date().toISOString(),
    });
    const afterOverride = await resolveJobTheme(store, overrideJob, quiet);
    check(
      "review override beats the recorded theme",
      afterOverride === overrideTheme,
      `job resolved "${afterOverride}" from review-state.json`,
    );
    const recordedAfter = await store.getJsonIfExists(
      store.jobKey(overrideJob, JOB_THEME_FILE),
      (await import("zod")).z.object({ themeId: (await import("zod")).z.string() }),
    );
    check(
      "override is written back as the job's theme",
      recordedAfter?.themeId === overrideTheme,
      `subsequent re-renders stay on "${recordedAfter?.themeId}"`,
    );
    const historyWithOverride = await store.getJsonIfExists(THEME_ROTATION_KEY, (await import("zod")).z.object({
      recentThemeIds: (await import("zod")).z.array((await import("zod")).z.string()),
    }));
    check(
      "override joins rotation history",
      historyWithOverride?.recentThemeIds[0] === overrideTheme,
      `next auto-pick won't immediately repeat the hand-picked "${overrideTheme}"`,
    );

    // ── Unknown override must fail loudly, not silently fall back ────────────
    await store.putJson(store.jobKey(jobId(99), "review-state.json"), { themeId: "not-a-real-theme" });
    let threw = false;
    try {
      await resolveJobTheme(store, jobId(99), quiet);
    } catch {
      threw = true;
    }
    check("unknown override rejected", threw, "a typo'd theme id fails the render instead of silently defaulting");

    console.log("");
    console.log(failures === 0 ? "ALL ROTATION PERSISTENCE TESTS PASSED" : `${failures} failure(s)`);
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
