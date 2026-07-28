// END-TO-END test of the metadata-generator SERVICE (not just generateMetadata):
// uploads a real script.json + segment-timing.json to an in-process S3 store,
// runs the actual runMetadataGeneration() entry point — which resolves the
// provider chain (GitHub Models dev default, per docs/LICENSING.md),
// generates LIVE, derives chapters mechanically, assembles and validates
// against YouTube's real field limits — then reads metadata.json back and
// confirms it satisfies the pipeline contract.
//
// Makes a real LLM call. Requires a working provider key in .env (GitHub
// Models). No key is ever printed.
import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";

const S3_PORT = 4579;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "66666666-7777-7777-7777-666666666666";

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const SCRIPT = {
  jobId: JOB_ID,
  title: "European Parliament Approves AI Liability Directive",
  structureId: "deep-dive",
  segments: [
    {
      id: 0,
      text: "Good evening, and welcome to the programme. Tonight, European lawmakers approve a landmark directive on artificial intelligence liability, reshaping how companies answer for harm caused by AI systems across the bloc.",
      headline: "AI Liability Directive Approved",
      visualCue: "stock footage of the European Parliament building",
      estSeconds: 15,
    },
    {
      id: 1,
      text: "The directive shifts the burden of proof in certain cases, letting claimants request technical documentation from companies operating high-risk AI systems, a change industry groups say will raise compliance costs for smaller developers.",
      headline: "Burden Of Proof Shifts",
      visualCue: "stock footage of a data centre",
      estSeconds: 40,
    },
    {
      id: 2,
      text: "Consumer advocates welcomed the vote but said the final text was weaker than the Commission's original proposal, particularly around automated decision-making in employment and credit scoring.",
      headline: "Consumer Groups React",
      visualCue: "stock footage of an office meeting",
      estSeconds: 40,
    },
    {
      id: 3,
      text: "Member states must still formally sign off, and companies will have a two-year transition period before the rules take effect. That's all for tonight — thank you for watching.",
      headline: "What Happens Next",
      visualCue: "stock footage of a calendar and clock",
      estSeconds: 15,
    },
  ],
};

const SEGMENT_TIMING = {
  jobId: JOB_ID,
  totalDurationSeconds: 110,
  segments: [
    { id: 0, startSeconds: 0, endSeconds: 15 },
    { id: 1, startSeconds: 15, endSeconds: 55 },
    { id: 2, startSeconds: 55, endSeconds: 95 },
    { id: 3, startSeconds: 95, endSeconds: 110 },
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
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-metadata-"));
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
    const { JobStore, createLogger, metadataSchema } = await import("@ai-news/shared");
    const { buildProviderChain } = await import("../services/script-generator/src/providers/registry.ts");
    const { runMetadataGeneration } = await import("../services/metadata-generator/src/index.ts");
    const { buildChapters, formatChapterBlock, MIN_CHAPTERS_TO_RENDER } = await import("../services/metadata-generator/src/chapters.ts");
    const {
      YOUTUBE_TITLE_MAX_CHARS,
      YOUTUBE_DESCRIPTION_MAX_CHARS,
      YOUTUBE_TAGS_MAX_COMBINED_CHARS,
    } = await import("../services/metadata-generator/src/validate.ts");

    const chain = buildProviderChain();
    console.log(`Provider chain (reused from script-generator): ${chain.length ? chain.map((p) => p.name).join(" -> ") : "(EMPTY)"}`);
    if (chain.length === 0) {
      console.error("No providers configured — set GITHUB_MODELS_TOKEN (or another key) in .env.");
      process.exit(1);
    }

    const store = JobStore.fromEnv();
    await store.putJson(store.jobKey(JOB_ID, "script.json"), SCRIPT);
    await store.putJson(store.jobKey(JOB_ID, "segment-timing.json"), SEGMENT_TIMING);
    console.log(`Uploaded script.json + segment-timing.json; running the real service entry point...\n`);

    const started = Date.now();
    await runMetadataGeneration(JOB_ID);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\nrunMetadataGeneration completed in ${elapsed}s\n`);

    // ── The service must have written valid metadata.json ────────────────────
    const metadata = await store.getJsonIfExists(store.jobKey(JOB_ID, "metadata.json"), metadataSchema);
    check("metadata.json written and satisfies metadataSchema", metadata !== null, metadata ? "parsed" : "MISSING or invalid");
    if (!metadata) throw new Error("no metadata.json to inspect");

    check("jobId matches", metadata.jobId === JOB_ID, metadata.jobId);
    check("title is non-empty and grounded (mentions the actual story)", metadata.title.trim().length > 0, `"${metadata.title}"`);
    check(`title respects YouTube's ${YOUTUBE_TITLE_MAX_CHARS}-char limit`, metadata.title.length <= YOUTUBE_TITLE_MAX_CHARS, `${metadata.title.length} chars`);
    check(`description respects YouTube's ${YOUTUBE_DESCRIPTION_MAX_CHARS}-char limit`, metadata.description.length <= YOUTUBE_DESCRIPTION_MAX_CHARS, `${metadata.description.length} chars`);
    check("description embeds a real chapter block", metadata.description.includes("Chapters:"), "timestamp block present");

    const combinedTagLength = metadata.tags.reduce((n, t, i) => n + t.length + (i > 0 ? 2 : 0), 0);
    check(`tags respect YouTube's REAL combined-length limit (not array count)`, combinedTagLength <= YOUTUBE_TAGS_MAX_COMBINED_CHARS, `${combinedTagLength} <= ${YOUTUBE_TAGS_MAX_COMBINED_CHARS} combined chars across ${metadata.tags.length} tags`);
    check("hashtags present and unprefixed", metadata.hashtags.length > 0 && metadata.hashtags.every((h) => !h.startsWith("#")), `${metadata.hashtags.length} hashtags, e.g. "${metadata.hashtags[0]}"`);

    // ── Chapters must exactly match the mechanically-derived ones ────────────
    // Not "close enough" — metadata-generator must not let the LLM touch this
    // field at all, so it should be byte-identical to a fresh independent computation.
    const expectedChapters = buildChapters(SCRIPT, SEGMENT_TIMING);
    check(
      "chapters are EXACTLY the mechanically-derived ones (never LLM-authored)",
      JSON.stringify(metadata.chapters) === JSON.stringify(expectedChapters),
      `${metadata.chapters.length} chapters match a fresh buildChapters() call byte-for-byte`,
    );
    check(`meets YouTube's ${MIN_CHAPTERS_TO_RENDER}-chapter minimum to actually render as chapters`, metadata.chapters.length >= MIN_CHAPTERS_TO_RENDER, `${metadata.chapters.length} chapters`);
    check("first chapter sits at 0:00", metadata.chapters[0]?.startSeconds === 0, `${metadata.chapters[0]?.startSeconds}`);
    check("the description's chapter block matches the structured chapters field", metadata.description.includes(formatChapterBlock(expectedChapters)), "no drift between metadata.chapters and the text embedded in metadata.description");

    // ── The compliance-critical flag ──────────────────────────────────────────
    check("containsSyntheticMedia is true (mandatory YouTube disclosure)", metadata.containsSyntheticMedia === true, `${metadata.containsSyntheticMedia}`);

    // ── Show the real output ─────────────────────────────────────────────────
    console.log(`\n── Generated metadata ──`);
    console.log(`  title: "${metadata.title}" (${metadata.title.length} chars)`);
    console.log(`  description (${metadata.description.length} chars):`);
    console.log(`    ${metadata.description.split("\n").join("\n    ")}`);
    console.log(`  tags (${metadata.tags.length}, ${combinedTagLength} combined chars): ${metadata.tags.join(", ")}`);
    console.log(`  hashtags: ${metadata.hashtags.map((h) => `#${h}`).join(" ")}`);
    console.log(`  chapters: ${metadata.chapters.map((c) => `${c.startSeconds}s "${c.title}"`).join(" | ")}`);

    console.log("");
    console.log(failures === 0 ? "E2E PASSED: script.json -> metadata.json via the live service." : `${failures} failure(s)`);
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
