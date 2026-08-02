// END-TO-END test of the review-dashboard SERVICE: boots the REAL Fastify app
// (apps/review-dashboard/server) against an in-process S3 store (s3rver), a
// real listening HTTP port, and real fetch() calls — not app.inject(), not a
// mock of the API — then proves the thing this feature exists for:
//
//   1. the dashboard's list/detail endpoints work against real fixtures,
//      including presigned URLs that ACTUALLY fetch real bytes back;
//   2. clip-swap and style/theme patches genuinely persist into
//      review-state.json (verified by reading the file directly, bypassing
//      the API, as an independent check);
//   3. BEFORE approval, the real youtube-uploader entry point
//      (runYoutubeUpload, with a fake YouTube client — never a real upload,
//      same reasoning as e2e-youtube-uploader.mts) throws, proving the gate
//      genuinely blocks;
//   4. calling the dashboard's real POST /approve, then re-running the SAME
//      real runYoutubeUpload, now SUCCEEDS — the approve flow genuinely
//      unblocks the uploader, not just a schema check in isolation; and
//   5. reject sets status "rejected" and the gate stays shut.
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import S3rver from "s3rver";
import { ffmpegPath, generateColorClip } from "./lib/media.mts";

const execFileAsync = promisify(execFile);

const S3_PORT = 4583;
const DASHBOARD_PORT = 4584;
const BUCKET = "ai-news-pipeline";
const BASE_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

// Dummy — youtube-uploader's config.ts requires these to be SET, but the
// injected fake client below means they're never used to talk to Google.
process.env.YOUTUBE_CLIENT_ID = "e2e-client-id";
process.env.YOUTUBE_CLIENT_SECRET = "e2e-client-secret";
process.env.YOUTUBE_REFRESH_TOKEN = "e2e-refresh-token";

const JOB_APPROVE = "77777777-1111-1111-1111-777777777777";
const JOB_REJECT = "77777777-2222-2222-2222-777777777777";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function scriptFor(jobId: string) {
  return {
    jobId,
    title: "European Central Bank Holds Interest Rates Steady",
    segments: [
      { id: 0, text: "Good evening.", headline: "ECB Holds Rates Steady", visualCue: "stock footage of the ECB building", estSeconds: 10 },
      { id: 1, text: "Markets reacted.", headline: "Markets React", visualCue: "stock footage of a trading floor", estSeconds: 10 },
    ],
  };
}

function segmentTimingFor(jobId: string) {
  return {
    jobId,
    totalDurationSeconds: 20,
    segments: [
      { id: 0, startSeconds: 0, endSeconds: 10 },
      { id: 1, startSeconds: 10, endSeconds: 20 },
    ],
  };
}

const LICENSE = { source: "pexels" as const, licenseType: "Pexels License", url: "https://www.pexels.com/example" };

function mediaManifestFor(jobId: string) {
  return {
    jobId,
    clips: [
      {
        segmentId: 0,
        file: "clip-0.mp4",
        license: LICENSE,
        durationSeconds: 10,
        alternatives: [{ file: "clip-0-alt1.mp4", license: LICENSE, durationSeconds: 10 }],
      },
      {
        segmentId: 1,
        file: "clip-1.mp4",
        license: LICENSE,
        durationSeconds: 10,
        alternatives: [{ file: "clip-1-alt1.mp4", license: LICENSE, durationSeconds: 10 }],
      },
    ],
    music: null,
    sfx: [],
  };
}

function metadataFor(jobId: string) {
  return {
    jobId,
    title: "European Central Bank Holds Interest Rates Steady",
    description: "Full report on today's ECB interest rate decision and market reaction.",
    tags: ["ecb", "interest rates", "europe", "economy"],
    hashtags: ["ECB", "Economy", "Europe"],
    chapters: [{ title: "Intro", startSeconds: 0 }],
    containsSyntheticMedia: true,
  };
}

function jobManifestFor(jobId: string) {
  const now = new Date().toISOString();
  return { jobId, mode: "auto" as const, status: "completed" as const, currentStep: "review" as const, niche: "news-europe", createdAt: now, updatedAt: now };
}

// A minimal fake standing in for youtube_v3.Youtube — same shape as
// e2e-youtube-uploader.mts's. Real quota / a real publish are the reason a
// fake client is the only honest way to test this at all.
function makeFakeYoutubeClient(videoId: string) {
  const calls = { videosInsert: [] as unknown[], thumbnailsSet: [] as unknown[] };
  const client = {
    videos: { insert: async (params: unknown) => (calls.videosInsert.push(params), { data: { id: videoId } }) },
    thumbnails: { set: async (params: unknown) => (calls.thumbnailsSet.push(params), { data: {} }) },
    playlistItems: { insert: async () => ({ data: {} }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

async function seedJob(store: import("@ai-news/shared").JobStore, jobId: string, videoPath: string, thumbPath: string, clipPaths: Record<string, string>) {
  await Promise.all([
    store.putJson(store.jobKey(jobId, "job.json"), jobManifestFor(jobId)),
    store.putJson(store.jobKey(jobId, "script.json"), scriptFor(jobId)),
    store.putJson(store.jobKey(jobId, "segment-timing.json"), segmentTimingFor(jobId)),
    store.putJson(store.jobKey(jobId, "media/media-manifest.json"), mediaManifestFor(jobId)),
    store.putJson(store.jobKey(jobId, "theme.json"), { themeId: "midnight-wire" }),
    store.putJson(store.jobKey(jobId, "voice.json"), { voiceId: "kokoro-bf-emma" }),
    store.putJson(store.jobKey(jobId, "metadata.json"), metadataFor(jobId)),
    store.putFile(store.jobKey(jobId, "render.mp4"), videoPath, "video/mp4"),
    store.putFile(store.jobKey(jobId, "thumbnail.png"), thumbPath, "image/png"),
    ...Object.entries(clipPaths).map(([file, path]) => store.putFile(store.jobKey(jobId, `media/${file}`), path, "video/mp4")),
  ]);
  // Deliberately NO review-state.json yet — a freshly-parked job has none.
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-dashboard-s3-"));
  const work = await mkdtemp(join(tmpdir(), "e2e-dashboard-work-"));
  const server = new S3rver({ port: S3_PORT, address: "localhost", silent: true, directory: dataDir, configureBuckets: [{ name: BUCKET, configs: [] }] });
  await server.run();
  console.log(`s3rver (R2 stand-in) on :${S3_PORT}`);

  let dashboardApp: import("fastify").FastifyInstance | undefined;
  try {
    const { JobStore, reviewStateSchema } = await import("@ai-news/shared");
    const { buildServer } = await import("../apps/review-dashboard/server/src/server.ts");
    const { runYoutubeUpload } = await import("../services/youtube-uploader/src/index.ts");

    const store = JobStore.fromEnv();

    const videoPath = join(work, "fixture-render.mp4");
    await generateColorClip("blue", 3, 30, 320, 180, videoPath);
    const thumbPath = join(work, "fixture-thumbnail.png");
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=1280x720", "-frames:v", "1", "-y", thumbPath]);

    const clipPaths: Record<string, string> = {};
    for (const file of ["clip-0.mp4", "clip-0-alt1.mp4", "clip-1.mp4", "clip-1-alt1.mp4"]) {
      const p = join(work, file);
      await generateColorClip("green", 10, 30, 160, 90, p);
      clipPaths[file] = p;
    }
    console.log(`Generated real fixtures: render.mp4, thumbnail.png, 4 clip files\n`);

    await seedJob(store, JOB_APPROVE, videoPath, thumbPath, clipPaths);
    await seedJob(store, JOB_REJECT, videoPath, thumbPath, clipPaths);

    dashboardApp = buildServer(store);
    await dashboardApp.listen({ port: DASHBOARD_PORT, host: "127.0.0.1" });
    console.log(`review-dashboard server listening on ${BASE_URL}\n`);

    // ── list + detail ────────────────────────────────────────────────────
    const jobsRes = await fetch(`${BASE_URL}/api/jobs`);
    const jobsBody = (await jobsRes.json()) as { jobs: Array<{ jobId: string }> };
    check("GET /api/jobs lists both seeded jobs", jobsBody.jobs.some((j) => j.jobId === JOB_APPROVE) && jobsBody.jobs.some((j) => j.jobId === JOB_REJECT), `${jobsBody.jobs.length} jobs listed`);

    const detailRes = await fetch(`${BASE_URL}/api/jobs/${JOB_APPROVE}`);
    const detail = await detailRes.json();
    check("GET /api/jobs/:jobId returns 200", detailRes.status === 200, `${detailRes.status}`);
    check("job detail carries the real title from script.json", detail.title === scriptFor(JOB_APPROVE).title, detail.title);
    check("job detail has both segments", detail.segments.length === 2, `${detail.segments.length} segments`);
    check("segment 0's current clip is its own primary before any override", detail.segments[0].currentClip.file === "clip-0.mp4", detail.segments[0].currentClip.file);
    check("segment 0 offers its alternative for swapping", detail.segments[0].alternatives.some((a: { file: string }) => a.file === "clip-0-alt1.mp4"), JSON.stringify(detail.segments[0].alternatives));
    check("a fresh job with no review-state.json defaults to awaiting-review", detail.reviewState.status === "awaiting-review", detail.reviewState.status);

    // ── presigned URLs actually work, not just well-formed ──────────────
    const renderFetch = await fetch(detail.renderUrl);
    const renderBytes = await renderFetch.arrayBuffer();
    const realVideoStat = await stat(videoPath);
    check("the presigned render.mp4 URL actually fetches the real file", renderFetch.status === 200 && renderBytes.byteLength === realVideoStat.size, `${renderFetch.status}, ${renderBytes.byteLength}B vs ${realVideoStat.size}B on disk`);

    // ── themes + voices catalogs ─────────────────────────────────────────
    const themesBody = (await (await fetch(`${BASE_URL}/api/themes`)).json()) as { themes: Array<{ id: string }> };
    check("theme catalog has all 18 themes", themesBody.themes.length === 18, `${themesBody.themes.length} themes`);
    const voicesBody = (await (await fetch(`${BASE_URL}/api/voices`)).json()) as { voices: Array<{ id: string; hasSample: boolean }> };
    check("voice catalog has all 10 voices", voicesBody.voices.length === 10, `${voicesBody.voices.length} voices`);
    check("at least one voice has a real preview sample on disk", voicesBody.voices.some((v) => v.hasSample), JSON.stringify(voicesBody.voices.map((v) => `${v.id}:${v.hasSample}`)));

    // ── clip swap, style patch, theme patch — persisted for real ────────
    const swapRes = await fetch(`${BASE_URL}/api/jobs/${JOB_APPROVE}/clip-override`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId: 0, file: "clip-0-alt1.mp4" }),
    });
    check("PUT clip-override returns 200", swapRes.status === 200, `${swapRes.status}`);

    const afterSwap = await (await fetch(`${BASE_URL}/api/jobs/${JOB_APPROVE}`)).json();
    check("after the swap, segment 0's current clip is the alternative", afterSwap.segments[0].currentClip.file === "clip-0-alt1.mp4", afterSwap.segments[0].currentClip.file);
    check("the displaced original clip rejoins the alternatives list", afterSwap.segments[0].alternatives.some((a: { file: string }) => a.file === "clip-0.mp4"), JSON.stringify(afterSwap.segments[0].alternatives));

    await fetch(`${BASE_URL}/api/jobs/${JOB_APPROVE}/review-state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: "broadsheet", style: { ticker: { textColor: "#123456" } } }),
    });

    const persistedState = await store.getJson(store.jobKey(JOB_APPROVE, "review-state.json"), reviewStateSchema);
    check("the clip override is really in review-state.json on disk (bypassing the API)", persistedState.clipOverrides.some((o) => o.segmentId === 0 && o.file === "clip-0-alt1.mp4"), JSON.stringify(persistedState.clipOverrides));
    check("the theme override is really persisted", persistedState.themeId === "broadsheet", `${persistedState.themeId}`);
    check("the style override is really persisted", persistedState.style.ticker?.textColor === "#123456", JSON.stringify(persistedState.style));

    // ── the actual point of this feature: approve unblocks the uploader ──
    const { client: preApprovalClient, calls: preApprovalCalls } = makeFakeYoutubeClient("SHOULD-NOT-UPLOAD");
    let preApprovalThrew = false;
    try {
      await runYoutubeUpload(JOB_APPROVE, { client: preApprovalClient });
    } catch {
      preApprovalThrew = true;
    }
    check("BEFORE approval, the real youtube-uploader entry point refuses to run", preApprovalThrew, "threw as expected");
    check("no upload call was made before approval", preApprovalCalls.videosInsert.length === 0, `${preApprovalCalls.videosInsert.length} calls`);

    const approveRes = await fetch(`${BASE_URL}/api/jobs/${JOB_APPROVE}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewedBy: "e2e-test" }),
    });
    const approveBody = await approveRes.json();
    check("POST /approve returns 200 with status approved", approveRes.status === 200 && approveBody.status === "approved", JSON.stringify(approveBody));

    const approvedState = await store.getJson(store.jobKey(JOB_APPROVE, "review-state.json"), reviewStateSchema);
    check("review-state.json on disk really flipped to approved", approvedState.status === "approved", approvedState.status);
    check("reviewedBy was recorded", approvedState.reviewedBy === "e2e-test", `${approvedState.reviewedBy}`);

    const { client: postApprovalClient, calls: postApprovalCalls } = makeFakeYoutubeClient("realUploadedId456");
    await runYoutubeUpload(JOB_APPROVE, { client: postApprovalClient });
    check("AFTER approval, the SAME real youtube-uploader entry point now succeeds", postApprovalCalls.videosInsert.length === 1, `${postApprovalCalls.videosInsert.length} videos.insert calls`);

    const { youtubeResultSchema } = await import("@ai-news/shared");
    const uploadResult = await store.getJsonIfExists(store.jobKey(JOB_APPROVE, "youtube-result.json"), youtubeResultSchema);
    check("youtube-result.json was written with the real fake-client video id", uploadResult?.videoId === "realUploadedId456", `${uploadResult?.videoId}`);
    check("upload status is uploaded", uploadResult?.status === "uploaded", `${uploadResult?.status}`);

    // ── reject: gate stays shut ──────────────────────────────────────────
    const rejectRes = await fetch(`${BASE_URL}/api/jobs/${JOB_REJECT}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const rejectBody = await rejectRes.json();
    check("POST /reject returns 200 with status rejected", rejectRes.status === 200 && rejectBody.status === "rejected", JSON.stringify(rejectBody));

    const { client: rejectedClient, calls: rejectedCalls } = makeFakeYoutubeClient("SHOULD-NOT-UPLOAD");
    let rejectedThrew = false;
    try {
      await runYoutubeUpload(JOB_REJECT, { client: rejectedClient });
    } catch {
      rejectedThrew = true;
    }
    check("a rejected job's upload attempt still throws", rejectedThrew, "threw as expected");
    check("no upload call was made for the rejected job", rejectedCalls.videosInsert.length === 0, `${rejectedCalls.videosInsert.length} calls`);

    console.log("");
    console.log(
      failures === 0
        ? "E2E PASSED: the real dashboard API's approve action genuinely unblocks the real youtube-uploader entry point; reject genuinely keeps it blocked."
        : `${failures} failure(s)`,
    );
  } finally {
    await dashboardApp?.close();
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
