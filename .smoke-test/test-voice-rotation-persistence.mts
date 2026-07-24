// Verifies narrator-voice rotation persists across jobs through the store, so
// consecutive videos are spoken in a different anchor voice — and that a job's
// voice is STICKY, which matters even more than structure: a voice change
// re-times the whole video, so a voiceover retry that re-rolled the voice would
// desync the captions/media/render already built against the first take.
//
// Runs against s3rver (in-process S3) — no audio synthesis, so it finishes in
// seconds. Mirrors test-script-structure-persistence.mts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { z } from "zod";

const S3_PORT = 4575;
const BUCKET = "ai-news-pipeline";

process.env.R2_ACCOUNT_ID = "voice";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const rotationSchema = z.object({ recentVoiceIds: z.array(z.string()) });
const jobVoiceSchema = z.object({ voiceId: z.string() });

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

const jobId = (n: number) => `${String(n).padStart(8, "0")}-3333-3333-3333-333333333333`;

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "voice-s3-"));
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
    const { VOICE_ROTATION_POOL, VOICE_AVOID_WINDOW } = await import("../services/voiceover/src/voices.ts");
    const { resolveJobVoice, VOICE_ROTATION_KEY, JOB_VOICE_FILE } = await import(
      "../services/voiceover/src/voiceSelection.ts"
    );
    const store = JobStore.fromEnv();
    const logger = createLogger("voice-test");
    // Quiet: the resolver logs a line per job and we run many.
    const quiet = { ...logger, info: () => {}, child: () => quiet } as unknown as typeof logger;

    // ── 40 sequential jobs, as if 40 videos were narrated ────────────────────
    const JOBS = 40;
    const sequence: string[] = [];
    for (let i = 0; i < JOBS; i++) {
      sequence.push(await resolveJobVoice(store, jobId(i), quiet));
    }

    let consecutive = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1]) consecutive++;
    }
    check(
      "no two consecutive videos share a voice",
      consecutive === 0,
      `0 consecutive repeats across ${JOBS} jobs persisted through the store`,
    );
    // Stronger: nothing repeats inside the avoid window (a 3-video sliding window).
    let windowRepeat = 0;
    for (let i = 0; i < sequence.length; i++) {
      for (let j = Math.max(0, i - VOICE_AVOID_WINDOW); j < i; j++) {
        if (sequence[i] === sequence[j]) windowRepeat++;
      }
    }
    check(
      "no voice repeats within the avoid window",
      windowRepeat === 0,
      `window ${VOICE_AVOID_WINDOW}: accent+gender both move every video`,
    );
    check(
      "rotation spreads across the whole pool",
      new Set(sequence).size === VOICE_ROTATION_POOL.length,
      `${new Set(sequence).size}/${VOICE_ROTATION_POOL.length} voices used across ${JOBS} jobs`,
    );
    console.log(`        first 8: ${sequence.slice(0, 8).join(", ")}`);

    // ── Rotation state actually landed in the store ──────────────────────────
    const persisted = await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema);
    check(
      "rotation history persisted to state/voice-rotation.json",
      persisted !== null && persisted.recentVoiceIds.length > 0,
      `${persisted?.recentVoiceIds.length ?? 0} recent ids stored, newest "${persisted?.recentVoiceIds[0]}"`,
    );
    check(
      "newest history entry matches the last job's voice",
      persisted?.recentVoiceIds[0] === sequence[sequence.length - 1],
      `history head "${persisted?.recentVoiceIds[0]}" === last pick "${sequence[sequence.length - 1]}"`,
    );

    // ── Stickiness: a voiceover retry must not re-roll the voice ─────────────
    const resolvedAgain = await resolveJobVoice(store, jobId(0), quiet);
    check(
      "a job's voice is sticky across retries",
      resolvedAgain === sequence[0],
      `job 0 resolved "${resolvedAgain}" again — a retry cannot re-time the video into a different voice`,
    );
    const recorded = await store.getJsonIfExists(store.jobKey(jobId(0), JOB_VOICE_FILE), jobVoiceSchema);
    check(
      "per-job voice recorded in the store",
      recorded?.voiceId === sequence[0],
      `jobs/{id}/${JOB_VOICE_FILE} holds "${recorded?.voiceId}"`,
    );

    const historyBefore = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema))!.recentVoiceIds.join(",");
    await resolveJobVoice(store, jobId(0), quiet);
    const historyAfter = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema))!.recentVoiceIds.join(",");
    check(
      "re-resolving a job does not disturb rotation history",
      historyBefore === historyAfter,
      "sticky reads are side-effect free",
    );

    // ── Manual override from the review dashboard ────────────────────────────
    const overrideJob = jobId(0);
    const overrideVoice = sequence[0] === "kokoro-af-heart" ? "kokoro-bm-george" : "kokoro-af-heart";
    await store.putJson(store.jobKey(overrideJob, "review-state.json"), {
      jobId: overrideJob,
      status: "changes-requested",
      voiceId: overrideVoice,
      themeId: null,
      structureId: null,
      stylePresetId: null,
      style: {},
      clipOverrides: [],
      reviewedBy: "reviewer",
      updatedAt: new Date().toISOString(),
    });
    const afterOverride = await resolveJobVoice(store, overrideJob, quiet);
    check(
      "review override beats the recorded voice",
      afterOverride === overrideVoice,
      `job resolved "${afterOverride}" from review-state.json`,
    );
    const recordedAfter = await store.getJsonIfExists(store.jobKey(overrideJob, JOB_VOICE_FILE), jobVoiceSchema);
    check(
      "override is written back as the job's voice",
      recordedAfter?.voiceId === overrideVoice,
      `subsequent retries stay on "${recordedAfter?.voiceId}"`,
    );
    const historyWithOverride = await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema);
    check(
      "in-pool override joins rotation history",
      historyWithOverride?.recentVoiceIds[0] === overrideVoice,
      `next auto-pick won't immediately repeat the hand-picked "${overrideVoice}"`,
    );

    // ── An out-of-pool override (a library voice outside the rotation pool,
    //    e.g. a lower-graded Kokoro voice) is honored but does NOT enter the
    //    rotation history ───────────────────────────────────────────────────────
    const outOfPoolVoice = "kokoro-bm-fable"; // in the library, not in VOICE_ROTATION_POOL
    const nonPoolJob = jobId(50);
    await store.putJson(store.jobKey(nonPoolJob, "review-state.json"), { voiceId: outOfPoolVoice });
    const historyBeforeNonPool = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema))!.recentVoiceIds.join(",");
    const nonPoolResolved = await resolveJobVoice(store, nonPoolJob, quiet);
    const historyAfterNonPool = (await store.getJsonIfExists(VOICE_ROTATION_KEY, rotationSchema))!.recentVoiceIds.join(",");
    check(
      "out-of-pool override is honored",
      nonPoolResolved === outOfPoolVoice && !VOICE_ROTATION_POOL.includes(outOfPoolVoice),
      `operator can hand-pick a non-pool library voice ("${nonPoolResolved}")`,
    );
    check(
      "out-of-pool override does not pollute the rotation pool history",
      historyBeforeNonPool === historyAfterNonPool,
      "state/voice-rotation.json still holds only pool voices",
    );

    // ── Unknown override must fail loudly ────────────────────────────────────
    await store.putJson(store.jobKey(jobId(99), "review-state.json"), { voiceId: "not-a-real-voice" });
    let threw = false;
    try {
      await resolveJobVoice(store, jobId(99), quiet);
    } catch {
      threw = true;
    }
    check("unknown override rejected", threw, "a typo'd voice id fails the step instead of silently defaulting");

    // ── Voice rotation is independent of the other two rotations ─────────────
    // All three live under state/ and are consulted per job; if one clobbered
    // another's key, videos would stop varying on an axis with no error.
    const structureRotation = await store.getJsonIfExists(
      "state/script-structure-rotation.json",
      z.object({ recentStructureIds: z.array(z.string()) }),
    );
    const themeRotation = await store.getJsonIfExists(
      "state/theme-rotation.json",
      z.object({ recentThemeIds: z.array(z.string()) }),
    );
    check(
      "voice rotation does not touch structure or theme rotation state",
      structureRotation === null && themeRotation === null,
      "the three rotations use separate state/ keys and never collide",
    );

    console.log("");
    console.log(failures === 0 ? "ALL VOICE ROTATION PERSISTENCE TESTS PASSED" : `${failures} failure(s)`);
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
