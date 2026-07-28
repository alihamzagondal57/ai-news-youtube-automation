import type { Chapter, Script, SegmentTiming } from "@ai-news/shared";

/**
 * Chapters are derived mechanically from `segment-timing.json`, not written by
 * the LLM: they're a direct mapping of real, already-known data (each
 * segment's headline and start time), and getting the format right is a
 * YouTube parsing rule, not a creative-writing task. Keeping them out of the
 * LLM call also keeps that call's JSON small and its failure modes structural
 * rather than creative.
 */

/** YouTube only registers a chapter as separate from the previous one if they're at least this far apart. */
const MIN_CHAPTER_GAP_SECONDS = 10;

/** YouTube requires at least this many chapters, with the first at 0:00, to render them at all. */
export const MIN_CHAPTERS_TO_RENDER = 3;

export function buildChapters(script: Script, timing: SegmentTiming): Chapter[] {
  const timingById = new Map(timing.segments.map((s) => [s.id, s]));
  const chapters: Chapter[] = [];

  for (const segment of script.segments) {
    const t = timingById.get(segment.id);
    if (!t) {
      throw new Error(`No segment-timing entry for segment ${segment.id} (job ${script.jobId})`);
    }
    const title = segment.headline.trim();
    if (!title) continue; // no on-screen label to chapter against

    const startSeconds = Math.floor(t.startSeconds); // YouTube chapter timestamps are whole seconds
    const previous = chapters[chapters.length - 1];
    if (previous && startSeconds - previous.startSeconds < MIN_CHAPTER_GAP_SECONDS) {
      // Too close to the previous chapter to register as its own on YouTube;
      // the segment still exists in the video, just not as a separate marker.
      continue;
    }
    chapters.push({ title, startSeconds });
  }

  // Belt and suspenders: voiceover's own timing invariants already guarantee
  // the first segment starts at 0, but YouTube silently ignores the WHOLE
  // chapter list unless the first entry reads exactly 0:00.
  if (chapters.length > 0 && chapters[0].startSeconds !== 0) {
    chapters[0] = { ...chapters[0], startSeconds: 0 };
  }

  return chapters;
}

/** YouTube's own chapter-marker format: M:SS under an hour, H:MM:SS past one. */
export function formatTimestamp(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds);
  const s = whole % 60;
  const totalMinutes = Math.floor(whole / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * The literal text block YouTube's parser looks for in a description to turn
 * a chapter list into clickable markers — this is the whole mechanism; there
 * is no separate "chapters" field on the upload itself.
 */
export function formatChapterBlock(chapters: Chapter[]): string {
  if (chapters.length === 0) return "";
  return chapters.map((c) => `${formatTimestamp(c.startSeconds)} ${c.title}`).join("\n");
}
