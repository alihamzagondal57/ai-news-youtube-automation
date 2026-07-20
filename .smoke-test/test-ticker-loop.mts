// Does the rewritten ticker scroll stay full across a loop wrap?
// Renders one theme across ~20s and measures pixel variance inside the ticker
// strip. Text present => high variance; a gap at the wrap => variance collapses
// toward the flat band colour.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const execFileAsync = promisify(execFile);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string;
const REPO = "C:\\Users\\HP\\New folder";
const THEME = "midnight-wire"; // "band" variant: full-width strip, easiest to measure

async function stripVariance(png: string, scratch: string): Promise<number> {
  const raw = join(scratch, `${Math.random().toString(36).slice(2)}.raw`);
  // Bottom ~8% of frame is the ticker band; sample it as a 64x1 luma row.
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-i", png,
    "-vf", "crop=iw:ih*0.07:0:ih*0.93,scale=64:1,format=gray",
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-y", raw,
  ]);
  const buf = await readFile(raw);
  await rm(raw, { force: true });
  const values = [...buf];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), "ticker-loop-"));
  await mkdir(scratch, { recursive: true });
  const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts") });
  const inputProps = { themeId: THEME, showLabel: false, mediaSrc: "preview-footage.png" };
  const composition = await selectComposition({ serveUrl, id: "ThemePreview", inputProps });

  const frames = Array.from({ length: 18 }, (_, i) => i * 35); // 0..595 frames = ~20s @30fps
  const results: Array<{ frame: number; variance: number }> = [];

  for (const frame of frames) {
    const out = join(scratch, `f${frame}.png`);
    await renderStill({
      composition: { ...composition, width: 1280, height: 720, durationInFrames: 700 },
      serveUrl,
      output: out,
      frame,
      inputProps,
    });
    results.push({ frame, variance: await stripVariance(out, scratch) });
  }

  const variances = results.map((r) => r.variance);
  const min = Math.min(...variances);
  const max = Math.max(...variances);
  for (const r of results) {
    const bar = "#".repeat(Math.round(r.variance / 2));
    console.log(`  frame ${String(r.frame).padStart(3)} (t=${(r.frame / 30).toFixed(1)}s)  var ${r.variance.toFixed(1).padStart(5)}  ${bar}`);
  }
  console.log(`\n  min ${min.toFixed(1)} / max ${max.toFixed(1)}`);
  const healthy = min > max * 0.35;
  console.log(
    healthy
      ? "  PASS  ticker strip stays populated across the loop wrap (no empty gap)"
      : "  FAIL  ticker variance collapses at some frame — likely a gap at the wrap",
  );

  await rm(scratch, { recursive: true, force: true });
  if (!healthy) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
