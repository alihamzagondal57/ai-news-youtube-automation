import type { MediaLicense } from "@ai-news/shared";
import type { Candidate } from "./types.js";

/**
 * Both licenses were verified for commercial/monetized use in docs/LICENSING.md
 * — free for commercial use, no attribution required. That doc also records
 * what the license does NOT clear (identifiable people, logos/trademarks,
 * standalone redistribution), which is an editorial constraint on which footage
 * to select, not something encodable in a per-asset record.
 */
const LICENSE_TEXT = {
  pexels: "Pexels License — free for commercial use, no attribution required",
  pixabay: "Pixabay Content License — free for commercial use, no attribution required",
} as const;

/** The asset's own page is the proof-of-sourcing URL — kept permanently, per media-manifest.json's role as a copyright-safety record. */
export function licenseFor(candidate: Candidate): MediaLicense {
  return {
    source: candidate.provider,
    licenseType: LICENSE_TEXT[candidate.provider],
    url: candidate.pageUrl,
  };
}
