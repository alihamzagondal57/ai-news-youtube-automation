import type { Candidate, ScoredCandidate } from "./types.js";

/**
 * Relevance dominates the score (0.55) because an off-topic clip is useless
 * regardless of how well-formed it is. Duration matters more than usual for
 * stock footage (0.2, not the ~0.1 a generic ranker might give it): the
 * render composites each clip as a static full-segment background with no
 * looping (`remotion/src/components/media/SegmentBackground.tsx`), so a clip
 * shorter than its segment freezes on its last frame for the remainder —
 * a visible defect, not just a minor quality gap.
 */
const WEIGHTS = { relevance: 0.55, orientation: 0.15, duration: 0.2, resolution: 0.1 };

/** Combined lowercase text a query can match against. */
function haystack(candidate: Candidate): string {
  return candidate.tags.join(" ").toLowerCase();
}

export function scoreCandidate(candidate: Candidate, keywords: string[], minDurationSeconds: number): ScoredCandidate {
  const text = haystack(candidate);
  const matched = keywords.filter((k) => text.includes(k));
  // No keywords extracted (a very short visualCue) shouldn't zero out every
  // candidate — fall back to a neutral relevance so orientation/duration/
  // resolution still differentiate them.
  const relevance = keywords.length > 0 ? matched.length / keywords.length : 0.5;

  const orientation = candidate.width > candidate.height ? 1 : candidate.width === candidate.height ? 0.5 : 0;

  const duration =
    candidate.durationSeconds >= minDurationSeconds
      ? 1
      : Math.max(0, candidate.durationSeconds / minDurationSeconds);

  const resolution = candidate.width >= 1920 ? 1 : candidate.width >= 1280 ? 0.7 : candidate.width >= 960 ? 0.4 : 0.2;

  const score =
    relevance * WEIGHTS.relevance +
    orientation * WEIGHTS.orientation +
    duration * WEIGHTS.duration +
    resolution * WEIGHTS.resolution;

  return { ...candidate, score, scoreBreakdown: { relevance, orientation, duration, resolution } };
}

/** Highest-scoring first. Ties break toward the higher-resolution candidate, then Pexels before Pixabay (arbitrary but deterministic — makes tests reproducible). */
export function rankCandidates(candidates: Candidate[], keywords: string[], minDurationSeconds: number): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(c, keywords, minDurationSeconds))
    .sort((a, b) => b.score - a.score || b.width - a.width || a.provider.localeCompare(b.provider));
}
