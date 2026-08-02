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

/**
 * The actual resumable-upload mechanics (chunked transport, retry-on-drop)
 * are handled inside googleapis/google-auth-library when given a stream
 * body — not hand-rolled here.
 */
export async function uploadVideo(client: youtube_v3.Youtube, options: UploadVideoOptions): Promise<UploadVideoResult> {
  const { videoPath, title, description, tags, containsSyntheticMedia } = options;

  const status = resolveVideoStatus({
    containsSyntheticMedia,
    defaultPrivacyStatus: config.defaultPrivacyStatus,
    publishAt: config.publishAt,
  });

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
  return { videoId };
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
