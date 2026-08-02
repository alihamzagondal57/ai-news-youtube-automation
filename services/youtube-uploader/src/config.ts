import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

type PrivacyStatus = "private" | "public" | "unlisted";

function resolvePrivacyStatus(): PrivacyStatus {
  const raw = (process.env.YOUTUBE_PRIVACY_STATUS ?? "private").trim();
  if (raw !== "private" && raw !== "public" && raw !== "unlisted") {
    throw new Error(`YOUTUBE_PRIVACY_STATUS must be "private", "public", or "unlisted" — got "${raw}"`);
  }
  return raw;
}

export const config = {
  clientId: requireEnv("YOUTUBE_CLIENT_ID"),
  clientSecret: requireEnv("YOUTUBE_CLIENT_SECRET"),
  refreshToken: requireEnv("YOUTUBE_REFRESH_TOKEN"),

  /** "News & Politics" — the right default for this channel's content; override per deployment if the channel ever covers something else. */
  categoryId: process.env.YOUTUBE_CATEGORY_ID ?? "25",

  /**
   * Used only when publishAt is unset. Defaults to "private" — upload is a
   * deliberate, explicit act in this pipeline, not a side effect of a review
   * approval; publishing (or scheduling) is a separate operator choice.
   */
  defaultPrivacyStatus: resolvePrivacyStatus(),

  /**
   * RFC3339 timestamp. When set, the video uploads as "private" with this
   * scheduled publish time regardless of defaultPrivacyStatus — YouTube
   * requires privacyStatus "private" for a scheduled publish and auto-publishes
   * the video itself once the time passes.
   */
  publishAt: process.env.YOUTUBE_PUBLISH_AT || null,

  /**
   * Optional custom playlist beyond the channel's own "Uploads" playlist,
   * which YouTube populates automatically on every upload with no extra API
   * call. Unset skips this step entirely rather than erroring.
   */
  playlistId: process.env.YOUTUBE_PLAYLIST_ID || null,
};
