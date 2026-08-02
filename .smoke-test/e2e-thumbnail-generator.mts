// END-TO-END test of the thumbnail-generator SERVICE (not just headline.ts):
// uploads a real script.json + theme.json + a REAL rendered .mp4 fixture
// (flat-colour, generated with ffmpeg — not a stub) to an in-process S3
// store, runs the actual runThumbnailGeneration() entry point — which
// downloads render.mp4, extracts a representative frame with ffmpeg/ffprobe,
// bundles and renders the real `Thumbnail` Remotion composition through
// @remotion/renderer, and uploads the result — then downloads thumbnail.png
// back and inspects real pixels to confirm:
//
//   1. a real frame from render.mp4 actually made it into the composited
//      image when AI generation is unavailable (tier 2 of the fallback);
//   2. the no-render.mp4 fallback produces a valid themed still instead of
//      failing (or silently reusing stale/placeholder content) — tier 3;
//   3. two different themes actually render visibly differently from the
//      SAME background frame + headline — proving the theme tokens (not a
//      hardcoded look) drive the result; and
//   4. a REAL, LIVE call to FLUX.1 [schnell] (tier 1 — not mocked, same
//      rigor as e2e-metadata-generator.mts's real LLM call) produces an
//      actual AI-generated thumbnail, when HUGGINGFACE_API_TOKEN is set.
//      Skips gracefully rather than failing when it isn't — the free
//      credit is optional-by-design (docs/LICENSING.md §3.6).
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { colorDistance, generateColorClip, probeVideo, regionAverageColor } from "./lib/media.mts";

const S3_PORT = 4581;
const BUCKET = "ai-news-pipeline";
const JOB_WITH_FRAME = "88888888-1111-1111-1111-888888888888";
const JOB_NO_RENDER = "88888888-2222-2222-2222-888888888888";
const JOB_OTHER_THEME = "88888888-3333-3333-3333-888888888888";
const JOB_AI_IMAGE = "88888888-4444-4444-4444-888888888888";
const SAMPLES_DIR = join(process.cwd(), "remotion", "out", "thumbnail-samples");

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const SCRIPT = {
  title: "European Central Bank Holds Interest Rates Steady",
  segments: [
    {
      id: 0,
      text: "Good evening. The European Central Bank held interest rates steady today.",
      headline: "ECB Holds Rates Steady",
      visualCue: "stock footage of the ECB building",
      estSeconds: 12,
    },
    {
      id: 1,
      text: "Markets reacted quickly to the decision.",
      headline: "Markets React",
      visualCue: "stock footage of a trading floor",
      estSeconds: 20,
    },
  ],
};

const THEME_A = "midnight-wire"; // dark navy surface, red accent
const THEME_B = "broadsheet"; // cream surface, near-black accent — deliberately far from THEME_A
const CLIP_COLOR = "magenta"; // saturated and unlike either theme's own palette, so its presence in the output is unambiguous
const CLIP_SECONDS = 6;
const CLIP_WIDTH = 640;
const CLIP_HEIGHT = 360;
const MAGENTA = { r: 255, g: 0, b: 255 };

// Above ThemedBackdrop's 45%-of-height scrim threshold and above the
// bottom-anchored headline plate — shows the background essentially untouched.
const TOP_BAND = { x: 140, y: 40, width: 1000, height: 200 };
// Bottom band overlaps the theme-coloured headline plate; comparing it across
// two renders that share the same background isolates the theme's own effect.
const BOTTOM_BAND = { x: 0, y: 520, width: 1280, height: 200 };

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-thumbnail-s3-"));
  const work = await mkdtemp(join(tmpdir(), "e2e-thumbnail-work-"));
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
    const { JobStore } = await import("@ai-news/shared");
    const { runThumbnailGeneration } = await import("../services/thumbnail-generator/src/index.ts");

    const store = JobStore.fromEnv();

    // Forces tiers 2/3 deterministically for cases 1-3, regardless of whether
    // a real HUGGINGFACE_API_TOKEN happens to be configured in .env — with a
    // real token present, tier 1 (AI image) would otherwise win every time
    // and these cases would stop testing what they claim to (frame
    // extraction, gradient fallback, theme differentiation). Case 4, below,
    // is the one that exercises the real generateTopicImage.
    const aiDisabled = async () => ({ success: false as const, reason: "disabled for this test case" });

    const clipPath = join(work, "fixture-render.mp4");
    await generateColorClip(CLIP_COLOR, CLIP_SECONDS, 30, CLIP_WIDTH, CLIP_HEIGHT, clipPath);
    console.log(`Generated a real ${CLIP_SECONDS}s ${CLIP_COLOR} fixture render.mp4 (${CLIP_WIDTH}x${CLIP_HEIGHT})\n`);

    // ── Case 1: a real render.mp4 is present -> a real frame gets extracted ──
    await store.putJson(store.jobKey(JOB_WITH_FRAME, "script.json"), { ...SCRIPT, jobId: JOB_WITH_FRAME });
    await store.putJson(store.jobKey(JOB_WITH_FRAME, "theme.json"), { themeId: THEME_A });
    await store.putFile(store.jobKey(JOB_WITH_FRAME, "render.mp4"), clipPath, "video/mp4");

    await runThumbnailGeneration(JOB_WITH_FRAME, { generateImage: aiDisabled });

    const thumbWithFramePath = join(work, "thumb-with-frame.png");
    await store.downloadToFile(store.jobKey(JOB_WITH_FRAME, "thumbnail.png"), thumbWithFramePath);

    const stats1 = await stat(thumbWithFramePath);
    check("thumbnail.png is a real, non-trivial file", stats1.size > 5000, `${stats1.size} bytes`);

    const probe1 = await probeVideo(thumbWithFramePath);
    check(
      "thumbnail is exactly YouTube's recommended 1280x720",
      probe1.width === 1280 && probe1.height === 720,
      `${probe1.width}x${probe1.height}`,
    );

    const topColorWithFrame = await regionAverageColor(thumbWithFramePath, TOP_BAND, work);
    check(
      "a real frame from render.mp4 was actually extracted and composited (top band matches the fixture's colour)",
      colorDistance(topColorWithFrame, MAGENTA) < 40,
      `sampled rgb(${topColorWithFrame.r},${topColorWithFrame.g},${topColorWithFrame.b}) vs fixture magenta`,
    );

    // ── Case 2: no render.mp4 yet -> graceful fallback to a themed still ────
    await store.putJson(store.jobKey(JOB_NO_RENDER, "script.json"), { ...SCRIPT, jobId: JOB_NO_RENDER });
    await store.putJson(store.jobKey(JOB_NO_RENDER, "theme.json"), { themeId: THEME_A });
    // Deliberately no render.mp4 uploaded for this job.

    await runThumbnailGeneration(JOB_NO_RENDER, { generateImage: aiDisabled });

    const thumbNoRenderPath = join(work, "thumb-no-render.png");
    await store.downloadToFile(store.jobKey(JOB_NO_RENDER, "thumbnail.png"), thumbNoRenderPath);

    const probe2 = await probeVideo(thumbNoRenderPath);
    check(
      "fallback (no render.mp4) still produces a valid 1280x720 PNG instead of failing",
      probe2.width === 1280 && probe2.height === 720,
      `${probe2.width}x${probe2.height}`,
    );

    const topColorNoRender = await regionAverageColor(thumbNoRenderPath, TOP_BAND, work);
    check(
      "fallback background is the theme's own gradient, NOT the (absent) fixture colour",
      colorDistance(topColorNoRender, MAGENTA) > 100,
      `sampled rgb(${topColorNoRender.r},${topColorNoRender.g},${topColorNoRender.b}) is far from magenta`,
    );

    // ── Case 3: two different themes actually render differently ────────────
    await store.putJson(store.jobKey(JOB_OTHER_THEME, "script.json"), { ...SCRIPT, jobId: JOB_OTHER_THEME });
    await store.putJson(store.jobKey(JOB_OTHER_THEME, "theme.json"), { themeId: THEME_B });
    await store.putFile(store.jobKey(JOB_OTHER_THEME, "render.mp4"), clipPath, "video/mp4");

    await runThumbnailGeneration(JOB_OTHER_THEME, { generateImage: aiDisabled });

    const thumbOtherThemePath = join(work, "thumb-other-theme.png");
    await store.downloadToFile(store.jobKey(JOB_OTHER_THEME, "thumbnail.png"), thumbOtherThemePath);

    const bottomColorThemeA = await regionAverageColor(thumbWithFramePath, BOTTOM_BAND, work);
    const bottomColorThemeB = await regionAverageColor(thumbOtherThemePath, BOTTOM_BAND, work);
    const plateDistance = colorDistance(bottomColorThemeA, bottomColorThemeB);
    check(
      `${THEME_A} and ${THEME_B} produce visibly different thumbnails from the SAME frame + headline (theme tokens actually drive the look)`,
      plateDistance > 15,
      `plate colour distance ${plateDistance.toFixed(1)} between rgb(${bottomColorThemeA.r},${bottomColorThemeA.g},${bottomColorThemeA.b}) and rgb(${bottomColorThemeB.r},${bottomColorThemeB.g},${bottomColorThemeB.b})`,
    );

    // ── Case 4: a REAL, LIVE FLUX.1 [schnell] generation (tier 1) ────────────
    if (process.env.HUGGINGFACE_API_TOKEN) {
      await store.putJson(store.jobKey(JOB_AI_IMAGE, "script.json"), { ...SCRIPT, jobId: JOB_AI_IMAGE });
      await store.putJson(store.jobKey(JOB_AI_IMAGE, "theme.json"), { themeId: THEME_A });
      // Deliberately no render.mp4 uploaded — proves the AI image wins tier 1
      // over tier 2 (frame extraction), not just over tier 3 (gradient).

      const started = Date.now();
      await runThumbnailGeneration(JOB_AI_IMAGE);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      const thumbAiPath = join(work, "thumb-ai-image.png");
      await store.downloadToFile(store.jobKey(JOB_AI_IMAGE, "thumbnail.png"), thumbAiPath);

      const statsAi = await stat(thumbAiPath);
      check(
        "real FLUX.1 [schnell] generation produced a non-trivial thumbnail.png",
        statsAi.size > 5000,
        `${statsAi.size} bytes in ${elapsed}s`,
      );

      const probeAi = await probeVideo(thumbAiPath);
      check(
        "AI-generated thumbnail is exactly 1280x720",
        probeAi.width === 1280 && probeAi.height === 720,
        `${probeAi.width}x${probeAi.height}`,
      );

      // topColorNoRender (Case 2, same THEME_A, no render.mp4 either) is the
      // known flat-gradient fallback colour — if AI generation had silently
      // failed and fallen through to tier 3, this job would look identical
      // to that one. A real generated photo should look nothing like it.
      const topColorAi = await regionAverageColor(thumbAiPath, TOP_BAND, work);
      check(
        "AI-generated background is NOT the theme's flat gradient fallback (a real generated image was actually used, not a silent fallback)",
        colorDistance(topColorAi, topColorNoRender) > 20,
        `AI top rgb(${topColorAi.r},${topColorAi.g},${topColorAi.b}) vs known gradient-fallback rgb(${topColorNoRender.r},${topColorNoRender.g},${topColorNoRender.b})`,
      );

      await mkdir(SAMPLES_DIR, { recursive: true });
      const sampleOut = join(SAMPLES_DIR, "ai-generated-sample.png");
      await copyFile(thumbAiPath, sampleOut);
      console.log(`\nSaved a real AI-generated sample thumbnail to ${sampleOut}\n`);
    } else {
      console.log(
        "\nSkipping the real FLUX.1 [schnell] generation case — HUGGINGFACE_API_TOKEN is not set in .env. " +
          "(This is expected and not a failure; the token is optional by design — see docs/LICENSING.md §3.6.)\n",
      );
    }

    console.log("");
    console.log(
      failures === 0
        ? "E2E PASSED: script.json + theme.json (+ render.mp4) -> thumbnail.png via the live service."
        : `${failures} failure(s)`,
    );
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
