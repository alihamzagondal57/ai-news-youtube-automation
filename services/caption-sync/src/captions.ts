import type { CaptionWord } from "@ai-news/shared";

/**
 * Shortest plausible spoken word. Used to give a positive span to any word
 * Whisper timestamps as zero-length, which it does occasionally on very short
 * function words ("a", "to").
 */
const MIN_WORD_SECONDS = 0.06;

/** A word as Whisper reports it, before any cleaning. Ends can be null on the final word of a chunk. */
export interface RawWord {
  text: string;
  start: number | null;
  end: number | null;
}

/**
 * Turn Whisper's raw word timings into the caption contract the renderer needs.
 *
 * This exists because the renderer does a linear
 * `words.findIndex(w => t >= w.start && t < w.end)` to pick the highlighted
 * word (`remotion/src/components/captions/WordHighlightCaptions.tsx`). That
 * lookup returns the FIRST match, so any overlap silently highlights the wrong
 * word for the rest of the overlapping span, and any out-of-order entry is
 * unreachable. Whisper produces both often enough to matter — especially at the
 * 30-second chunk seams, where the same word can be emitted twice with slightly
 * different timings.
 *
 * Guarantees on the returned array:
 *  - every `word` is non-empty and trimmed
 *  - `start` is ascending
 *  - spans never overlap (`end[i] <= start[i+1]`)
 *  - `end > start` for every entry
 *  - everything lies inside `[0, audioDurationSeconds]`
 */
export function normalizeWords(raw: RawWord[], audioDurationSeconds: number): CaptionWord[] {
  if (!(audioDurationSeconds > 0)) {
    throw new Error(`audioDurationSeconds must be positive, got ${audioDurationSeconds}`);
  }

  // 1. Clean: drop anything without usable text or a usable start.
  const cleaned = raw
    .map((w) => ({ word: w.text.trim(), start: w.start, end: w.end }))
    .filter((w) => w.word.length > 0 && typeof w.start === "number" && Number.isFinite(w.start))
    .map((w) => ({
      word: w.word,
      start: Math.min(Math.max(w.start as number, 0), audioDurationSeconds),
      end: typeof w.end === "number" && Number.isFinite(w.end) ? w.end : null,
    }));

  // 2. Stable sort by start. Whisper is normally ordered, but chunk stitching
  //    can emit a boundary word slightly out of sequence.
  cleaned.sort((a, b) => a.start - b.start);

  // 3. Force starts to be non-decreasing, then derive each end from the
  //    *next* start so spans are tiled rather than overlapping.
  const out: CaptionWord[] = [];
  let previousEnd = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const current = cleaned[i];
    // Never start before the previous word ended, or the renderer's findIndex
    // would resolve this span to the earlier word.
    const start = Math.max(current.start, previousEnd);
    if (start >= audioDurationSeconds) break; // nothing left inside the audio

    // The next word's start is a hard ceiling; so is the end of the audio.
    const nextStart = i + 1 < cleaned.length ? Math.max(cleaned[i + 1].start, start) : audioDurationSeconds;
    const ceiling = Math.min(nextStart, audioDurationSeconds);

    let end = current.end !== null && current.end > start ? current.end : start + MIN_WORD_SECONDS;
    end = Math.min(end, ceiling);

    // A degenerate span (two words sharing one instant) can't be rendered; drop
    // it rather than emit a zero-length entry the schema would reject anyway.
    if (!(end > start)) continue;

    out.push({ word: current.word, start, end });
    previousEnd = end;
  }

  return out;
}

/**
 * Re-check the guarantees above on the finished array. Belt-and-suspenders, in
 * the same spirit as voiceover's assertTimingInvariants: a caption track that
 * silently violates these renders wrong rather than failing, and a wrong
 * highlight is far harder to notice in review than a failed step.
 */
export function assertCaptionInvariants(words: CaptionWord[], audioDurationSeconds: number): void {
  if (words.length === 0) {
    throw new Error("Caption track is empty — Whisper returned no usable words");
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.word.trim()) throw new Error(`Caption ${i} has empty text`);
    if (!(w.start >= 0)) throw new Error(`Caption ${i} ("${w.word}") starts at ${w.start}`);
    if (!(w.end > w.start)) throw new Error(`Caption ${i} ("${w.word}") has non-positive span ${w.start}->${w.end}`);
    if (w.end > audioDurationSeconds + 0.001) {
      throw new Error(`Caption ${i} ("${w.word}") ends at ${w.end}s, past the ${audioDurationSeconds}s audio`);
    }
    if (i > 0 && w.start < words[i - 1].end - 1e-9) {
      throw new Error(
        `Caption ${i} ("${w.word}") starts at ${w.start}s, overlapping the previous word which ends at ${words[i - 1].end}s`,
      );
    }
  }
}
