/**
 * YouTube Data API v3's fixed, documented per-call costs (Google's quota
 * calculator) — not configurable, not measured. The actual bill for a job is
 * exactly the sum of whichever of these calls it makes. A default project
 * gets 10,000 units/day, so videos.insert alone caps uploads at ~6/day.
 */
export const QUOTA_COSTS = {
  videosInsert: 1600,
  thumbnailsSet: 50,
  playlistItemsInsert: 50,
} as const;
