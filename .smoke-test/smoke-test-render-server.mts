// One-off local verification: exercises render-server's own buildInputProps()
// + bundle()/selectComposition()/renderMedia() path using data shaped like a
// real script.json/segment-timing.json/captions.json/media-manifest.json,
// instead of Remotion's own internal sample-job fixture. Skips R2
// download/upload (no bucket configured yet) — everything else is real.
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { JobAssets } from "../infra/render-server/src/jobAssets.ts";

const REPO = "C:\\Users\\HP\\New folder";

// Set before importing config.ts (transitively, via buildInputProps.ts): config
// reads these at module-load time, so a static top-level import would hoist
// ahead of any assignment here and always see the real .env defaults (3840x2160).
process.env.RENDER_WIDTH = "640";
process.env.RENDER_HEIGHT = "360";
process.env.RENDER_FPS = "30";

async function main() {
  const { buildInputProps } = await import("../infra/render-server/src/buildInputProps.ts");
  const dir = await mkdtemp(join(tmpdir(), "render-smoke-"));
  await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(dir, "voiceover.wav"));
  await copyFile(join(REPO, "remotion", "public", "sample", "music.wav"), join(dir, "music.wav"));

  const jobId = "11111111-1111-1111-1111-111111111111";

  const assets: JobAssets = {
    dir,
    script: {
      jobId,
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
          text: "It exercises buildInputProps and the actual Remotion render call.",
          headline: "Exercising buildInputProps",
          visualCue: "stock footage of servers",
          estSeconds: 5,
        },
      ],
    },
    segmentTiming: {
      jobId,
      totalDurationSeconds: 10,
      segments: [
        { id: 0, startSeconds: 0, endSeconds: 5 },
        { id: 1, startSeconds: 5, endSeconds: 10 },
      ],
    },
    captions: {
      jobId,
      words: [
        { word: "This", start: 0.2, end: 0.5 },
        { word: "is", start: 0.5, end: 0.7 },
        { word: "a", start: 0.7, end: 0.8 },
        { word: "smoke", start: 0.8, end: 1.2 },
        { word: "test.", start: 1.2, end: 1.7 },
        { word: "Exercising", start: 5.3, end: 5.9 },
        { word: "buildInputProps.", start: 5.9, end: 6.8 },
      ],
    },
    mediaManifest: {
      jobId,
      clips: [],
      music: { file: "music.wav", license: { source: "pixabay", licenseType: "free", url: "https://pixabay.com" } },
      sfx: [],
    },
  };

  const inputProps = buildInputProps(assets) as unknown as Record<string, unknown>;
  console.log("Built inputProps for", inputProps.title);

  const bundleLocation = await bundle({
    entryPoint: join(REPO, "remotion", "src", "index.ts"),
    publicDir: dir,
  });
  console.log("Bundled at", bundleLocation);

  const composition = await selectComposition({ serveUrl: bundleLocation, id: "NewsVideo", inputProps });
  console.log("Composition selected:", composition.durationInFrames, "frames @", composition.fps, "fps,", composition.width, "x", composition.height);

  const outputLocation = join(dir, "smoke-test-render.mp4");
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 25 === 0) console.log("progress", Math.round(progress * 100) + "%");
    },
  });

  console.log("Rendered to", outputLocation);
  await copyFile(outputLocation, join(REPO, "remotion", "out", "smoke-test-real-schema.mp4"));
  await rm(dir, { recursive: true, force: true });
  console.log("Copied result to remotion/out/smoke-test-real-schema.mp4 and cleaned up temp dir");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
