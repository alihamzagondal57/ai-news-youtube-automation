import type { Candidate, ScoredCandidate } from "./types.js";
import { assetKey } from "./types.js";
import { config } from "./config.js";

/** Cross-job usage history, outside any job's tree — mirrors the shape of theme/structure/voice rotation state. */
export const MEDIA_USAGE_KEY = "state/media-usage.json";

export interface MediaUsageState {
  /** Most recent first: `${provider}:${id}` keys. */
  recentAssetIds: string[];
}
export const EMPTY_MEDIA_USAGE: MediaUsageState = { recentAssetIds: [] };

/**
 * How many recently-used assets to soft-avoid channel-wide. Sized for roughly
 * the last ~20 videos at ~7 clips each (opening + body + outro), not a tight
 * "never repeat" window like the small theme/structure catalogs — the stock
 * libraries are enormous, so avoiding recent picks is about variety, not
 * physical exhaustion.
 */
export const MEDIA_USAGE_AVOID_WINDOW = 150;

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tag of setA) if (setB.has(tag)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Two results are near-duplicates when they're the same uploader on the same
 * provider with heavily overlapping tags — the common case of one videographer
 * uploading a burst of takes of the same subject, which exact-id dedupe alone
 * doesn't catch.
 */
export function isNearDuplicate(a: Candidate, b: Candidate): boolean {
  if (assetKey(a) === assetKey(b)) return true;
  if (a.provider !== b.provider) return false;
  if (!a.user || a.user !== b.user) return false;
  return jaccard(a.tags, b.tags) >= config.nearDuplicateTagOverlap;
}

/**
 * Picks a primary clip plus up to `alternativesCount` alternatives from a
 * ranked candidate pool, skipping anything that's an exact or near-duplicate of
 * something already picked THIS JOB (any earlier segment's primary or
 * alternative) or recently used CHANNEL-WIDE.
 *
 * The channel-wide exclusion degrades gracefully: if honoring it would leave
 * too few candidates for this segment, it's dropped rather than starving the
 * segment of alternatives — variety across videos matters less than a segment
 * actually having usable footage. Same-job duplication is never allowed to
 * degrade, since showing the identical clip twice in one video is a visible
 * defect, not a variety nice-to-have.
 */
export function selectForSegment(
  ranked: readonly ScoredCandidate[],
  pickedThisJob: readonly Candidate[],
  usage: MediaUsageState,
  count: number = config.alternativesCount + 1,
): ScoredCandidate[] {
  const recentSet = new Set(usage.recentAssetIds.slice(0, MEDIA_USAGE_AVOID_WINDOW));

  const withoutJobDuplicates = ranked.filter((c) => !pickedThisJob.some((p) => isNearDuplicate(c, p)));

  const strict = withoutJobDuplicates.filter((c) => !recentSet.has(assetKey(c)));
  const pool = strict.length >= count ? strict : withoutJobDuplicates;

  const selected: ScoredCandidate[] = [];
  for (const candidate of pool) {
    if (selected.length >= count) break;
    if (selected.some((s) => isNearDuplicate(candidate, s))) continue;
    selected.push(candidate);
  }
  return selected;
}

/** Folds this job's picks into the rolling channel-wide history, newest first, deduped, capped. */
export function recordUsage(state: MediaUsageState, usedKeys: readonly string[]): MediaUsageState {
  const merged = [...usedKeys, ...state.recentAssetIds];
  const deduped = merged.filter((key, i) => merged.indexOf(key) === i);
  return { recentAssetIds: deduped.slice(0, MEDIA_USAGE_AVOID_WINDOW * 2) };
}
