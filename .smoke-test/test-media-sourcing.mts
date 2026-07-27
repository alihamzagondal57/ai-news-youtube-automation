// Pure-logic checks for media-sourcing — no network, no downloads, no store, so
// it runs in a second. Covers query building, the pure scoring/ranking
// function, and the dedupe logic (exact + near-duplicate + channel-wide
// exclusion with graceful degrade).
import { buildSearchQuery, extractKeywords } from "../services/media-sourcing/src/query.ts";
import { rankCandidates, scoreCandidate } from "../services/media-sourcing/src/rank.ts";
import { isNearDuplicate, recordUsage, selectForSegment, EMPTY_MEDIA_USAGE, MEDIA_USAGE_AVOID_WINDOW } from "../services/media-sourcing/src/dedupe.ts";
import { assetKey, type Candidate } from "../services/media-sourcing/src/types.ts";
import { licenseFor } from "../services/media-sourcing/src/license.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    provider: "pexels",
    id: "1",
    pageUrl: "https://www.pexels.com/video/1/",
    previewImage: "https://example.com/1.jpg",
    width: 1920,
    height: 1080,
    durationSeconds: 10,
    downloadUrl: "https://example.com/1.mp4",
    fileSizeBytes: 5_000_000,
    tags: ["parliament", "europe", "building"],
    user: "alice",
    ...overrides,
  };
}

// ── Query building ────────────────────────────────────────────────────────────
check(
  "strips 'stock footage of' framing",
  buildSearchQuery("stock footage of the European Central Bank building") === "European Central Bank building",
  `"${buildSearchQuery("stock footage of the European Central Bank building")}"`,
);
check(
  "strips 'aerial drone footage of'",
  buildSearchQuery("aerial drone footage of a city skyline at dusk") === "city skyline at dusk",
  `"${buildSearchQuery("aerial drone footage of a city skyline at dusk")}"`,
);
check(
  "leaves a plain subject alone (no framing to strip)",
  buildSearchQuery("European Parliament building") === "European Parliament building",
  `"${buildSearchQuery("European Parliament building")}"`,
);
check(
  "caps query length at 8 words",
  buildSearchQuery("stock footage of a very long descriptive scene involving many many many words describing the shot").split(" ").length <= 8,
  `${buildSearchQuery("stock footage of a very long descriptive scene involving many many many words describing the shot").split(" ").length} words`,
);
check(
  "extractKeywords drops stopwords and short tokens",
  JSON.stringify(extractKeywords("stock footage of the ECB building in Frankfurt")) === JSON.stringify(["ecb", "building", "frankfurt"]),
  extractKeywords("stock footage of the ECB building in Frankfurt").join(", "),
);
check("extractKeywords never throws on an empty string", (() => { try { extractKeywords(""); return true; } catch { return false; } })(), "empty visualCue handled");

// ── Scoring ──────────────────────────────────────────────────────────────────
const relevant = candidate({ tags: ["european", "parliament", "brussels", "government"] });
const irrelevant = candidate({ id: "2", tags: ["cooking", "kitchen", "recipe"] });
const keywords = ["european", "parliament"];
const scoredRelevant = scoreCandidate(relevant, keywords, 10);
const scoredIrrelevant = scoreCandidate(irrelevant, keywords, 10);
check("relevant tags score higher than irrelevant ones", scoredRelevant.score > scoredIrrelevant.score, `${scoredRelevant.score.toFixed(3)} > ${scoredIrrelevant.score.toFixed(3)}`);

const landscape = candidate({ width: 1920, height: 1080 });
const portrait = candidate({ id: "3", width: 1080, height: 1920 });
check("landscape orientation scores higher than portrait", scoreCandidate(landscape, [], 10).score > scoreCandidate(portrait, [], 10).score, "orientation bonus applied");

const longEnough = candidate({ durationSeconds: 15 });
const tooShort = candidate({ id: "4", durationSeconds: 2 });
check("a clip meeting the segment duration scores higher than a short one", scoreCandidate(longEnough, [], 10).score > scoreCandidate(tooShort, [], 10).score, "duration adequacy applied");
check("duration score never exceeds 1 for an overlong clip", scoreCandidate(candidate({ durationSeconds: 999 }), [], 10).scoreBreakdown.duration === 1, "capped at 1");

check("no keywords extracted doesn't zero every candidate", scoreCandidate(candidate({}), [], 10).score > 0, `score ${scoreCandidate(candidate({}), [], 10).score.toFixed(3)} (neutral relevance)`);

const pool = [irrelevant, relevant, tooShort];
const ranked = rankCandidates(pool, keywords, 10);
check("rankCandidates sorts highest score first", ranked[0].id === relevant.id, `top pick id=${ranked[0].id}`);
check("rankCandidates preserves every input candidate", ranked.length === pool.length, `${ranked.length}/${pool.length}`);

// ── Near-duplicate detection ─────────────────────────────────────────────────
const a = candidate({ id: "10", user: "bob", tags: ["parliament", "brussels", "flag", "eu"] });
const bSameUploaderSimilar = candidate({ id: "11", user: "bob", tags: ["parliament", "brussels", "flag", "government"] });
const bSameUploaderDifferent = candidate({ id: "12", user: "bob", tags: ["kitchen", "cooking"] });
const bDifferentUploaderSimilarTags = candidate({ id: "13", user: "carol", tags: ["parliament", "brussels", "flag", "eu"] });
check("same uploader + heavily overlapping tags is a near-duplicate", isNearDuplicate(a, bSameUploaderSimilar), "flagged");
check("same uploader + unrelated tags is NOT a near-duplicate", !isNearDuplicate(a, bSameUploaderDifferent), "not flagged");
check("different uploader, even with identical tags, is NOT a near-duplicate", !isNearDuplicate(a, bDifferentUploaderSimilarTags), "not flagged (uploader differs)");
check("identical asset key is always a duplicate", isNearDuplicate(a, { ...a }), "self-match flagged");
check("different provider, same id, is not a duplicate", !isNearDuplicate(a, { ...a, provider: "pixabay" }), "provider distinguishes the key");

// ── selectForSegment: job-level dedupe never degrades ─────────────────────────
const c1 = candidate({ id: "20", user: "dave", tags: ["ecb", "frankfurt"] });
const c2 = candidate({ id: "21", user: "dave", tags: ["ecb", "frankfurt", "bank"] }); // near-dup of c1 (same user, high overlap)
const c3 = candidate({ id: "22", user: "erin", tags: ["stockholm", "sweden"] });
const c4 = candidate({ id: "23", user: "frank", tags: ["berlin", "germany"] });
const rankedPool = rankCandidates([c1, c2, c3, c4], [], 5);
const picks = selectForSegment(rankedPool, [c1], EMPTY_MEDIA_USAGE, 3);
check("job-level near-duplicate is excluded even though it ranks well", !picks.some((p) => p.id === c2.id), `picked: ${picks.map((p) => p.id).join(", ")}`);
check(
  "returns as many non-duplicate candidates as are available, short of the requested count rather than backfilling with a duplicate",
  picks.length === 2 && picks.every((p) => ["22", "23"].includes(p.id)),
  `${picks.length}/3 requested: ${picks.map((p) => p.id).join(", ")} (c1 already picked, c2 is its near-duplicate — only c3/c4 remain)`,
);

// ── selectForSegment: channel-wide exclusion degrades gracefully ─────────────
const smallPool = rankCandidates([c1, c3], [], 5);
const usageExcludingBoth = { recentAssetIds: [assetKey(c1), assetKey(c3)] };
const degraded = selectForSegment(smallPool, [], usageExcludingBoth, 2);
check(
  "channel-wide exclusion degrades rather than starving a segment",
  degraded.length === 2,
  `${degraded.length}/2 picks despite both being 'recently used' channel-wide`,
);

const bigPool = rankCandidates([c1, c3, c4], [], 5);
const usageExcludingOne = { recentAssetIds: [assetKey(c1)] };
const respected = selectForSegment(bigPool, [], usageExcludingOne, 2);
check(
  "channel-wide exclusion IS honored when enough candidates remain",
  !respected.some((p) => p.id === c1.id),
  `picked: ${respected.map((p) => p.id).join(", ")} (c1 excluded, pool was large enough)`,
);

// ── recordUsage bookkeeping ────────────────────────────────────────────────────
const afterFirst = recordUsage(EMPTY_MEDIA_USAGE, ["pexels:1", "pixabay:2"]);
check("recordUsage puts new keys first (most-recent-first)", afterFirst.recentAssetIds[0] === "pexels:1", afterFirst.recentAssetIds.join(", "));
const afterSecond = recordUsage(afterFirst, ["pexels:1", "pixabay:3"]);
check("recordUsage dedupes a re-seen key rather than listing it twice", afterSecond.recentAssetIds.filter((k) => k === "pexels:1").length === 1, afterSecond.recentAssetIds.join(", "));
const manyKeys = Array.from({ length: MEDIA_USAGE_AVOID_WINDOW * 3 }, (_, i) => `pexels:${i}`);
const capped = recordUsage(EMPTY_MEDIA_USAGE, manyKeys);
check("recordUsage caps history length rather than growing unbounded", capped.recentAssetIds.length <= MEDIA_USAGE_AVOID_WINDOW * 2, `${capped.recentAssetIds.length} <= ${MEDIA_USAGE_AVOID_WINDOW * 2}`);

// ── License records ────────────────────────────────────────────────────────────
const pexelsLicense = licenseFor(candidate({ provider: "pexels", pageUrl: "https://www.pexels.com/video/99/" }));
const pixabayLicense = licenseFor(candidate({ provider: "pixabay", pageUrl: "https://pixabay.com/videos/id-99/" }));
check("Pexels license names the source and permits commercial use", pexelsLicense.source === "pexels" && /commercial/i.test(pexelsLicense.licenseType), pexelsLicense.licenseType);
check("Pixabay license names the source and permits commercial use", pixabayLicense.source === "pixabay" && /commercial/i.test(pixabayLicense.licenseType), pixabayLicense.licenseType);
check("license URL is the asset's own page (proof of sourcing)", pexelsLicense.url === "https://www.pexels.com/video/99/", pexelsLicense.url);

console.log("");
console.log(failures === 0 ? "media-sourcing unit tests PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
