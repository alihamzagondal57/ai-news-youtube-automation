import { createReadStream } from "node:fs";
import type { youtube_v3 } from "googleapis";
import { config } from "./config.js";

export interface UploadVideoOptions {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  /** Mapped straight onto status.containsSyntheticMedia — see docs/PIPELINE.md's synthetic-content disclosure section. Never omitted. */
  containsSyntheticMedia: boolean;
}

export interface UploadVideoResult {
  videoId: string;
  /** The exact status resolveVideoStatus() sent — reused by assertVideoState() to re-check the same target after upload. */
  status: youtube_v3.Schema$VideoStatus;
}

export interface ResolveVideoStatusOptions {
  containsSyntheticMedia: boolean;
  defaultPrivacyStatus: "private" | "public" | "unlisted";
  /** RFC3339 timestamp, or null for immediate (non-scheduled) publish. */
  publishAt: string | null;
}

/**
 * Pure: no env reads, no network — split out from uploadVideo so the
 * publishAt-forces-"private" rule is unit-testable without a real config or
 * YouTube client.
 */
export function resolveVideoStatus(options: ResolveVideoStatusOptions): youtube_v3.Schema$VideoStatus {
  const { containsSyntheticMedia, defaultPrivacyStatus, publishAt } = options;
  const status: youtube_v3.Schema$VideoStatus = {
    // YouTube requires "private" for a scheduled publish, regardless of the configured default.
    privacyStatus: publishAt ? "private" : defaultPrivacyStatus,
    containsSyntheticMedia,
  };
  if (publishAt) {
    status.publishAt = publishAt;
  }
  return status;
}

// Google's resumable-upload protocol (chunked PUT, resumable-on-drop) was
// tried here first, matching https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// exactly (endpoint, headers, part-param format, MIME type all verified
// against the docs) — but this account/API-project consistently gets a 401
// "youtubeSignupRequired" specifically on uploadType=resumable session init,
// while the identical credentials succeed on uploadType=multipart. Root
// cause not identified (not a scope, endpoint, or header issue — all ruled
// out); multipart is the confirmed-working path, so failures are handled
// with whole-file retry instead of hand-rolled chunked resume.
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EPIPE", "UND_ERR_SOCKET", "ENOTFOUND", "EAI_AGAIN"]);
const MAX_UPLOAD_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadVideo(client: youtube_v3.Youtube, options: UploadVideoOptions): Promise<UploadVideoResult> {
  const { videoPath, title, description, tags, containsSyntheticMedia } = options;

  const status = resolveVideoStatus({
    containsSyntheticMedia,
    defaultPrivacyStatus: config.defaultPrivacyStatus,
    publishAt: config.publishAt,
  });

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await client.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description, tags, categoryId: config.categoryId },
          status,
        },
        media: { body: createReadStream(videoPath) },
      });

      const videoId = response.data.id;
      if (!videoId) {
        throw new Error("YouTube videos.insert did not return a video id");
      }
      return { videoId, status };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const retryable = typeof code === "string" && RETRYABLE_CODES.has(code);
      if (!retryable || attempt === MAX_UPLOAD_ATTEMPTS) {
        throw err;
      }
      // Multipart has no resume — a dropped connection means the whole file
      // re-sends on retry, so back off to give a flaky connection room to recover.
      await sleep(attempt * 5000);
    }
  }
  throw new Error("YouTube upload retry loop ended without a video id");
}

export interface AssertVideoStateResult {
  /** How many corrective videos.update calls were needed, incl. the mandatory first one — 0 would mean the assertion was skipped, which never happens. */
  correctionsApplied: number;
  /** How many videos.list calls the settle loop made — for quota accounting. */
  listCallsMade: number;
}

const SETTLE_CHECKS = 4;
const SETTLE_DELAY_MS = 20_000;

/**
 * Re-asserts the upload's requested status after the fact and watches it for
 * drift over a short settle window, force-correcting if it moves.
 *
 * Two real failure modes observed against the live API prompted this:
 *  1. status.containsSyntheticMedia sent at insert time does not reliably
 *     stick, AND does not reliably round-trip through videos.list even when
 *     the write did succeed — so this is verified via the update() call's
 *     own synchronous response (Google's direct write-confirmation), never
 *     via a follow-up read.
 *  2. A video uploaded as "unlisted" with no publishAt requested picked up
 *     an unrequested publishAt a few minutes after upload and briefly went
 *     public on its own — YouTube's own backend, not this codebase, set
 *     that schedule (confirmed: no code path here ever sends publishAt
 *     unless YOUTUBE_PUBLISH_AT is configured). The settle loop catches and
 *     reverts this if it recurs.
 */
export interface AssertVideoStateOverrides {
  /** Overridable for testing the drift-correction path without a multi-minute real wait. */
  settleChecks?: number;
  settleDelayMs?: number;
}

export async function assertVideoState(
  client: youtube_v3.Youtube,
  videoId: string,
  expected: youtube_v3.Schema$VideoStatus,
  overrides: AssertVideoStateOverrides = {},
): Promise<AssertVideoStateResult> {
  const settleChecks = overrides.settleChecks ?? SETTLE_CHECKS;
  const settleDelayMs = overrides.settleDelayMs ?? SETTLE_DELAY_MS;
  let correctionsApplied = 0;
  let listCallsMade = 0;

  const reassert = async (): Promise<void> => {
    const res = await client.videos.update({
      part: ["status"],
      requestBody: { id: videoId, status: expected },
    });
    correctionsApplied++;
    const got = res.data.status;
    if (got?.privacyStatus !== expected.privacyStatus || got?.containsSyntheticMedia !== expected.containsSyntheticMedia) {
      throw new Error(
        `YouTube videos.update did not confirm the requested state for ${videoId}: sent ${JSON.stringify(expected)}, got back ${JSON.stringify(got)}`,
      );
    }
  };

  // Always re-assert once immediately — containsSyntheticMedia at insert
  // time isn't reliable enough to trust without this.
  await reassert();

  for (let i = 0; i < settleChecks; i++) {
    await sleep(settleDelayMs);
    const res = await client.videos.list({ part: ["status"], id: [videoId] });
    listCallsMade++;
    const live = res.data.items?.[0]?.status;
    const drifted = live?.privacyStatus !== expected.privacyStatus || (live?.publishAt ?? null) !== (expected.publishAt ?? null);
    if (drifted) {
      await reassert();
    }
  }

  return { correctionsApplied, listCallsMade };
}

export async function setThumbnail(client: youtube_v3.Youtube, videoId: string, thumbnailPath: string): Promise<void> {
  await client.thumbnails.set({ videoId, media: { body: createReadStream(thumbnailPath) } });
}

/** Beyond the channel's automatic "Uploads" playlist — see config.ts's playlistId doc comment. */
export async function addToPlaylist(client: youtube_v3.Youtube, videoId: string, playlistId: string): Promise<void> {
  await client.playlistItems.insert({
    part: ["snippet"],
    requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
  });
}
