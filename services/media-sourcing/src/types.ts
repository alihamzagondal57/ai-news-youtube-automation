/** A stock video result, normalized to a common shape regardless of provider. */
export interface Candidate {
  provider: "pexels" | "pixabay";
  /** The provider's own id, as a string. Combined with `provider` as the dedupe key. */
  id: string;
  /** The asset's page on the provider's site — stored as the license record's proof-of-sourcing URL. */
  pageUrl: string;
  previewImage: string;
  /** Dimensions of the chosen download rendition (not necessarily the asset's largest available). */
  width: number;
  height: number;
  durationSeconds: number;
  downloadUrl: string;
  fileSizeBytes: number;
  /** Lowercased search-relevant text tokens: tags plus, for providers with sparse tagging, page-title words. */
  tags: string[];
  user: string;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  scoreBreakdown: { relevance: number; orientation: number; duration: number; resolution: number };
}

/** `${provider}:${id}` — the dedupe key used everywhere a candidate needs to be identified uniquely. */
export function assetKey(c: Pick<Candidate, "provider" | "id">): string {
  return `${c.provider}:${c.id}`;
}
