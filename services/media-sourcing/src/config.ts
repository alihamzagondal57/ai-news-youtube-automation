import "dotenv/config";

export const config = {
  /** Results requested per provider per segment, before ranking/dedupe. */
  perPageSearch: Number(process.env.MEDIA_SEARCH_PER_PAGE ?? 8),

  /**
   * Alternatives stored per segment, beyond the selected clip — so each
   * segment ships 1 primary + N alternatives (5 total at the default). The
   * review dashboard's clip-swap applies one of these instantly, with no live
   * re-query.
   */
  alternativesCount: Number(process.env.MEDIA_ALTERNATIVES_COUNT ?? 4),

  /**
   * Floor used when a segment carries no duration estimate. Below this, a clip
   * is barely usable as a held background shot.
   */
  minCandidateDurationSeconds: Number(process.env.MEDIA_MIN_DURATION_SECONDS ?? 4),

  /**
   * Preferred rendition width. render composites at up to 4K via objectFit:cover
   * (see .smoke-test/smoke-test-4k.mts), and stock footage is rarely native 4K
   * anyway, so 1080p is the right ceiling: matches production reality without
   * paying 4x the bandwidth for headroom the render never uses natively.
   */
  targetWidth: 1920,

  /**
   * Two videos from the same uploader are treated as near-duplicates when their
   * tag sets overlap at least this much (Jaccard similarity). Stock sites
   * commonly have one videographer upload a burst of near-identical takes of
   * the same subject; exact-id dedupe alone misses those.
   */
  nearDuplicateTagOverlap: Number(process.env.MEDIA_NEAR_DUPLICATE_OVERLAP ?? 0.6),
} as const;

export function requireApiKey(envVar: "PEXELS_API_KEY" | "PIXABAY_API_KEY"): string {
  const key = process.env[envVar];
  if (!key) {
    throw new Error(`${envVar} is not set. media-sourcing needs both Pexels and Pixabay keys — see .env.example.`);
  }
  return key;
}
