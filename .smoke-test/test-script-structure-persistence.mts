// Verifies script-structure rotation persists across jobs through the store, so
// consecutive videos are built on different skeletons — and that a job's
// structure is STICKY, which is what stops a script-generator retry from
// silently rewriting the video's shape out from under downstream steps.
//
// Runs against s3rver (in-process S3) — no LLM calls, so it finishes in seconds.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { z } from "zod";

const S3_PORT = 4572;
const BUCKET = "ai-news-pipeline";

process.env.R2_ACCOUNT_ID = "structure";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const rotationSchema = z.object({ recentStructureIds: z.array(z.string()) });
const jobStructureSchema = z.object({ structureId: z.string() });

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

const jobId = (n: number) => `${String(n).padStart(8, "0")}-2222-2222-2222-222222222222`;

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "structure-s3-"));
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
    const { SCRIPT_STRUCTURES } = await import("../services/shared/src/script-structure/index.ts");
    const { resolveJobStructure, STRUCTURE_ROTATION_KEY, JOB_STRUCTURE_FILE } = await import(
      "../services/script-generator/src/structureSelection.ts"
    );
    const store = JobStore.fromEnv();
    const logger = createLogger("structure-test");
    // Quiet: the resolver logs a line per job and we run 40 of them.
    const quiet = { ...logger, info: () => {}, child: () => quiet } as unknown as typeof logger;

    // ── 40 sequential jobs, as if 40 videos were scripted ────────────────────
    const JOBS = 40;
    const sequence: string[] = [];
    for (let i = 0; i < JOBS; i++) {
      sequence.push(await resolveJobStructure(store, jobId(i), quiet));
    }

    let consecutive = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1]) consecutive++;
    }
    check(
      "no two consecutive videos share a skeleton",
      consecutive === 0,
      `0 consecutive repeats across ${JOBS} jobs persisted through the store`,
    );
    check(
      "rotation spreads across the catalog",
      new Set(sequence).size === SCRIPT_STRUCTURES.length,
      `${new Set(sequence).size}/${SCRIPT_STRUCTURES.length} structures used across ${JOBS} jobs`,
    );
    console.log(`        first 8: ${sequence.slice(0, 8).join(", ")}`);

    // ── Rotation state actually landed in the store ──────────────────────────
    const persisted = await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationSchema);
    check(
      "rotation history persisted to state/script-structure-rotation.json",
      persisted !== null && persisted.recentStructureIds.length > 0,
      `${persisted?.recentStructureIds.length ?? 0} recent ids stored, newest "${persisted?.recentStructureIds[0]}"`,
    );
    check(
      "newest history entry matches the last job's structure",
      persisted?.recentStructureIds[0] === sequence[sequence.length - 1],
      `history head "${persisted?.recentStructureIds[0]}" === last pick "${sequence[sequence.length - 1]}"`,
    );

    // ── Stickiness: a script-generator retry must not re-roll the shape ──────
    const resolvedAgain = await resolveJobStructure(store, jobId(0), quiet);
    check(
      "a job's structure is sticky across retries",
      resolvedAgain === sequence[0],
      `job 0 resolved "${resolvedAgain}" again — a retry cannot silently change the video's shape`,
    );
    const recorded = await store.getJsonIfExists(store.jobKey(jobId(0), JOB_STRUCTURE_FILE), jobStructureSchema);
    check(
      "per-job structure recorded in the store",
      recorded?.structureId === sequence[0],
      `jobs/{id}/${JOB_STRUCTURE_FILE} holds "${recorded?.structureId}"`,
    );

    const historyBefore = (await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationSchema))!.recentStructureIds.join(",");
    await resolveJobStructure(store, jobId(0), quiet);
    const historyAfter = (await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationSchema))!.recentStructureIds.join(",");
    check(
      "re-resolving a job does not disturb rotation history",
      historyBefore === historyAfter,
      "sticky reads are side-effect free",
    );

    // ── Manual override from the review dashboard ────────────────────────────
    const overrideJob = jobId(0);
    const overrideStructure = sequence[0] === "deep-dive" ? "rapid-wire" : "deep-dive";
    await store.putJson(store.jobKey(overrideJob, "review-state.json"), {
      jobId: overrideJob,
      status: "changes-requested",
      voiceId: null,
      themeId: null,
      structureId: overrideStructure,
      stylePresetId: null,
      style: {},
      clipOverrides: [],
      reviewedBy: "reviewer",
      updatedAt: new Date().toISOString(),
    });
    const afterOverride = await resolveJobStructure(store, overrideJob, quiet);
    check(
      "review override beats the recorded structure",
      afterOverride === overrideStructure,
      `job resolved "${afterOverride}" from review-state.json`,
    );
    const recordedAfter = await store.getJsonIfExists(store.jobKey(overrideJob, JOB_STRUCTURE_FILE), jobStructureSchema);
    check(
      "override is written back as the job's structure",
      recordedAfter?.structureId === overrideStructure,
      `subsequent retries stay on "${recordedAfter?.structureId}"`,
    );
    const historyWithOverride = await store.getJsonIfExists(STRUCTURE_ROTATION_KEY, rotationSchema);
    check(
      "override joins rotation history",
      historyWithOverride?.recentStructureIds[0] === overrideStructure,
      `next auto-pick won't immediately repeat the hand-picked "${overrideStructure}"`,
    );

    // ── Unknown override must fail loudly ────────────────────────────────────
    await store.putJson(store.jobKey(jobId(99), "review-state.json"), { structureId: "not-a-real-structure" });
    let threw = false;
    try {
      await resolveJobStructure(store, jobId(99), quiet);
    } catch {
      threw = true;
    }
    check("unknown override rejected", threw, "a typo'd structure id fails the step instead of silently defaulting");

    // ── Theme and structure rotation must be independent ────────────────────
    // Both live under state/ and both are consulted per job; if one clobbered
    // the other's key, videos would stop varying on one axis without any error.
    const themeRotation = await store.getJsonIfExists(
      "state/theme-rotation.json",
      z.object({ recentThemeIds: z.array(z.string()) }),
    );
    check(
      "structure rotation does not touch theme rotation state",
      themeRotation === null,
      "state/theme-rotation.json untouched by 40 structure selections — the two rotations use separate keys",
    );

    console.log("");
    console.log(failures === 0 ? "ALL STRUCTURE PERSISTENCE TESTS PASSED" : `${failures} failure(s)`);
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
