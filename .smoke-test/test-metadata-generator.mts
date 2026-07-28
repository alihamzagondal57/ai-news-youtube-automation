// Pure-logic checks for metadata-generator — no network, no LLM, so it runs in
// a second. Covers the two things that are entirely code (not model output):
// chapter derivation from segment-timing.json, and the deterministic
// assembly/truncation that turns LLM copy into YouTube-legal fields.
import { buildChapters, formatTimestamp, formatChapterBlock, MIN_CHAPTERS_TO_RENDER } from "../services/metadata-generator/src/chapters.ts";
import {
  assembleMetadata,
  retryableIssues,
  YOUTUBE_TITLE_MAX_CHARS,
  YOUTUBE_DESCRIPTION_MAX_CHARS,
  YOUTUBE_TAGS_MAX_COMBINED_CHARS,
} from "../services/metadata-generator/src/validate.ts";
import { extractJson, generatedMetadataSchema } from "../services/metadata-generator/src/schema.ts";
import type { GeneratedMetadata } from "../services/metadata-generator/src/schema.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── formatTimestamp ───────────────────────────────────────────────────────
check("formats under a minute", formatTimestamp(45) === "0:45", formatTimestamp(45));
check("formats minutes, zero-padded seconds", formatTimestamp(125) === "2:05", formatTimestamp(125));
check("formats past an hour", formatTimestamp(3725) === "1:02:05", formatTimestamp(3725));
check("floors fractional seconds", formatTimestamp(59.9) === "0:59", formatTimestamp(59.9));

// ── buildChapters ──────────────────────────────────────────────────────────
// Realistic durations: script-generator's own OPENING_WORDS band (30-100
// words ~ 12-40s at 150wpm) means a real opening always clears the 10s
// minimum chapter gap on its own; 15s here keeps the fixture representative
// rather than accidentally exercising the merge case this suite tests separately below.
const script = {
  jobId: "11111111-1111-1111-1111-111111111111",
  title: "Test Bulletin",
  segments: [
    { id: 0, text: "Opening.", headline: "Opening Headline", visualCue: "n/a", estSeconds: 15 },
    { id: 1, text: "Body one.", headline: "First Story", visualCue: "n/a", estSeconds: 40 },
    { id: 2, text: "Body two.", headline: "Second Story", visualCue: "n/a", estSeconds: 40 },
    { id: 3, text: "Outro.", headline: "Closing Headline", visualCue: "n/a", estSeconds: 15 },
  ],
};
const timing = {
  jobId: script.jobId,
  totalDurationSeconds: 110,
  segments: [
    { id: 0, startSeconds: 0, endSeconds: 15 },
    { id: 1, startSeconds: 15, endSeconds: 55 },
    { id: 2, startSeconds: 55, endSeconds: 95 },
    { id: 3, startSeconds: 95, endSeconds: 110 },
  ],
};
const chapters = buildChapters(script, timing);
check("one chapter per well-spaced segment", chapters.length === 4, `${chapters.length} chapters`);
check("first chapter is exactly 0:00", chapters[0].startSeconds === 0, `${chapters[0].startSeconds}`);
check("chapters carry the segment's headline", chapters[1].title === "First Story", chapters[1].title);
check("chapters are ascending", chapters.every((c, i) => i === 0 || c.startSeconds > chapters[i - 1].startSeconds), "strictly increasing");
check(`meets YouTube's ${MIN_CHAPTERS_TO_RENDER}-chapter minimum to actually render`, chapters.length >= MIN_CHAPTERS_TO_RENDER, `${chapters.length} >= ${MIN_CHAPTERS_TO_RENDER}`);

// Segments closer together than the 10s minimum gap must NOT produce a
// separate chapter — YouTube wouldn't register it as one anyway. Gaps are
// measured against the last KEPT chapter, not the previous segment's own
// position, so segment 2 here (14s after segment 0, the chapter segment 1
// merged into) clears the threshold even though segment 1 didn't. A dedicated
// 3-segment script/timing pair, matched to each other (buildChapters iterates
// script.segments and looks up each one's timing, so the two must agree).
const closeScript = {
  jobId: script.jobId,
  title: script.title,
  segments: script.segments.slice(0, 3),
};
const closeTiming = {
  jobId: script.jobId,
  totalDurationSeconds: 20,
  segments: [
    { id: 0, startSeconds: 0, endSeconds: 5 },
    { id: 1, startSeconds: 5, endSeconds: 9 }, // only 5s after segment 0's chapter -> merges
    { id: 2, startSeconds: 14, endSeconds: 25 }, // 14s after segment 0's chapter -> clears the gap
  ],
};
const closeChapters = buildChapters(closeScript, closeTiming);
check(
  "a segment under the 10s gap merges; a later one that clears the gap (from the kept chapter, not the merged one) still gets its own",
  closeChapters.length === 2,
  `${closeChapters.length} chapters (segment 1 merged into segment 0's; segment 2 kept)`,
);

// A segment whose real start is nonzero (defensive case) still forces chapter 0 to 0:00.
const nonZeroStartTiming = { ...timing, segments: [{ ...timing.segments[0], startSeconds: 0.4 }, ...timing.segments.slice(1)] };
const nonZeroChapters = buildChapters(script, nonZeroStartTiming);
check("chapter 0 is forced to 0:00 even if the real timing is fractionally off", nonZeroChapters[0].startSeconds === 0, `${nonZeroChapters[0].startSeconds}`);

check("throws on a segment with no timing entry", (() => {
  try {
    buildChapters(script, { ...timing, segments: timing.segments.slice(0, 2) });
    return false;
  } catch {
    return true;
  }
})(), "missing segment-timing entry rejected rather than silently skipped");

// ── formatChapterBlock ──────────────────────────────────────────────────────
const block = formatChapterBlock(chapters);
check("chapter block has one line per chapter", block.split("\n").length === chapters.length, `${block.split("\n").length} lines`);
check("chapter block lines are 'timestamp title'", block.split("\n")[1] === "0:15 First Story", block.split("\n")[1]);
check("empty chapter list produces an empty block", formatChapterBlock([]) === "", "no dangling 'Chapters:' header with nothing under it");

// ── retryableIssues ──────────────────────────────────────────────────────────
const goodMeta: GeneratedMetadata = {
  title: "EU Approves New AI Liability Rules",
  description: "A real, substantive description of the story.",
  tags: ["EU", "AI regulation", "European Parliament"],
  hashtags: ["EUNews", "AIRegulation"],
};
check("a well-formed generation has no retryable issues", retryableIssues(goodMeta).length === 0, "clean");
check("an over-length title is flagged", retryableIssues({ ...goodMeta, title: "x".repeat(150) }).length > 0, "flagged for retry, not silently truncated at generation time");
check("an empty title is flagged", retryableIssues({ ...goodMeta, title: "" }).length > 0, "flagged");
check("an empty description is flagged", retryableIssues({ ...goodMeta, description: "" }).length > 0, "flagged");

// ── assembleMetadata: deterministic truncation to YouTube's real limits ─────
const assembled = assembleMetadata(goodMeta, chapters);
check("assembled title matches the input (already under the cap)", assembled.title === goodMeta.title, assembled.title);
check("assembled description embeds the chapter block", assembled.description.includes("Chapters:") && assembled.description.includes("First Story"), "chapter timestamps present in the final description");
check("assembled description stays under YouTube's cap", assembled.description.length <= YOUTUBE_DESCRIPTION_MAX_CHARS, `${assembled.description.length} <= ${YOUTUBE_DESCRIPTION_MAX_CHARS}`);

// An absurdly long title/description/tag list must be cut, not rejected — the
// chapter block specifically must survive intact even under pressure.
const hugeMeta: GeneratedMetadata = {
  title: "T".repeat(500),
  description: "D".repeat(20000),
  tags: Array.from({ length: 200 }, (_, i) => `tag-number-${i}-with-some-length-to-it`),
  hashtags: Array.from({ length: 50 }, (_, i) => `Hashtag${i}`),
};
const hugeAssembled = assembleMetadata(hugeMeta, chapters);
check("oversized title is truncated to the YouTube cap, not rejected", hugeAssembled.title.length === YOUTUBE_TITLE_MAX_CHARS, `${hugeAssembled.title.length}`);
check("oversized description is truncated to the YouTube cap", hugeAssembled.description.length <= YOUTUBE_DESCRIPTION_MAX_CHARS, `${hugeAssembled.description.length} <= ${YOUTUBE_DESCRIPTION_MAX_CHARS}`);
check("the chapter block survives intact even when the body had to be cut hard", hugeAssembled.description.includes(formatChapterBlock(chapters)), "chapters were never sacrificed to make room");
const combinedTagLength = hugeAssembled.tags.reduce((n, t, i) => n + t.length + (i > 0 ? 2 : 0), 0);
check("oversized tag list is trimmed to YouTube's real combined-length limit", combinedTagLength <= YOUTUBE_TAGS_MAX_COMBINED_CHARS, `${combinedTagLength} <= ${YOUTUBE_TAGS_MAX_COMBINED_CHARS} (not an arbitrary array-length cap)`);
check("hashtags are capped to a sane count", hugeAssembled.hashtags.length <= 8, `${hugeAssembled.hashtags.length}`);
check("hashtags never carry a leading '#' (added only at render time)", hugeAssembled.hashtags.every((h) => !h.startsWith("#")), "bare words stored");

// A leading '#' in raw LLM output must be stripped, not double-prefixed later.
const withHashPrefix = assembleMetadata({ ...goodMeta, hashtags: ["#AlreadyPrefixed", "Bare"] }, chapters);
check("a leading '#' the model added anyway is stripped", withHashPrefix.hashtags[0] === "AlreadyPrefixed", withHashPrefix.hashtags[0]);

// ── extractJson / generatedMetadataSchema ───────────────────────────────────
check("extracts JSON from a markdown code fence", (() => {
  const parsed = extractJson("```json\n" + JSON.stringify(goodMeta) + "\n```") as GeneratedMetadata;
  return parsed.title === goodMeta.title;
})(), "fenced JSON parses");
check("extracts bare JSON with no fence", (() => {
  const parsed = extractJson(JSON.stringify(goodMeta)) as GeneratedMetadata;
  return parsed.title === goodMeta.title;
})(), "unfenced JSON parses");
check("generatedMetadataSchema accepts well-formed output", (() => {
  try {
    generatedMetadataSchema.parse(goodMeta);
    return true;
  } catch {
    return false;
  }
})(), "schema accepts the happy path");
check("generatedMetadataSchema rejects a missing field", (() => {
  try {
    generatedMetadataSchema.parse({ title: "x", description: "y", tags: ["z"] }); // no hashtags
    return false;
  } catch {
    return true;
  }
})(), "missing hashtags field rejected");

console.log("");
console.log(failures === 0 ? "metadata-generator unit tests PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
