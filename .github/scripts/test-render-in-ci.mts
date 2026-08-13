// Diagnostic script for .github/workflows/test-render-in-ci.yml — runs the
// full content pipeline (manual topic input, bypassing trend-research) plus
// the render step, entirely inside this one CI job, timing every stage.
//
// Storage is an in-process S3-compatible mock (s3rver) writing to the
// runner's own SSD-backed temp dir — same pattern as .smoke-test/*.mts, no
// R2/network storage needed. Each pipeline step still runs as its OWN
// process (matching production's per-job architecture, and matching the
// fix that resolved the local RAM-exhaustion stall) via child_process, not
// a shared long-lived process.
//
// FAILURE HANDLING IS LOAD-BEARING: the first version of this script let a
// thrown error propagate to main().catch() without closing the s3rver
// instance or forcing an exit — the dead Node process (with the mock S3
// server still listening) then sat alive for 5.5 hours until the workflow's
// own timeout-minutes killed it. Every exit path now explicitly closes the
// server and calls process.exit().
//
// Not part of the regular pipeline — this file exists only to answer: does a
// standard GitHub-hosted runner's SSD avoid the local-HDD render bottleneck
// (see .github/scripts/render-only-test.mts for the isolated, faster answer
// to that specific question — this script answers the fuller "does the whole
// pipeline work end-to-end in CI" question).
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import S3rver from "s3rver";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const S3_PORT = 4590;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "c1c1c1c1-0000-4000-8000-000000000001";
const STRUCTURE_ID = "timeline"; // shortest realistic structure, ~5-6min of real script

process.env.R2_ACCOUNT_ID = "ci";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";
// render-server/src/config.ts requireEnv's this at module load, but it's only
// ever checked by the HTTP layer's bearer-auth — runRender() is called
// directly here, bypassing that layer entirely, so any non-empty value works.
process.env.RENDER_SERVER_SHARED_SECRET = "ci-test-unused";

const OUT_DIR = "/tmp/ci-render-test";

const timings: Record<string, number> = {};
function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

/** Runs one pipeline step as its OWN process (tsx, source directly) — matches production's per-job isolation. */
async function runStep(label: string, scriptPath: string, extraEnv: Record<string, string> = {}): Promise<void> {
  console.log(`[${stamp()}] === ${label} starting ===`);
  const t0 = Date.now();
  const { stdout, stderr } = await execFileAsync(
    "npx",
    ["tsx", scriptPath, JOB_ID],
    { env: { ...process.env, ...extraEnv }, maxBuffer: 1024 * 1024 * 64 },
  );
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  const seconds = (Date.now() - t0) / 1000;
  timings[label] = seconds;
  console.log(`[${stamp()}] === ${label} done in ${seconds.toFixed(1)}s ===`);
}

async function main() {
  const overallStart = Date.now();
  await mkdir(OUT_DIR, { recursive: true });
  const dataDir = await mkdtemp(join(tmpdir(), "ci-render-s3-"));
  const server = new S3rver({ port: S3_PORT, address: "localhost", silent: true, directory: dataDir, configureBuckets: [{ name: BUCKET, configs: [] }] });

  try {
    await server.run();
    console.log(`[${stamp()}] S3 mock on :${S3_PORT}, data dir ${dataDir} (runner SSD)`);

    const { JobStore, trendSchema, jobManifestSchema, reviewStateSchema } = await import("@ai-news/shared");
    const store = JobStore.fromEnv();
    const now = () => new Date().toISOString();

    await store.putJson(store.jobKey(JOB_ID, "job.json"), {
      jobId: JOB_ID, mode: "manual", status: "running", currentStep: "script-generator",
      niche: "news-europe", createdAt: now(), updatedAt: now(),
    });

    const trend = trendSchema.parse({
      jobId: JOB_ID,
      topic: "How the EU's Erasmus+ Program Works",
      angle: "A look at how Erasmus+ lets students study abroad, how the program is funded, and why it remains one of the EU's most popular initiatives.",
      sourceUrls: ["https://erasmus-plus.ec.europa.eu/", "https://europa.eu/youth/erasmusplus_en"],
      sourceSummaries: [
        "The Erasmus programme began in 1987 and was rebranded Erasmus+ in 2014, letting university students across EU member states study or train in another member state for part of their degree, with credits recognized by their home institution.",
        "Since it began, the Erasmus+ programme and its predecessor have supported more than 10 million participants, including students, apprentices, teachers, and youth workers across educational exchanges.",
        "The European Union's Erasmus+ budget for the 2021-2027 period is more than 26 billion euros, roughly double the funding of the previous seven-year programme.",
        "Participants can receive a monthly grant to help cover the additional cost of living abroad, with the amount varying depending on the destination country's cost of living.",
      ],
    });
    await store.putJson(store.jobKey(JOB_ID, "trend.json"), trend);

    await store.putJson(
      store.jobKey(JOB_ID, "review-state.json"),
      reviewStateSchema.parse({ jobId: JOB_ID, status: "awaiting-review", structureId: STRUCTURE_ID, updatedAt: now() }),
    );

    const setStep = async (step: string) => {
      const manifest = await store.getJson(store.jobKey(JOB_ID, "job.json"), jobManifestSchema);
      await store.putJson(store.jobKey(JOB_ID, "job.json"), { ...manifest, currentStep: step, updatedAt: now() });
    };

    await runStep("script-generator", join(REPO, "services/script-generator/src/index.ts"));
    await setStep("voiceover");
    await runStep("voiceover", join(REPO, "services/voiceover/src/index.ts"));
    await setStep("caption-sync");
    await runStep("caption-sync", join(REPO, "services/caption-sync/src/index.ts"), { WHISPER_MODEL: "Xenova/whisper-base.en" });
    await setStep("media-sourcing");
    await runStep("media-sourcing", join(REPO, "services/media-sourcing/src/index.ts"));
    await setStep("render");
    await runStep("render", join(REPO, ".github/scripts/render-step.mts"));

    const totalSeconds = (Date.now() - overallStart) / 1000;
    timings["TOTAL"] = totalSeconds;
    console.log(`\n[${stamp()}] PIPELINE + RENDER COMPLETE in ${totalSeconds.toFixed(1)}s (${(totalSeconds / 60).toFixed(1)} min)`);
    console.log("Timings:", JSON.stringify(timings, null, 2));

    await copyFile(join(dataDir, BUCKET, "jobs", JOB_ID, "render.mp4"), join(OUT_DIR, "render.mp4"));
    await writeFile(join(OUT_DIR, "timings.json"), JSON.stringify(timings, null, 2));
    await server.close();
    process.exit(0);
  } catch (err) {
    console.error("CI RENDER TEST FAILED:", err);
    timings["FAILED_AFTER_SECONDS"] = (Date.now() - overallStart) / 1000;
    try {
      await writeFile(join(OUT_DIR, "timings.json"), JSON.stringify(timings, null, 2));
    } catch {
      // best-effort — don't let a write failure mask the real error or block the exit below
    }
    await server.close();
    process.exit(1);
  }
}

main();
