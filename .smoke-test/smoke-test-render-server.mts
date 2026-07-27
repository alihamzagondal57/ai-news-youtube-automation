// End-to-end local verification of the render-server pipeline against a real,
// in-process S3-compatible store (s3rver) standing in for Cloudflare R2 — no
// Docker and no cloud account required. It exercises the *actual* code path a
// real render job takes on the GCE VM:
//
//   upload fixtures to jobs/{jobId}/...  (JobStore.putJson / putFile)
//     -> runRender()                     (readJobManifests -> buildInputProps -> downloadReferencedMedia -> Remotion render -> putFile)
//       -> download render.mp4 back      (JobStore.downloadToFile) and assert it's non-empty
//
// The only things stubbed vs. production are the HTTP layer (POST /render) and
// the n8n callback; the R2 read/write path is real. Swap s3rver for real R2
// credentials in .env and this same flow runs against Cloudflare unchanged.
import { mkdtemp, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { z } from "zod";
import { generateColorClip, probeVideo } from "./lib/media.mts";

function assert(condition: boolean, description: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${description}`);
  console.log(`  ok  ${description}`);
}

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

const license = { source: "pixabay", licenseType: "free", url: "https://pixabay.com" } as const;

/**
 * Distinct per-segment clips so a swap is actually visible in the output.
 * Each generated clip is 7s (see generateColorClip below) against a 5s
 * segment, so this fixture exercises mediaTimeline.ts's Case 1 (trim a clip
 * longer than its segment) on every render this test does.
 */
function manifestWithClips(segment1Clip: string) {
  return {
    jobId: JOB_ID,
    clips: [
      { segmentId: 0, file: "clip-red.mp4", license, durationSeconds: 7, alternatives: [] },
      { segmentId: 1, file: segment1Clip, license, durationSeconds: 7, alternatives: [] },
    ],
    music: { file: "music.wav", license },
    sfx: [],
  };
}

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
    await store.putJson(store.jobKey(JOB_ID, "media/media-manifest.json"), manifestWithClips("clip-green.mp4"));
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

    // Stock clips stand in for what media-sourcing would have fetched.
    const clipDir = await mkdtemp(join(tmpdir(), "smoke-clips-"));
    for (const color of ["red", "green", "blue"]) {
      const local = join(clipDir, `clip-${color}.mp4`);
      await generateColorClip(color, 7, 30, 640, 360, local);
      await store.putFile(store.jobKey(JOB_ID, `media/clip-${color}.mp4`), local, "video/mp4");
    }
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

    // --- The per-segment render cache must have been persisted to the store.
    const cacheKeys = await store.listKeys(store.jobKey(JOB_ID, "renders/"));
    const cacheNames = cacheKeys.map((k) => k.split("/").pop()).sort();
    console.log("Render cache in store:", cacheNames.join(", "));
    assert(cacheKeys.length > 0, "cold render persisted a per-segment chunk cache to the store");
    assert(cacheNames.includes("audio.wav"), "continuous audio track cached for reuse");

    const coldProbe = await probeVideo(localOut);

    // Auto-rotation should have picked and recorded a theme for this job.
    const themeAfterCold = await store.getJsonIfExists(
      store.jobKey(JOB_ID, "theme.json"),
      z.object({ themeId: z.string() }),
    );
    assert(themeAfterCold !== null, `auto-rotation recorded a theme for the job ("${themeAfterCold?.themeId}")`);

    // --- Targeted re-render: swap segment 1's clip, rebuild only what's dirty.
    console.log("\nTargeted re-render: swapping segment 1's clip (green -> blue)");
    await store.putJson(store.jobKey(JOB_ID, "media/media-manifest.json"), manifestWithClips("clip-blue.mp4"));

    const targeted = await runRender(store, JOB_ID, createLogger("smoke-test"), { changedSegmentIds: [1] });
    if (targeted.status !== "completed" || !targeted.renderKey) {
      throw new Error(`Targeted runRender did not complete: ${JSON.stringify(targeted)}`);
    }

    const targetedOut = join(outDir, "smoke-test-targeted-rerender.mp4");
    await store.downloadToFile(targeted.renderKey, targetedOut);
    const targetedProbe = await probeVideo(targetedOut);

    assert(
      targetedProbe.frameCount === coldProbe.frameCount,
      `targeted re-render preserved frame count (${targetedProbe.frameCount} frames)`,
    );
    assert(
      targetedProbe.audioDurationSeconds !== null &&
        Math.abs(targetedProbe.audioDurationSeconds - targetedProbe.videoDurationSeconds) < 0.05,
      `audio still in sync (audio ${targetedProbe.audioDurationSeconds}s vs video ${targetedProbe.videoDurationSeconds}s)`,
    );

    // The theme must NOT have been re-rolled by the second render: a new theme
    // would re-skin the whole video while three chunks were reused from cache,
    // producing a video whose cached segments no longer match the new look.
    const themeAfterTargeted = await store.getJsonIfExists(
      store.jobKey(JOB_ID, "theme.json"),
      z.object({ themeId: z.string() }),
    );
    assert(
      themeAfterTargeted?.themeId === themeAfterCold?.themeId,
      `theme stayed "${themeAfterTargeted?.themeId}" across the targeted re-render — cached chunks remain valid`,
    );

    await rm(clipDir, { recursive: true, force: true });
    console.log(
      "\nSMOKE TEST PASSED: R2 upload -> render -> download, plus a cache-backed targeted re-render, all verified.",
    );
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
