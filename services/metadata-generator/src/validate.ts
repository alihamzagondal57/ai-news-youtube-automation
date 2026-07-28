import type { Chapter } from "@ai-news/shared";
import { formatChapterBlock } from "./chapters.js";
import type { GeneratedMetadata } from "./schema.js";

/**
 * YouTube's actual field constraints — distinct from (and stricter/differently
 * shaped than) the shared `metadataSchema`'s zod bounds, which cap ARRAY
 * LENGTH on `tags` (a generic sanity bound) rather than the real API rule:
 * tags are limited by their TOTAL comma-joined character count, not by count.
 */
export const YOUTUBE_TITLE_MAX_CHARS = 100;
export const YOUTUBE_DESCRIPTION_MAX_CHARS = 5000;
/** Real cap is 500; staying under 480 leaves slack for the exact comma-joining YouTube does server-side. */
export const YOUTUBE_TAGS_MAX_COMBINED_CHARS = 480;
/** Not a hard YouTube limit — only the first few hashtags in a description are "elevated" above the title, so more than this is just wasted. */
const HASHTAG_LIMIT = 8;

/**
 * Issues worth a corrective RETRY on the same provider — things the model
 * should simply write shorter/differently. Tag-list length and hashtag count
 * are NOT retry triggers: those are fixed deterministically in
 * `assembleMetadata` below, because trimming a list costs nothing and doesn't
 * need the model's judgment the way rewriting a title does.
 */
export function retryableIssues(generated: GeneratedMetadata): string[] {
  const issues: string[] = [];
  if (generated.title.length > YOUTUBE_TITLE_MAX_CHARS) {
    issues.push(`title is ${generated.title.length} characters, over the ${YOUTUBE_TITLE_MAX_CHARS}-character limit. Shorten it without losing the concrete news.`);
  }
  if (generated.title.trim().length === 0) {
    issues.push("title is empty.");
  }
  if (generated.description.trim().length === 0) {
    issues.push("description is empty.");
  }
  return issues;
}

export interface AssembledMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: Chapter[];
}

/**
 * Deterministically turns the LLM's creative fields plus the mechanically-
 * derived chapters into the exact strings that will be uploaded — truncating
 * anything that still overflows YouTube's real limits, favoring keeping the
 * chapter block (parseable, load-bearing for the chapters feature) over the
 * tail of the free-text description.
 */
export function assembleMetadata(generated: GeneratedMetadata, chapters: Chapter[]): AssembledMetadata {
  const title = generated.title.trim().slice(0, YOUTUBE_TITLE_MAX_CHARS);

  const chapterBlock = formatChapterBlock(chapters);
  const separator = chapterBlock ? "\n\nChapters:\n" : "";
  const reservedForChapters = chapterBlock.length + separator.length;
  const maxBodyChars = Math.max(0, YOUTUBE_DESCRIPTION_MAX_CHARS - reservedForChapters);
  const body = generated.description.trim().slice(0, maxBodyChars);
  const description = `${body}${separator}${chapterBlock}`;

  const tags = trimToCombinedLength(
    generated.tags.map((t) => t.trim()).filter(Boolean),
    YOUTUBE_TAGS_MAX_COMBINED_CHARS,
  );

  const hashtags = generated.hashtags
    .map((h) => h.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, HASHTAG_LIMIT);

  return { title, description, tags, hashtags, chapters };
}

/** Drops tags from the end (the LLM's own least-important-first ordering) until the comma-joined total fits. */
function trimToCombinedLength(tags: string[], maxChars: number): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const tag of tags) {
    const added = kept.length === 0 ? tag.length : tag.length + 2; // ", "
    if (length + added > maxChars) break;
    kept.push(tag);
    length += added;
  }
  return kept;
}
