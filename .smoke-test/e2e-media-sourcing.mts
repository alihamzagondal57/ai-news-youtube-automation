// END-TO-END test of the media-sourcing SERVICE on genuinely real data: real
// Pexels + Pixabay API calls, real downloads, no mocking. Uploads a script.json
// with common, reliably-searchable B-roll subjects, runs the real
// runMediaSourcing() entry point, downloads the resulting clips back from the
// store, ffprobes them, and feeds the manifest through render-server's OWN
// buildInputProps + buildChunkPlan to prove it lands in the exact shape the
// render pipeline expects.
//
// A second, smaller job re-uses the first segment's subject to prove the
// channel-wide dedupe (state/media-usage.json) actually avoids repeating the
// same asset across videos, not just within one.
//
// Requires PEXELS_API_KEY and PIXABAY_API_KEY in .env. No mocking of either API.
import "dotenv/config";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import S3rver from "s3rver";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

const S3_PORT = 4577;
const BUCKET = "ai-news-pipeline";
const JOB_A = "99999999-9999-9999-9999-999999999991";
const JOB_B = "99999999-9999-9999-9999-999999999992";
const FPS = 30;

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";
// Bound the test's network/download volume without weakening what it proves:
// still real search, real ranking/dedupe, real downloads — just fewer of them.
process.env.MEDIA_ALTERNATIVES_COUNT = process.env.MEDIA_ALTERNATIVES_COUNT ?? "3";
process.env.MEDIA_SEARCH_PER_PAGE = process.env.MEDIA_SEARCH_PER_PAGE ?? "6";

// Ordinary, common B-roll subjects — chosen to reliably return real results
// from both providers, so a failure here means the pipeline is broken, not
// that the topic was too obscure to find footage for.
const SCRIPT_A = {
  jobId: JOB_A,
  title: "European Parliament Approves AI Liability Directive",
  structureId: "deep-dive",
  segments: [
    { id: 0, text: "Good evening.", headline: "AI Liability Directive Approved", visualCue: "stock footage of the European Parliament building", estSeconds: 8 },
    { id: 1, text: "Markets reacted quickly.", headline: "Markets React", visualCue: "stock footage of a stock market trading floor", estSeconds: 10 },
    { id: 2, text: "That is all for tonight.", headline: "City At Night", visualCue: "stock footage of a city skyline at night", estSeconds: 8 },
  ],
};

const SCRIPT_B = {
  jobId: JOB_B,
  title: "Follow-up Segment On EU Institutions",
  structureId: "deep-dive",
  segments: [
    // Deliberately the SAME subject as SCRIPT_A's segment 0, to test
    // channel-wide dedupe: this job runs after A, so its usage history should
    // steer it away from A's exact primary pick.
    { id: 0, text: "Back to Brussels.", headline: "EU Parliament Revisited", visualCue: "stock footage of the European Parliament building", estSeconds: 8 },
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

async function probeVideo(path: string): Promise<{ width: number; height: number; durationSeconds: number }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json", path,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  return {
    width: parsed.streams?.[0]?.width ?? 0,
    height: parsed.streams?.[0]?.height ?? 0,
    durationSeconds: Number.parseFloat(parsed.format?.duration ?? "0"),
  };
}

async function main() {
  if (!process.env.PEXELS_API_KEY || !process.env.PIXABAY_API_KEY) {
    console.error("PEXELS_API_KEY and PIXABAY_API_KEY must both be set in .env for this real-API E2E test.");
    process.exit(1);
  }

  const dataDir = await mkdtemp(join(tmpdir(), "e2e-media-"));
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
    const { JobStore, mediaManifestSchema } = await import("@ai-news/shared");
    const { runMediaSourcing } = await import("../services/media-sourcing/src/index.ts");
    const { buildInputProps } = await import("../infra/render-server/src/buildInputProps.ts");
    const { buildChunkPlan } = await import("../infra/render-server/src/segmentPlan.ts");

    const store = JobStore.fromEnv();

    // ── Job A: full real run, 3 segments ──────────────────────────────────────
    await store.putJson(store.jobKey(JOB_A, "script.json"), SCRIPT_A);
    console.log(`Job A: searching + downloading real footage for ${SCRIPT_A.segments.length} segments...`);
    const tA = Date.now();
    await runMediaSourcing(JOB_A);
    console.log(`  done in ${((Date.now() - tA) / 1000).toFixed(1)}s\n`);

    const manifestA = await store.getJsonIfExists(store.jobKey(JOB_A, "media/media-manifest.json"), mediaManifestSchema);
    check("media-manifest.json written and satisfies mediaManifestSchema", manifestA !== null, manifestA ? "parsed" : "MISSING or invalid");
    if (!manifestA) throw new Error("no manifest to inspect");

    check("one clip entry per script segment", manifestA.clips.length === SCRIPT_A.segments.length, `${manifestA.clips.length}/${SCRIPT_A.segments.length}`);
    check("clip segmentIds match the script's own ids, in order", JSON.stringify(manifestA.clips.map((c) => c.segmentId)) === JSON.stringify(SCRIPT_A.segments.map((s) => s.id)), manifestA.clips.map((c) => c.segmentId).join(","));

    const alternativeCounts = manifestA.clips.map((c) => c.alternatives.length);
    check("every segment carries multiple alternatives (real search returned enough candidates)", alternativeCounts.every((n) => n >= 2), `alternatives per segment: ${alternativeCounts.join(", ")}`);

    // ── Both providers were actually used somewhere in the manifest ──────────
    const allAssets = manifestA.clips.flatMap((c) => [{ file: c.file, license: c.license }, ...c.alternatives]);
    const sources = new Set(allAssets.map((a) => a.license.source));
    check("selection draws from BOTH providers across the manifest (not one source dominating)", sources.has("pexels") && sources.has("pixabay"), `sources present: ${[...sources].join(", ")}`);

    // ── License records ────────────────────────────────────────────────────
    check(
      "every asset's license names a real source and a live proof-of-sourcing URL",
      allAssets.every((a) => (a.license.source === "pexels" || a.license.source === "pixabay") && /^https?:\/\//.test(a.license.url)),
      `${allAssets.length} assets checked`,
    );

    // ── No duplicate assets anywhere in the manifest (primary or alternative) ─
    const allKeys = allAssets.map((a) => `${a.license.source}:${a.license.url}`);
    check("no asset (primary or alternative) is reused anywhere in the manifest", new Set(allKeys).size === allKeys.length, `${new Set(allKeys).size}/${allKeys.length} unique`);

    // ── Real downloads: fetch every clip back from the store and ffprobe it ──
    let allValid = true;
    let probeDetail = "";
    for (const clip of manifestA.clips) {
      const localPath = join(dataDir, `check-${clip.file}`);
      await store.downloadToFile(store.jobKey(JOB_A, `media/${clip.file}`), localPath);
      const probed = await probeVideo(localPath);
      const size = (await stat(localPath)).size;
      if (!(probed.width > 0 && probed.height > 0 && probed.durationSeconds > 0 && size > 20_000)) {
        allValid = false;
        probeDetail += `${clip.file}: INVALID (${JSON.stringify(probed)}, ${size}B); `;
      } else {
        probeDetail += `${clip.file}: ${probed.width}x${probed.height} ${probed.durationSeconds.toFixed(1)}s (${(size / 1024).toFixed(0)}KB); `;
      }
      // Also confirm one alternative per segment is a genuine, separately downloadable file.
      const alt = clip.alternatives[0];
      if (alt) {
        const altLocalPath = join(dataDir, `check-${alt.file}`);
        await store.downloadToFile(store.jobKey(JOB_A, `media/${alt.file}`), altLocalPath);
        const altSize = (await stat(altLocalPath)).size;
        if (!(altSize > 20_000)) allValid = false;
      }
    }
    check("every primary clip (and a sampled alternative) is a real, valid, downloadable video", allValid, probeDetail);

    // ── The decisive check: render-server accepts this manifest ─────────────
    const fakeTiming = {
      jobId: JOB_A,
      totalDurationSeconds: SCRIPT_A.segments.reduce((n, s) => n + s.estSeconds, 0),
      segments: (() => {
        let t = 0;
        return SCRIPT_A.segments.map((s) => {
          const entry = { id: s.id, startSeconds: t, endSeconds: t + s.estSeconds };
          t += s.estSeconds;
          return entry;
        });
      })(),
    };
    let propsOk = false;
    let propsDetail = "";
    try {
      const props = buildInputProps({
        dir: dataDir,
        script: SCRIPT_A,
        segmentTiming: fakeTiming,
        captions: { jobId: JOB_A, words: [] },
        mediaManifest: manifestA,
      } as never);
      // Every segment's clip is far longer than its estSeconds-derived timing here
      // (real stock clips vs. a fake few-second fixture timing), so mediaTimeline's
      // Case 1 (trim to fit) applies uniformly: exactly one media entry per segment,
      // sourced from that segment's own primary clip.
      const mediaMatches = props.segments.every(
        (seg, i) => seg.media.length === 1 && seg.media[0].src === manifestA.clips[i].file,
      );
      const plan = buildChunkPlan(props);
      propsOk = mediaMatches && plan.chunks.length === SCRIPT_A.segments.length + 1; // + outro chunk
      propsDetail = `media: ${props.segments.map((s) => s.media.map((m) => m.src).join("+")).join(", ")}; ${plan.chunks.length} chunks planned`;
    } catch (err) {
      propsDetail = `render-server rejected the manifest: ${(err as Error).message}`;
    }
    check("render-server buildInputProps + buildChunkPlan accept the manifest", propsOk, propsDetail);

    console.log(`\n── Job A selections ──`);
    for (const clip of manifestA.clips) {
      console.log(`  segment ${clip.segmentId}: ${clip.license.source} ${clip.file} (+${clip.alternatives.length} alternatives) — ${clip.license.url}`);
    }

    // ── Job B: channel-wide dedupe across separate jobs ───────────────────────
    await store.putJson(store.jobKey(JOB_B, "script.json"), SCRIPT_B);
    console.log(`\nJob B: same subject as Job A's segment 0, testing channel-wide dedupe...`);
    const tB = Date.now();
    await runMediaSourcing(JOB_B);
    console.log(`  done in ${((Date.now() - tB) / 1000).toFixed(1)}s\n`);

    const manifestB = await store.getJsonIfExists(store.jobKey(JOB_B, "media/media-manifest.json"), mediaManifestSchema);
    check("Job B also produces a valid manifest", manifestB !== null, manifestB ? "parsed" : "MISSING or invalid");
    if (!manifestB) throw new Error("no Job B manifest to inspect");

    const primaryA = manifestA.clips[0].license.url;
    const primaryB = manifestB.clips[0].license.url;
    check(
      "channel-wide dedupe steers Job B away from Job A's exact primary pick for the same subject",
      primaryA !== primaryB,
      primaryA === primaryB ? `both picked ${primaryA} (dedupe did not take effect)` : `A picked ${primaryA}, B picked ${primaryB}`,
    );

    console.log(`  Job A primary: ${primaryA}`);
    console.log(`  Job B primary: ${primaryB}`);

    console.log("");
    console.log(failures === 0 ? "E2E PASSED: script.json -> media-manifest.json with real clips, verified against the render pipeline." : `${failures} failure(s)`);
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
