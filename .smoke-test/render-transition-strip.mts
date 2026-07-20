// Renders a strip of frames across a segment boundary so the transition can be
// seen directly. red -> magenta makes the handover unmistakable.
import { execFile } from "node:child_process";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { getTheme } from "../services/shared/src/theme/index.ts";
import type { NewsVideoRenderProps } from "../infra/render-server/src/buildInputProps.ts";
import { generateColorClip } from "./lib/media.mts";

const execFileAsync = promisify(execFile);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string;
const REPO = "C:\\Users\\HP\\New folder";

function props(themeId: string): NewsVideoRenderProps {
  const theme = getTheme(themeId);
  return {
    title: "Transition Probe",
    resolution: { width: 480, height: 270 },
    fps: 30,
    outroDurationInFrames: 30,
    segments: [0, 1, 2].map((i) => ({
      id: i, text: `Segment ${i}`, startFrame: i * 60, durationInFrames: 60,
      mediaSrc: ["clip-red.mp4", "clip-magenta.mp4", "clip-red.mp4"][i],
      lowerThirdText: "", breaking: false,
    })),
    captionWords: [],
    tickerHeadlines: ["PROBE"],
    themeId: theme.id,
    transitionFrames: theme.transition.frames,
    audio: { voiceoverSrc: "voiceover.wav", musicSrc: "", musicVolume: 0.15, duckedVolume: 0.05 },
    branding: { channelName: "EuroWire News", accentColor: "#e11d2e" },
  };
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), "trans-"));
  const publicDir = join(work, "public");
  await mkdir(publicDir, { recursive: true });
  for (const c of ["red", "magenta"]) {
    await generateColorClip(c, 5, 30, 480, 270, join(publicDir, `clip-${c}.mp4`));
  }
  await copyFile(join(REPO, "remotion", "public", "sample", "voiceover.wav"), join(publicDir, "voiceover.wav"));
  const serveUrl = await bundle({ entryPoint: join(REPO, "remotion", "src", "index.ts"), publicDir });

  const rows: string[] = [];
  for (const themeId of ["broadsheet", "midnight-wire", "signal-red", "oceanic", "ember"]) {
    const inputProps = props(themeId) as unknown as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: "NewsVideo", inputProps });
    const frames = [104, 110, 116, 122, 128, 134];
    const shots: string[] = [];
    for (const f of frames) {
      const out = join(work, `${themeId}-${f}.png`);
      await renderStill({ composition, serveUrl, output: out, frame: f, inputProps });
      shots.push(out);
    }
    const row = join(work, `row-${themeId}.png`);
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      ...shots.flatMap((s) => ["-i", s]),
      "-filter_complex", `${shots.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${shots.length}[o]`,
      "-map", "[o]", "-y", row,
    ]);
    rows.push(row);
    console.log(`${themeId}: frames ${frames.join(", ")}`);
  }

  const final = join(REPO, "remotion", "out", "transition-strip.jpg");
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    ...rows.flatMap((r) => ["-i", r]),
    "-filter_complex", `${rows.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${rows.length}[o]`,
    "-map", "[o]", "-q:v", "3", "-y", final,
  ]);
  console.log(`\nwritten ${final}  (rows: broadsheet wipeX18, midnight-wire crossfade15, signal-red slideX12, oceanic zoomIn24, ember dipToColor13)`);
  await rm(work, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
