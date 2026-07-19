// End-to-end local verification of the render-server pipeline against a real,
// in-process S3-compatible store (s3rver) standing in for Cloudflare R2 — no
// Docker and no cloud account required. It exercises the *actual* code path a
// real render job takes on the GCE VM:
//
//   upload fixtures to jobs/{jobId}/...  (JobStore.putJson / putFile)
//     -> runRender()                     (downloadJobAssets -> Remotion render -> putFile)
//       -> download render.mp4 back      (JobStore.downloadToFile) and assert it's non-empty
//
// The only things stubbed vs. production are the HTTP layer (POST /render) and
// the n8n callback; the R2 read/write path is real. Swap s3rver for real R2
// credentials in .env and this same flow runs against Cloudflare unchanged.
import { mkdtemp, copyFile, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";

const REPO = "C:\\Users\\HP\\New folder";
const S3_PORT = 4569;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "11111111-1111-1111-1111-111111111111";

// Must be set before the dynamic imports below: render-server's config.ts reads
// all of these at module-load time, so a static top-level import would hoist
// ahead of any assignment here. Point JobStore at the local s3rver and force a
// small, fast render instead of the 3840x2160 production default.
process.env.RENDER_WIDTH = "640";
process.env.RENDER_HEIGHT = "360";
process.env.RENDER_FPS = "30";
process.env.R2_ACCOUNT_ID = "smoke";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const script = {
  jobId: JOB_ID,
  title: "Smoke Test Bulletin",
  segments: [
    {
      id: 0,
      text: "This is a smoke test of the render pipeline using real schema-shaped data.",
      headline: "Render Pipeline Smoke Test",
      visualCue: "stock footage of a control room",
      estSeconds: 5,
    },
    {
      id: 1,
      text: "It exercises the full download, render, and upload path through the job store.",
      headline: "Exercising the R2 job store",
      visualCue: "stock footage of servers",
      estSeconds: 5,
    },
  ],
};

const segmentTiming = {
  jobId: JOB_ID,
  totalDurationSeconds: 10,
  segments: [
    { id: 0, startSeconds: 0, endSeconds: 5 },
    { id: 1, startSeconds: 5, endSeconds: 10 },
  ],
};

const captions = {
  jobId: JOB_ID,
  words: [
    { word: "This", start: 0.2, end: 0.5 },
    { word: "is", start: 0.5, end: 0.7 },
    { word: "a", start: 0.7, end: 0.8 },
    { word: "smoke", start: 0.8, end: 1.2 },
    { word: "test.", start: 1.2, end: 1.7 },
    { word: "Exercising", start: 5.3, end: 5.9 },
    { word: "the", start: 5.9, end: 6.1 },
    { word: "job", start: 6.1, end: 6.4 },
    { word: "store.", start: 6.4, end: 6.9 },
  ],
};

// No clips (uses the composition's fallback background); music only, so the
// download path pulls voiceover.wav + media/music.wav exactly as production does.
const mediaManifest = {
  jobId: JOB_ID,
  clips: [],
  music: { file: "music.wav", license: { source: "pixabay", licenseType: "free", url: "https://pixabay.com" } },
  sfx: [],
};

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "s3rver-data-"));
  const server = new S3rver({
    port: S3_PORT,
    address: "localhost",
    silent: true,
    directory: dataDir,
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  await server.run();
  console.log(`s3rver (R2 stand-in) listening on :${S3_PORT}, bucket "${BUCKET}"`);

  try {
    const { JobStore, createLogger } = await import("@ai-news/shared");
    const { runRender } = await import("../infra/render-server/src/render.ts");
    const store = JobStore.fromEnv();

    // --- Upload the job inputs exactly where each pipeline step would write them.
    await store.putJson(store.jobKey(JOB_ID, "script.json"), script);
    await store.putJson(store.jobKey(JOB_ID, "segment-timing.json"), segmentTiming);
    await store.putJson(store.jobKey(JOB_ID, "captions.json"), captions);
    await store.putJson(store.jobKey(JOB_ID, "media/media-manifest.json"), mediaManifest);
    await store.putFile(
      store.jobKey(JOB_ID, "voiceover.wav"),
      join(REPO, "remotion", "public", "sample", "voiceover.wav"),
      "audio/wav",
    );
    await store.putFile(
      store.jobKey(JOB_ID, "media/music.wav"),
      join(REPO, "remotion", "public", "sample", "music.wav"),
      "audio/wav",
    );
    console.log("Uploaded job inputs to jobs/%s/ in the store", JOB_ID);

    // --- Run the real render-server pipeline: download -> render -> upload.
    const result = await runRender(store, JOB_ID, createLogger("smoke-test"));
    if (result.status !== "completed" || !result.renderKey) {
      throw new Error(`runRender did not complete: ${JSON.stringify(result)}`);
    }
    console.log("runRender completed:", result);

    // --- Pull the rendered video back out of the store and confirm it's real.
    const outDir = join(REPO, "remotion", "out");
    await mkdir(outDir, { recursive: true });
    const localOut = join(outDir, "smoke-test-real-schema.mp4");
    await store.downloadToFile(result.renderKey, localOut);
    const { size } = await stat(localOut);
    if (size < 1000) {
      throw new Error(`Downloaded render is suspiciously small: ${size} bytes`);
    }
    console.log(`Downloaded ${result.renderKey} back from the store -> ${localOut} (${size} bytes)`);
    console.log("\nSMOKE TEST PASSED: full R2 upload -> render -> R2 download path verified.");
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
