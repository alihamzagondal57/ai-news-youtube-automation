// END-TO-END test of the youtube-uploader SERVICE: uploads real render.mp4 /
// thumbnail.png fixtures (generated with ffmpeg, not stubs) + metadata.json +
// review-state.json to an in-process S3 store, runs the actual
// runYoutubeUpload() entry point with a FAKE, request-recording YouTube
// client injected in place of a real one, and asserts:
//
//   1. the review-gate rejection path (not "approved", or missing entirely)
//      refuses to upload at all — zero calls made to the client;
//   2. a full success builds the correct request bodies (title/description/
//      tags, containsSyntheticMedia, categoryId, privacyStatus), skips the
//      playlist call when unconfigured, and writes a correct
//      jobs/{jobId}/youtube-result.json;
//   3. a partial failure (video uploads, then thumbnails.set fails) still
//      writes youtube-result.json with the REAL quota already spent and an
//      error message, rather than losing that record; and
//   4. addToPlaylist builds the correct request shape when actually invoked.
//
// A fake client is the only honest way to test this: actually calling the
// real YouTube Data API here would spend real, non-refundable quota and
// publish a real video on a real channel — there is no "sandbox" YouTube.
import { rm, stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import S3rver from "s3rver";
import { ffmpegPath, generateColorClip } from "./lib/media.mts";

const execFileAsync = promisify(execFile);

const S3_PORT = 4582;
const BUCKET = "ai-news-pipeline";

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

// Dummy — config.ts requires these to be SET, but a fake client means they're
// never actually used to authenticate against Google.
process.env.YOUTUBE_CLIENT_ID = "e2e-client-id";
process.env.YOUTUBE_CLIENT_SECRET = "e2e-client-secret";
process.env.YOUTUBE_REFRESH_TOKEN = "e2e-refresh-token";
// Deliberately left unset for this whole process (see the file header):
// proves the "no playlist configured" skip branch. addToPlaylist's own
// request-building is checked directly, further down, bypassing config.

const JOB_SUCCESS = "99999999-1111-1111-1111-999999999999";
const JOB_REJECTED = "99999999-2222-2222-2222-999999999999";
const JOB_MISSING_REVIEW = "99999999-3333-3333-3333-999999999999";
const JOB_PARTIAL_FAILURE = "99999999-4444-4444-4444-999999999999";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
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

function approvedReviewState(jobId: string) {
  return { jobId, status: "approved", updatedAt: new Date().toISOString() };
}

// A minimal fake standing in for youtube_v3.Youtube — just the three methods
// this service actually calls, each recording its own requestBody.
function makeFakeYoutubeClient(options: { videoId: string; failThumbnail?: boolean }) {
  const calls = {
    videosInsert: [] as unknown[],
    thumbnailsSet: [] as unknown[],
    playlistItemsInsert: [] as unknown[],
  };
  const client = {
    videos: {
      insert: async (params: unknown) => {
        calls.videosInsert.push(params);
        return { data: { id: options.videoId } };
      },
    },
    thumbnails: {
      set: async (params: unknown) => {
        calls.thumbnailsSet.push(params);
        if (options.failThumbnail) {
          throw new Error("simulated thumbnails.set failure");
        }
        return { data: {} };
      },
    },
    playlistItems: {
      insert: async (params: unknown) => {
        calls.playlistItemsInsert.push(params);
        return { data: {} };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-youtube-s3-"));
  const work = await mkdtemp(join(tmpdir(), "e2e-youtube-work-"));
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
    const { JobStore, youtubeResultSchema } = await import("@ai-news/shared");
    const { runYoutubeUpload } = await import("../services/youtube-uploader/src/index.ts");
    const { addToPlaylist } = await import("../services/youtube-uploader/src/youtube.ts");

    const store = JobStore.fromEnv();

    // Real fixture media, not empty stubs — proves the download+stream path.
    const videoPath = join(work, "fixture-render.mp4");
    await generateColorClip("blue", 3, 30, 320, 180, videoPath);
    const thumbPath = join(work, "fixture-thumbnail.png");
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=1280x720",
      "-frames:v", "1", "-y", thumbPath,
    ]);
    const videoStats = await stat(videoPath);
    const thumbStats = await stat(thumbPath);
    console.log(`Generated real fixtures: render.mp4 (${videoStats.size}B), thumbnail.png (${thumbStats.size}B)\n`);

    // ── Case 1: review gate rejects a non-approved job ───────────────────────
    await store.putJson(store.jobKey(JOB_REJECTED, "review-state.json"), {
      jobId: JOB_REJECTED,
      status: "awaiting-review",
      updatedAt: new Date().toISOString(),
    });
    const { client: rejectedClient, calls: rejectedCalls } = makeFakeYoutubeClient({ videoId: "SHOULD-NOT-UPLOAD" });
    let rejectedThrew = false;
    let rejectedMessage = "";
    try {
      await runYoutubeUpload(JOB_REJECTED, { client: rejectedClient });
    } catch (err) {
      rejectedThrew = true;
      rejectedMessage = err instanceof Error ? err.message : String(err);
    }
    check("an unapproved job's upload attempt throws", rejectedThrew, rejectedMessage);
    check("the rejection message names the actual review status", rejectedMessage.includes("awaiting-review"), rejectedMessage);
    check("no videos.insert call was made for an unapproved job", rejectedCalls.videosInsert.length === 0, `${rejectedCalls.videosInsert.length} calls`);
    const rejectedResult = await store.getJsonIfExists(store.jobKey(JOB_REJECTED, "youtube-result.json"), youtubeResultSchema);
    check("no youtube-result.json is written for a rejected job", rejectedResult === null, rejectedResult ? "unexpectedly present" : "absent, as expected");

    // ── Case 2: review gate rejects a job with NO review-state.json at all ───
    const { client: missingClient, calls: missingCalls } = makeFakeYoutubeClient({ videoId: "SHOULD-NOT-UPLOAD" });
    let missingThrew = false;
    let missingMessage = "";
    try {
      await runYoutubeUpload(JOB_MISSING_REVIEW, { client: missingClient });
    } catch (err) {
      missingThrew = true;
      missingMessage = err instanceof Error ? err.message : String(err);
    }
    check("a job with no review-state.json at all also throws rather than uploading", missingThrew, missingMessage);
    check('the message reports "MISSING" rather than crashing on a null review status', missingMessage.includes("MISSING"), missingMessage);
    check("no videos.insert call was made either", missingCalls.videosInsert.length === 0, `${missingCalls.videosInsert.length} calls`);

    // ── Case 3: full success ──────────────────────────────────────────────────
    await store.putJson(store.jobKey(JOB_SUCCESS, "metadata.json"), metadataFor(JOB_SUCCESS));
    await store.putJson(store.jobKey(JOB_SUCCESS, "review-state.json"), approvedReviewState(JOB_SUCCESS));
    await store.putFile(store.jobKey(JOB_SUCCESS, "render.mp4"), videoPath, "video/mp4");
    await store.putFile(store.jobKey(JOB_SUCCESS, "thumbnail.png"), thumbPath, "image/png");

    const { client: successClient, calls: successCalls } = makeFakeYoutubeClient({ videoId: "fakeVideoId123" });
    await runYoutubeUpload(JOB_SUCCESS, { client: successClient });

    check("videos.insert was called exactly once", successCalls.videosInsert.length === 1, `${successCalls.videosInsert.length} calls`);
    const insertParams = successCalls.videosInsert[0] as {
      requestBody: { snippet: { title: string; tags: string[]; categoryId: string }; status: { containsSyntheticMedia: boolean; privacyStatus: string } };
    };
    check("the request carries the real title from metadata.json", insertParams.requestBody.snippet.title === metadataFor(JOB_SUCCESS).title, insertParams.requestBody.snippet.title);
    check("the request carries the real tags from metadata.json", JSON.stringify(insertParams.requestBody.snippet.tags) === JSON.stringify(metadataFor(JOB_SUCCESS).tags), insertParams.requestBody.snippet.tags.join(","));
    check("categoryId defaults to News & Politics (25)", insertParams.requestBody.snippet.categoryId === "25", insertParams.requestBody.snippet.categoryId);
    check(
      "the mandatory synthetic-content disclosure is set on the request, not silently dropped",
      insertParams.requestBody.status.containsSyntheticMedia === true,
      `${insertParams.requestBody.status.containsSyntheticMedia}`,
    );
    check('defaults to privacyStatus "private" (upload is deliberate, not auto-publish)', insertParams.requestBody.status.privacyStatus === "private", insertParams.requestBody.status.privacyStatus);

    check("thumbnails.set was called exactly once", successCalls.thumbnailsSet.length === 1, `${successCalls.thumbnailsSet.length} calls`);
    const thumbParams = successCalls.thumbnailsSet[0] as { videoId: string };
    check("the thumbnail is set on the SAME video id videos.insert returned", thumbParams.videoId === "fakeVideoId123", thumbParams.videoId);

    check("playlistItems.insert is skipped when no playlist is configured", successCalls.playlistItemsInsert.length === 0, `${successCalls.playlistItemsInsert.length} calls`);

    const successResult = await store.getJsonIfExists(store.jobKey(JOB_SUCCESS, "youtube-result.json"), youtubeResultSchema);
    check("youtube-result.json was written and satisfies youtubeResultSchema", successResult !== null, successResult ? "parsed" : "MISSING or invalid");
    if (successResult) {
      check("status is uploaded", successResult.status === "uploaded", successResult.status);
      check("videoId matches what the client returned", successResult.videoId === "fakeVideoId123", `${successResult.videoId}`);
      check("url is a real watch URL for that video id", successResult.url === "https://www.youtube.com/watch?v=fakeVideoId123", `${successResult.url}`);
      check(
        "quotaUnitsUsed is exactly videos.insert + thumbnails.set (no playlist call made)",
        successResult.quotaUnitsUsed === 1650,
        `${successResult.quotaUnitsUsed}`,
      );
      check("error is null on success", successResult.error === null, `${successResult.error}`);
    }

    // ── Case 4: partial failure — video uploads, thumbnail set then fails ────
    await store.putJson(store.jobKey(JOB_PARTIAL_FAILURE, "metadata.json"), metadataFor(JOB_PARTIAL_FAILURE));
    await store.putJson(store.jobKey(JOB_PARTIAL_FAILURE, "review-state.json"), approvedReviewState(JOB_PARTIAL_FAILURE));
    await store.putFile(store.jobKey(JOB_PARTIAL_FAILURE, "render.mp4"), videoPath, "video/mp4");
    await store.putFile(store.jobKey(JOB_PARTIAL_FAILURE, "thumbnail.png"), thumbPath, "image/png");

    const { client: partialClient, calls: partialCalls } = makeFakeYoutubeClient({ videoId: "partialFailId", failThumbnail: true });
    let partialThrew = false;
    try {
      await runYoutubeUpload(JOB_PARTIAL_FAILURE, { client: partialClient });
    } catch {
      partialThrew = true;
    }
    check("a mid-pipeline failure still propagates (the job is marked failed, not silently swallowed)", partialThrew, "threw as expected");
    check("videos.insert DID succeed before the failure", partialCalls.videosInsert.length === 1, `${partialCalls.videosInsert.length} calls`);
    check("thumbnails.set WAS attempted (and failed)", partialCalls.thumbnailsSet.length === 1, `${partialCalls.thumbnailsSet.length} calls`);

    const partialResult = await store.getJsonIfExists(store.jobKey(JOB_PARTIAL_FAILURE, "youtube-result.json"), youtubeResultSchema);
    check("a failed run STILL writes youtube-result.json rather than losing the record", partialResult !== null, partialResult ? "parsed" : "MISSING");
    if (partialResult) {
      check("status is failed", partialResult.status === "failed", partialResult.status);
      check("videoId/url are null on failure (never a stale/fake success value)", partialResult.videoId === null && partialResult.url === null, `videoId=${partialResult.videoId}, url=${partialResult.url}`);
      check(
        "quotaUnitsUsed reflects ONLY the videos.insert call that actually succeeded (real, non-refundable spend)",
        partialResult.quotaUnitsUsed === 1600,
        `${partialResult.quotaUnitsUsed}`,
      );
      check("error carries the real failure message", partialResult.error?.includes("simulated thumbnails.set failure") ?? false, `${partialResult.error}`);
    }

    // ── Case 5: addToPlaylist's own request shape (bypassing config) ────────
    const { client: playlistClient, calls: playlistCalls } = makeFakeYoutubeClient({ videoId: "unused" });
    await addToPlaylist(playlistClient, "someVideoId", "PLexampleplaylist");
    check("addToPlaylist calls playlistItems.insert exactly once", playlistCalls.playlistItemsInsert.length === 1, `${playlistCalls.playlistItemsInsert.length} calls`);
    const playlistParams = playlistCalls.playlistItemsInsert[0] as { requestBody: { snippet: { playlistId: string; resourceId: { kind: string; videoId: string } } } };
    check(
      "the request references the right playlist and video via resourceId",
      playlistParams.requestBody.snippet.playlistId === "PLexampleplaylist" &&
        playlistParams.requestBody.snippet.resourceId.kind === "youtube#video" &&
        playlistParams.requestBody.snippet.resourceId.videoId === "someVideoId",
      JSON.stringify(playlistParams.requestBody.snippet),
    );

    console.log("");
    console.log(
      failures === 0
        ? "E2E PASSED: review-gate + upload + thumbnail + playlist + quota accounting, via the live service with a fake YouTube client."
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
