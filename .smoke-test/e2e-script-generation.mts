// END-TO-END test of the script-generator SERVICE (not just generateScript):
// uploads a real trend.json to an in-process S3 store, runs the actual
// runScriptGeneration() entry point — which reads trend.json, resolves the
// script structure (rotation), generates LIVE through the configured provider
// chain (GitHub Models primary), validates, and writes script.json — then reads
// script.json back and confirms it satisfies the pipeline contract.
//
// Makes real LLM calls. Requires a working provider key in .env (GitHub Models).
// No key is ever printed.
import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";

const S3_PORT = 4573;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "66666666-6666-6666-6666-666666666666";

// R2 -> s3rver. Set before importing anything that reads config at load time.
process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const TREND = {
  jobId: JOB_ID,
  topic: "European Parliament approves landmark AI liability directive",
  angle: "What the new liability rules mean for companies deploying AI, and where critics say they fall short",
  sourceUrls: [
    "https://example.com/eu-ai-liability-vote",
    "https://example.com/ai-liability-industry-reaction",
  ],
  sourceSummaries: [
    "The European Parliament voted to approve a directive establishing liability rules for harm caused by artificial intelligence systems, passing by a wide margin on Tuesday.",
    "The directive shifts the burden of proof in some cases, allowing claimants to request disclosure of technical information from companies operating high-risk AI systems.",
    "Industry groups warned the rules could raise compliance costs for smaller developers, while consumer advocates said the final text was weaker than the original proposal.",
    "The directive still needs formal sign-off from member states and gives companies a two-year transition period before the rules take effect.",
    "The Commission said the framework complements the AI Act by giving people harmed by AI a clearer route to compensation.",
  ],
};

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-script-"));
  const server = new S3rver({
    port: S3_PORT,
    address: "localhost",
    silent: true,
    directory: dataDir,
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  await server.run();
  console.log(`s3rver (R2 stand-in) on :${S3_PORT}\n`);

  try {
    const { JobStore, createLogger, scriptSchema } = await import("@ai-news/shared");
    const { getStructure } = await import("../services/shared/src/script-structure/index.ts");
    const { buildProviderChain } = await import("../services/script-generator/src/providers/registry.ts");
    const { runScriptGeneration } = await import("../services/script-generator/src/index.ts");

    const chain = buildProviderChain();
    console.log(`Provider chain: ${chain.length ? chain.map((p) => p.name).join(" -> ") : "(EMPTY)"}`);
    if (chain.length === 0) {
      console.error("No providers configured — set GITHUB_MODELS_TOKEN (or another key) in .env.");
      process.exit(1);
    }

    const store = JobStore.fromEnv();
    // The one upstream artifact this service consumes.
    await store.putJson(store.jobKey(JOB_ID, "trend.json"), TREND);
    console.log(`Uploaded trend.json; running the real service entry point...\n`);

    const started = Date.now();
    await runScriptGeneration(JOB_ID);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\nrunScriptGeneration completed in ${elapsed}s\n`);

    // ── The service must have written a valid script.json ────────────────────
    const rawScript = await store.getJsonIfExists(store.jobKey(JOB_ID, "script.json"), scriptSchema);
    check("script.json written and satisfies scriptSchema", rawScript !== null, rawScript ? "parsed" : "MISSING or invalid");
    if (!rawScript) throw new Error("no script.json to inspect");

    check("title present", rawScript.title.trim().length > 0, `"${rawScript.title}"`);
    check("structureId recorded", typeof rawScript.structureId === "string" && rawScript.structureId.length > 0, `"${rawScript.structureId}"`);

    const structure = getStructure(rawScript.structureId!);
    const bodyCount = rawScript.segments.length - 2; // minus opening + outro
    check(
      "body segment count matches the resolved structure",
      bodyCount >= structure.segments.minSegments && bodyCount <= structure.segments.maxSegments,
      `${bodyCount} body segments (structure "${structure.id}" allows ${structure.segments.minSegments}-${structure.segments.maxSegments})`,
    );

    // Body segments (drop opening[0] and outro[last]) must hit the band and carry insight.
    const body = rawScript.segments.slice(1, -1);
    const bodyWords = body.map((s) => (s.text.match(/\S+/g) ?? []).length);
    check(
      "every body segment is inside the word band",
      bodyWords.every((w) => w >= structure.segments.minWordsPerSegment && w <= structure.segments.maxWordsPerSegment),
      `word counts ${bodyWords.join(", ")} (band ${structure.segments.minWordsPerSegment}-${structure.segments.maxWordsPerSegment})`,
    );
    check(
      "every body segment carries a headline and visualCue",
      body.every((s) => s.headline.trim() && s.visualCue.trim()),
      "media-sourcing + lower-third inputs present",
    );
    check(
      "every body segment carries an insight",
      body.every((s) => typeof (s as { insight?: string }).insight === "string" && (s as { insight?: string }).insight!.trim().length > 0),
      "the original-insight field survived into script.json",
    );

    // ── The structure choice was recorded (sticky-per-job + rotation history) ──
    const jobStructure = await store.getJsonIfExists(
      store.jobKey(JOB_ID, "script-structure.json"),
      (await import("zod")).z.object({ structureId: (await import("zod")).z.string() }),
    );
    check(
      "per-job structure recorded for stickiness",
      jobStructure?.structureId === rawScript.structureId,
      `script-structure.json holds "${jobStructure?.structureId}"`,
    );

    // ── Show the real output ─────────────────────────────────────────────────
    const totalWords = rawScript.segments.reduce((n, s) => n + (s.text.match(/\S+/g) ?? []).length, 0);
    console.log(`\n── Generated script ──`);
    console.log(`  structure: ${rawScript.structureId} · ${rawScript.segments.length} segments · ~${totalWords} words (~${(totalWords / 150).toFixed(1)} min)`);
    console.log(`  title: "${rawScript.title}"`);
    const sampleBody = body[0];
    if (sampleBody) {
      console.log(`\n  First body segment (${(sampleBody.text.match(/\S+/g) ?? []).length} words):`);
      console.log(`    "${sampleBody.text.slice(0, 320)}..."`);
      const insight = (sampleBody as { insight?: string }).insight;
      if (insight) console.log(`    declared insight: "${insight}"`);
    }

    console.log("");
    console.log(failures === 0 ? "E2E PASSED: trend.json -> script.json via the live service." : `${failures} failure(s)`);
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
