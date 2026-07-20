// Objective similarity check across the rendered theme stills: downscale each to
// a small RGB signature and compare pairwise, so "these look alike" is measured
// rather than eyeballed.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { THEMES } from "../services/shared/src/theme/index.ts";

const execFileAsync = promisify(execFile);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string;
const OUT_DIR = "C:\\Users\\HP\\New folder\\remotion\\out\\themes";
const GRID_W = 16;
const GRID_H = 9;

async function signature(path: string, scratch: string): Promise<number[]> {
  const raw = join(scratch, `${Math.random().toString(36).slice(2)}.raw`);
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-i", path,
    // Crop to the bottom 45% before signing. Every still now shares an identical
    // footage stand-in, so a whole-frame signature is ~85% identical pixels and
    // says nothing; the ticker, captions and lower-third all live down here.
    "-vf", `crop=iw:ih*0.45:0:ih*0.55,scale=${GRID_W}:${GRID_H}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", raw,
  ]);
  const buf = await readFile(raw);
  await rm(raw, { force: true });
  return [...buf];
}

function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), "theme-sim-"));
  const sigs = new Map<string, number[]>();
  for (const theme of THEMES) {
    sigs.set(theme.id, await signature(join(OUT_DIR, `${theme.id}.png`), scratch));
  }

  const pairs: Array<{ a: string; b: string; d: number }> = [];
  for (let i = 0; i < THEMES.length; i++) {
    for (let j = i + 1; j < THEMES.length; j++) {
      const a = THEMES[i].id;
      const b = THEMES[j].id;
      pairs.push({ a, b, d: distance(sigs.get(a)!, sigs.get(b)!) });
    }
  }
  pairs.sort((x, y) => x.d - y.d);

  console.log("MOST SIMILAR PAIRS (lower = more alike):");
  for (const p of pairs.slice(0, 12)) {
    console.log(`  ${p.d.toFixed(1).padStart(6)}  ${p.a.padEnd(16)} vs ${p.b}`);
  }
  console.log("\nMOST DISTINCT PAIRS:");
  for (const p of pairs.slice(-4)) {
    console.log(`  ${p.d.toFixed(1).padStart(6)}  ${p.a.padEnd(16)} vs ${p.b}`);
  }

  // Per-theme: how close is its nearest neighbour?
  console.log("\nNEAREST NEIGHBOUR PER THEME:");
  const rows = THEMES.map((t) => {
    const nearest = pairs.filter((p) => p.a === t.id || p.b === t.id).sort((x, y) => x.d - y.d)[0];
    return { id: t.id, neighbour: nearest.a === t.id ? nearest.b : nearest.a, d: nearest.d };
  }).sort((x, y) => x.d - y.d);
  for (const r of rows) {
    const flag = r.d < 30 ? "  <-- too close" : "";
    console.log(`  ${r.d.toFixed(1).padStart(6)}  ${r.id.padEnd(16)} -> ${r.neighbour}${flag}`);
  }

  await rm(scratch, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
