// Renders one still per theme and tiles them into a contact sheet, so the
// catalog can be reviewed as design work rather than as token diffs.
// Output: remotion/out/themes/*.png + remotion/out/theme-contact-sheet.jpg
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { THEMES } from "../services/shared/src/theme/index.ts";

const execFileAsync = promisify(execFile);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string;

const REPO = "E:\\Youtube Ai Automation Agent";
const OUT_DIR = join(REPO, "remotion", "out", "themes");
const SHEET_PATH = join(REPO, "remotion", "out", "theme-contact-sheet.jpg");
const WIDTH = 1280;
const HEIGHT = 720;
const COLUMNS = 3;
// Frame 45: the lower-third's spring entry has settled and a caption word is
// active, so every themed surface is visible in the still.
const PREVIEW_FRAME = 45;

const FOOTAGE_FILE = "preview-footage.png";

/**
 * A neutral, desaturated stand-in for stock footage, identical for every theme.
 * Blurred so it reads as out-of-focus b-roll, and full of both bright and dark
 * regions so the legibility scrim and caption contrast can actually be judged.
 * Keeping it identical across themes is what makes the similarity numbers
 * measure the theme's chrome rather than its background tint.
 */
async function generatePreviewFootage(path: string): Promise<void> {
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=s=${WIDTH}x${HEIGHT}`,
    "-vf", "hue=s=0.12,gblur=sigma=26",
    "-frames:v", "1", "-y", path,
  ], { maxBuffer: 32 * 1024 * 1024 });
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Written into remotion/public so staticFile() resolves it from the bundle.
  const publicDir = join(REPO, "remotion", "public");
  await mkdir(publicDir, { recursive: true });
  await generatePreviewFootage(join(publicDir, FOOTAGE_FILE));

  const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts") });
  console.log(`Bundled. Rendering ${THEMES.length} theme stills at ${WIDTH}x${HEIGHT}...\n`);

  const framePaths: string[] = [];
  for (const theme of THEMES) {
    const inputProps = { themeId: theme.id, showLabel: true, mediaSrc: FOOTAGE_FILE };
    const composition = await selectComposition({ serveUrl, id: "ThemePreview", inputProps });
    const output = join(OUT_DIR, `${theme.id}.png`);
    await renderStill({
      composition: { ...composition, width: WIDTH, height: HEIGHT },
      serveUrl,
      output,
      frame: PREVIEW_FRAME,
      inputProps,
    });
    framePaths.push(output);
    console.log(`  ${theme.id.padEnd(16)} ${theme.ticker.variant.padEnd(8)} ${theme.lowerThird.variant.padEnd(12)} ${theme.transition.style}`);
  }

  // Tile into a single sheet. concat via a list file keeps the ffmpeg args short
  // and preserves catalog order rather than relying on glob ordering.
  const rows = Math.ceil(framePaths.length / COLUMNS);
  const listPath = join(OUT_DIR, "sheet-inputs.txt");
  await writeFile(
    listPath,
    framePaths.map((p) => `file '${p.replace(/\\/g, "/")}'\nduration 1`).join("\n"),
    "utf8",
  );

  const inputArgs = framePaths.flatMap((p) => ["-i", p]);
  const filter = `${framePaths.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${framePaths.length}:layout=${buildLayout(framePaths.length, COLUMNS)}[sheet]`;

  await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[sheet]",
    "-q:v",
    "4",
    "-y",
    SHEET_PATH,
  ], { maxBuffer: 64 * 1024 * 1024 });

  console.log(`\nContact sheet: ${SHEET_PATH} (${COLUMNS} x ${rows} grid)`);
  console.log(`Individual stills: ${OUT_DIR}`);
}

/** xstack layout string: cells laid out left-to-right, top-to-bottom. */
function buildLayout(count: number, columns: number): string {
  return Array.from({ length: count }, (_, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col === 0 ? "0" : Array.from({ length: col }, (_, c) => `w${c}`).join("+");
    const y = row === 0 ? "0" : Array.from({ length: row }, (_, r) => `h${r * columns}`).join("+");
    return `${x}_${y}`;
  }).join("|");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
