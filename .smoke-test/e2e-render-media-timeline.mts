// The decisive, real-render proof for the clip trim/sequencing fix: renders an
// ACTUAL video through the real render-server pipeline (runRender -> Remotion
// -> real ffmpeg encode) with two deliberately mismatched segments, then reads
// the rendered pixels back and confirms:
//
//   - Case 2 (clip shorter than its segment): the segment cuts through
//     multiple distinct clips rather than holding on one frozen frame.
//   - Case 1 (clip longer than its segment): the segment trims INTO the clip
//     (skips its static opening) rather than just playing from frame 0, and
//     keeps advancing through the clip rather than freezing.
//   - No desync: total rendered duration and audio/video sync match exactly
//     what segment-timing.json declared.
//
// Verification is via sampled-frame average colour (existing pattern from
// smoke-test-stitch.mts / render-transition-strip.mts), using clips built from
// distinct, unambiguous colours rather than real footage — the goal is proving
// the WIRING (render-server computes a timeline and Remotion actually applies
// it frame-for-frame), which mediaTimeline.ts's own unit tests already prove
// correct in isolation.
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { colorDistance, ffmpegPath, frameAverageColor, generateColorClip, probeVideo } from "./lib/media.mts";

const S3_PORT = 4578;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "77777777-aaaa-aaaa-aaaa-777777777777";
const FPS = 30;
const W = 640;
const H = 360;

process.env.RENDER_WIDTH = String(W);
process.env.RENDER_HEIGHT = String(H);
process.env.RENDER_FPS = String(FPS);
process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const REPO = "E:\\Youtube Ai Automation Agent";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// Named colours ffmpeg's `color` source accepts, chosen to be maximally
// distinguishable from each other and from the render's own scrim/UI chrome.
const CHAPTER_COLORS = ["black", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta", "white"];

// ThemedIntro overlays the true start of the FIRST segment (see
// remotion/src/components/themed/ThemedIntro.tsx) — legitimately, not a media
// timeline defect. A beat whose entire span sits inside this window has no
// valid background sample; skip such beats in the colour assertion below.
const INTRO_DURATION_IN_FRAMES = 75;

/** A single clip made of N distinct 1-second colour chapters, concatenated and re-encoded. Lets a test verify exactly WHERE in the clip playback landed. */
async function generateChapteredClip(colors: string[], secondsPerChapter: number, outputPath: string, scratchDir: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const parts: string[] = [];
  for (let i = 0; i < colors.length; i++) {
    const part = join(scratchDir, `chapter-${i}.mp4`);
    await generateColorClip(colors[i], secondsPerChapter, FPS, W, H, part);
    parts.push(part);
  }
  const listPath = join(scratchDir, "concat-list.txt");
  await writeFile(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    outputPath,
  ]);
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-render-timeline-"));
  const server = new S3rver({
    port: S3_PORT,
    address: "localhost",
    silent: true,
    directory: dataDir,
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  await server.run();
  console.log(`s3rver (R2 stand-in) on :${S3_PORT}\n`);

  const clipDir = await mkdtemp(join(tmpdir(), "e2e-render-timeline-clips-"));

  try {
    const { JobStore, createLogger } = await import("@ai-news/shared");
    const { runRender } = await import("../infra/render-server/src/render.ts");
    const { buildSegmentMediaTimeline, mediaTimelineToFrames } = await import("../infra/render-server/src/mediaTimeline.ts");
    const { getTheme } = await import("../services/shared/src/theme/index.ts");

    const store = JobStore.fromEnv();
    const theme = getTheme("broadsheet"); // wipeX at 18 frames — hard-edged, and a known non-default transitionFrames
    const transitionFrames = theme.transition.frames;

    // ── Segment 0: Case 2 — a short clip pool must SEQUENCE, never freeze ────
    // Primary + 2 alternatives, each 2s, against a 6s segment (padded further
    // by the theme's transition frames since this is the first of two segments).
    const seg0Start = 0;
    const seg0Duration = 180; // 6s
    await generateColorClip("red", 2, FPS, W, H, join(clipDir, "seg0-primary.mp4"));
    await generateColorClip("green", 2, FPS, W, H, join(clipDir, "seg0-alt1.mp4"));
    await generateColorClip("blue", 2, FPS, W, H, join(clipDir, "seg0-alt2.mp4"));

    // ── Segment 1: Case 1 — a long clip must TRIM INTO itself, not freeze ────
    // A 10-chapter, 10s clip (1s/colour) against a short, padded ~2.6s window.
    // introSkip = 10s * 0.12 = 1.2s, landing inside chapter 1 ("red") — so the
    // segment's very first frame must show red, never chapter 0's black, and
    // must keep advancing through orange/yellow as playback continues.
    const seg1Start = 180;
    const seg1Duration = 60; // 2s
    await generateChapteredClip(CHAPTER_COLORS, 1, join(clipDir, "seg1-primary.mp4"), clipDir);

    for (const [name, file] of [
      ["seg0-primary.mp4", "seg0-primary.mp4"],
      ["seg0-alt1.mp4", "seg0-alt1.mp4"],
      ["seg0-alt2.mp4", "seg0-alt2.mp4"],
      ["seg1-primary.mp4", "seg1-primary.mp4"],
    ] as const) {
      await store.putFile(store.jobKey(JOB_ID, `media/${file}`), join(clipDir, name), "video/mp4");
    }
    await store.putFile(store.jobKey(JOB_ID, "voiceover.wav"), join(REPO, "remotion", "public", "sample", "voiceover.wav"), "audio/wav");

    const script = {
      jobId: JOB_ID,
      title: "Media Timeline Verification",
      segments: [
        { id: 0, text: "Segment zero.", headline: "Sequencing Test", visualCue: "n/a", estSeconds: 6 },
        { id: 1, text: "Segment one.", headline: "Trim Test", visualCue: "n/a", estSeconds: 2 },
      ],
    };
    const segmentTiming = {
      jobId: JOB_ID,
      totalDurationSeconds: 8,
      segments: [
        { id: 0, startSeconds: 0, endSeconds: 6 },
        { id: 1, startSeconds: 6, endSeconds: 8 },
      ],
    };
    const captions = { jobId: JOB_ID, words: [] };
    const license = { source: "pixabay", licenseType: "free", url: "https://pixabay.com" } as const;
    const mediaManifest = {
      jobId: JOB_ID,
      clips: [
        {
          segmentId: 0,
          file: "seg0-primary.mp4",
          license,
          durationSeconds: 2,
          alternatives: [
            { file: "seg0-alt1.mp4", license, durationSeconds: 2 },
            { file: "seg0-alt2.mp4", license, durationSeconds: 2 },
          ],
        },
        { segmentId: 1, file: "seg1-primary.mp4", license, durationSeconds: 10, alternatives: [] },
      ],
      music: null,
      sfx: [],
    };

    await store.putJson(store.jobKey(JOB_ID, "script.json"), script);
    await store.putJson(store.jobKey(JOB_ID, "segment-timing.json"), segmentTiming);
    await store.putJson(store.jobKey(JOB_ID, "captions.json"), captions);
    await store.putJson(store.jobKey(JOB_ID, "media/media-manifest.json"), mediaManifest);
    console.log(`Uploaded job inputs to jobs/${JOB_ID}/\n`);

    // ── Independently compute the SAME timeline render-server will use ───────
    // (mirrors buildInputProps.ts's own padding math) so the test asserts
    // against exact, pre-known frame boundaries rather than guessing.
    const seg0Overlap = { start: seg0Start, end: seg0Start + seg0Duration + transitionFrames }; // isFirst, not isLast
    const seg0LocalFrames = seg0Overlap.end - seg0Overlap.start;
    const seg0Timeline = mediaTimelineToFrames(
      buildSegmentMediaTimeline(seg0LocalFrames / FPS, { file: "seg0-primary.mp4", durationSeconds: 2 }, [
        { file: "seg0-alt1.mp4", durationSeconds: 2 },
        { file: "seg0-alt2.mp4", durationSeconds: 2 },
      ]),
      FPS,
    );
    console.log("Expected segment 0 timeline (local frames):", seg0Timeline.map((e) => `${e.file}[${e.startFrame},${e.startFrame + e.durationInFrames})`).join(" "));

    const seg1Overlap = { start: seg1Start - transitionFrames, end: seg1Start + seg1Duration }; // not isFirst, isLast
    const seg1LocalFrames = seg1Overlap.end - seg1Overlap.start;
    const seg1Timeline = mediaTimelineToFrames(
      buildSegmentMediaTimeline(seg1LocalFrames / FPS, { file: "seg1-primary.mp4", durationSeconds: 10 }, []),
      FPS,
    );
    console.log("Expected segment 1 timeline (local frames):", seg1Timeline.map((e) => `${e.file}[${e.startFrame},${e.startFrame + e.durationInFrames}) trim=${(e.trimBeforeFrames / FPS).toFixed(2)}s`).join(" "));

    check("segment 0 needed more than one clip (Case 2: pool too short for a 6s+pad segment)", seg0Timeline.length > 1, `${seg0Timeline.length} beats`);
    check("segment 1 needed exactly one clip, trimmed (Case 1: 10s clip covers a ~2.6s segment)", seg1Timeline.length === 1, `${seg1Timeline.length} beat(s)`);

    // ── Run the REAL render-server pipeline ───────────────────────────────────
    const result = await runRender(store, JOB_ID, createLogger("e2e-render-timeline"));
    if (result.status !== "completed" || !result.renderKey) {
      throw new Error(`runRender did not complete: ${JSON.stringify(result)}`);
    }
    console.log(`\nrunRender completed: ${JSON.stringify(result)}\n`);

    const outDir = join(REPO, "remotion", "out");
    await mkdir(outDir, { recursive: true });
    const localOut = join(outDir, "e2e-media-timeline.mp4");
    await store.downloadToFile(result.renderKey, localOut);
    const probe = await probeVideo(localOut);
    console.log(`Downloaded render: ${probe.width}x${probe.height}, ${probe.frameCount} frames, ${probe.videoDurationSeconds.toFixed(2)}s\n`);

    // ── No desync: total duration and audio/video sync match segment-timing ──
    const outroFrames = Math.round(5 * FPS); // OUTRO_SECONDS in buildInputProps.ts
    const expectedTotalFrames = seg1Start + seg1Duration + outroFrames;
    check("rendered frame count matches segment-timing + outro exactly", probe.frameCount === expectedTotalFrames, `${probe.frameCount} == ${expectedTotalFrames}`);
    check(
      "audio and video stay in sync",
      probe.audioDurationSeconds !== null && Math.abs(probe.audioDurationSeconds - probe.videoDurationSeconds) < 0.05,
      `audio ${probe.audioDurationSeconds}s vs video ${probe.videoDurationSeconds.toFixed(2)}s`,
    );

    // ── Colour reference table for each source ────────────────────────────────
    const NAMED: Record<string, { r: number; g: number; b: number }> = {
      black: { r: 0, g: 0, b: 0 }, red: { r: 255, g: 0, b: 0 }, orange: { r: 255, g: 165, b: 0 },
      yellow: { r: 255, g: 255, b: 0 }, green: { r: 0, g: 128, b: 0 }, cyan: { r: 0, g: 255, b: 255 },
      blue: { r: 0, g: 0, b: 255 }, purple: { r: 128, g: 0, b: 128 }, magenta: { r: 255, g: 0, b: 255 }, white: { r: 255, g: 255, b: 255 },
    };
    const CLIP_COLOR: Record<string, string> = { "seg0-primary.mp4": "red", "seg0-alt1.mp4": "green", "seg0-alt2.mp4": "blue" };
    // Generous threshold: the theme's legibility scrim darkens/blends every
    // background pixel uniformly, so an exact RGB match isn't expected — only
    // that different sources are still clearly distinguishable from each other.
    const MATCH_THRESHOLD = 140;

    // ── Segment 0 (Case 2): each beat shows the RIGHT, DIFFERENT colour ───────
    // Segment 0 is the FIRST segment, so its opening frames sit under
    // ThemedIntro's title card (see INTRO_DURATION_IN_FRAMES above) — that's
    // the composition working as designed, not a media-timeline defect. Any
    // beat whose midpoint falls inside that window is skipped here rather than
    // asserted against, since there is no valid background sample to read.
    console.log("── Segment 0 (sequencing) ──");
    let seg0Correct = true;
    let seg0Detail = "";
    const seg0Samples: Array<{ r: number; g: number; b: number }> = [];
    for (const beat of seg0Timeline) {
      const midLocalFrame = beat.startFrame + Math.floor(beat.durationInFrames / 2);
      const globalFrame = seg0Overlap.start + midLocalFrame;
      if (globalFrame < INTRO_DURATION_IN_FRAMES) {
        console.log(`  frame ${globalFrame} [${beat.file}] — inside the intro overlay window (<${INTRO_DURATION_IN_FRAMES}), skipping colour assertion`);
        continue;
      }
      const sample = await frameAverageColor(localOut, globalFrame, dataDir);
      seg0Samples.push(sample);
      const expected = NAMED[CLIP_COLOR[beat.file]];
      const dist = colorDistance(sample, expected);
      const ok = dist <= MATCH_THRESHOLD;
      seg0Correct &&= ok;
      seg0Detail += `frame ${globalFrame} (${beat.file}, expect ${CLIP_COLOR[beat.file]}): sampled rgb(${sample.r},${sample.g},${sample.b}) dist=${dist.toFixed(0)} ${ok ? "OK" : "MISMATCH"}; `;
      console.log(`  frame ${globalFrame} [${beat.file}] expect ${CLIP_COLOR[beat.file]} -> rgb(${sample.r},${sample.g},${sample.b}) dist=${dist.toFixed(0)} ${ok ? "ok" : "MISMATCH"}`);
    }
    check("segment 0: every beat shows its assigned clip's colour", seg0Correct, seg0Detail);

    let seg0Distinct = true;
    for (let i = 1; i < seg0Samples.length; i++) {
      if (colorDistance(seg0Samples[i], seg0Samples[i - 1]) < 40) seg0Distinct = false;
    }
    check(
      "segment 0: NO FREEZE — consecutive beats show measurably different colour (a real cut happened)",
      seg0Distinct,
      seg0Samples.map((s) => `rgb(${s.r},${s.g},${s.b})`).join(" -> "),
    );

    // ── Segment 1 (Case 1): trims INTO the clip, keeps advancing ──────────────
    console.log("\n── Segment 1 (trim) ──");
    const localFrame0 = seg1Timeline[0]; // the single trimmed beat
    const trimSeconds = localFrame0.trimBeforeFrames / FPS;
    const expectedChapterAtStart = CHAPTER_COLORS[Math.floor(trimSeconds)];
    const firstFrame = await frameAverageColor(localOut, seg1Overlap.start + 0, dataDir);
    const firstDist = colorDistance(firstFrame, NAMED[expectedChapterAtStart]);
    const blackDist = colorDistance(firstFrame, NAMED.black);
    console.log(`  trim-in = ${trimSeconds.toFixed(2)}s into the 10-chapter clip -> expected chapter "${expectedChapterAtStart}"`);
    console.log(`  segment's first frame: rgb(${firstFrame.r},${firstFrame.g},${firstFrame.b}) dist-to-expected=${firstDist.toFixed(0)} dist-to-black(chapter0)=${blackDist.toFixed(0)}`);
    check(
      `segment 1: trim-in skips the clip's static opening (shows "${expectedChapterAtStart}", not chapter 0's black)`,
      firstDist <= MATCH_THRESHOLD && blackDist > MATCH_THRESHOLD,
      `first frame matches "${expectedChapterAtStart}" (dist ${firstDist.toFixed(0)}) and clearly isn't black (dist ${blackDist.toFixed(0)})`,
    );

    // Sample near the end of the segment's local window too, to prove playback
    // kept ADVANCING through the source clip rather than holding on the first
    // trimmed frame.
    const lastLocalFrame = Math.max(0, localFrame0.durationInFrames - 2);
    const lastFrame = await frameAverageColor(localOut, seg1Overlap.start + lastLocalFrame, dataDir);
    const lastDist = colorDistance(lastFrame, firstFrame);
    console.log(`  near-end frame: rgb(${lastFrame.r},${lastFrame.g},${lastFrame.b}) distance-from-first-frame=${lastDist.toFixed(0)}`);
    check(
      "segment 1: NO FREEZE — playback advances through the trimmed clip rather than holding the first frame",
      lastDist > 40,
      `first-frame vs near-end-frame colour distance ${lastDist.toFixed(0)} (>40 required)`,
    );

    console.log("");
    console.log(
      failures === 0
        ? "E2E PASSED: real render confirms the clip trim/sequencing fix — no frozen frames, no desync."
        : `${failures} failure(s)`,
    );
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(clipDir, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
