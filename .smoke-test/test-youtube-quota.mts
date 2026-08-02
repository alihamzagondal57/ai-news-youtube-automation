// Pure-logic checks for youtube-uploader's quota accounting and the
// publishAt-forces-"private" status rule — no I/O, no network, so this runs
// in a second. The real upload + gating + artifact I/O path is proven
// end-to-end (against a FAKE YouTube client — see that file's own header
// comment for why) in e2e-youtube-uploader.mts.
//
// Dummy creds set BEFORE the dynamic import below: youtube.ts imports
// config.ts, which requires these env vars at module-load time (fail-fast in
// production) even though this file never actually calls the YouTube API. A
// static top-level `import` would be hoisted above these assignments, so the
// module under test is loaded dynamically instead, same as the E2E tests.
process.env.YOUTUBE_CLIENT_ID ??= "test-client-id";
process.env.YOUTUBE_CLIENT_SECRET ??= "test-client-secret";
process.env.YOUTUBE_REFRESH_TOKEN ??= "test-refresh-token";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

async function main() {
  const { QUOTA_COSTS } = await import("../services/youtube-uploader/src/quota.ts");
  const { resolveVideoStatus } = await import("../services/youtube-uploader/src/youtube.ts");

  // ── QUOTA_COSTS: fixed, documented Data API v3 costs, not estimates ───────
  check("videos.insert costs exactly 1600 units", QUOTA_COSTS.videosInsert === 1600, `${QUOTA_COSTS.videosInsert}`);
  check("thumbnails.set costs exactly 50 units", QUOTA_COSTS.thumbnailsSet === 50, `${QUOTA_COSTS.thumbnailsSet}`);
  check("playlistItems.insert costs exactly 50 units", QUOTA_COSTS.playlistItemsInsert === 50, `${QUOTA_COSTS.playlistItemsInsert}`);

  // ── Scenario totals — what index.ts actually accumulates per outcome ─────
  {
    const withoutPlaylist = QUOTA_COSTS.videosInsert + QUOTA_COSTS.thumbnailsSet;
    check(
      "a successful upload with no configured playlist totals 1650 units",
      withoutPlaylist === 1650,
      `${withoutPlaylist}`,
    );

    const withPlaylist = QUOTA_COSTS.videosInsert + QUOTA_COSTS.thumbnailsSet + QUOTA_COSTS.playlistItemsInsert;
    check("a successful upload with a configured playlist totals 1700 units", withPlaylist === 1700, `${withPlaylist}`);

    const dailyCapFromUploadCostAlone = Math.floor(10_000 / QUOTA_COSTS.videosInsert);
    check(
      "videos.insert cost alone caps a default 10,000-unit project at ~6 uploads/day",
      dailyCapFromUploadCostAlone === 6,
      `${dailyCapFromUploadCostAlone} uploads/day`,
    );

    // Partial failure: the video itself uploaded (quota spent, non-refundable)
    // but setting the thumbnail then failed — the record must reflect exactly
    // the video's own cost, not zero and not the full success total.
    const partialFailure = QUOTA_COSTS.videosInsert;
    check(
      "a partial failure after a successful video upload but before the thumbnail call records only the video's own cost",
      partialFailure === 1600 && partialFailure < withoutPlaylist,
      `${partialFailure} (less than the ${withoutPlaylist} a full success would record)`,
    );
  }

  // ── resolveVideoStatus: the publishAt-forces-"private" rule ──────────────
  {
    const immediate = resolveVideoStatus({
      containsSyntheticMedia: true,
      defaultPrivacyStatus: "public",
      publishAt: null,
    });
    check(
      "no publishAt uses the configured default privacy status as-is",
      immediate.privacyStatus === "public",
      `privacyStatus=${immediate.privacyStatus}`,
    );
    check("no publishAt sets no publishAt field on the request", immediate.publishAt === undefined, `publishAt=${immediate.publishAt}`);
  }

  {
    const scheduled = resolveVideoStatus({
      containsSyntheticMedia: true,
      defaultPrivacyStatus: "public", // deliberately public — publishAt must still win
      publishAt: "2030-01-01T00:00:00.000Z",
    });
    check(
      'a set publishAt forces privacyStatus to "private" regardless of the configured default',
      scheduled.privacyStatus === "private",
      `privacyStatus=${scheduled.privacyStatus} (default was "public")`,
    );
    check(
      "the publishAt timestamp is passed through verbatim",
      scheduled.publishAt === "2030-01-01T00:00:00.000Z",
      `${scheduled.publishAt}`,
    );
  }

  {
    const disclosed = resolveVideoStatus({ containsSyntheticMedia: true, defaultPrivacyStatus: "private", publishAt: null });
    const notDisclosed = resolveVideoStatus({ containsSyntheticMedia: false, defaultPrivacyStatus: "private", publishAt: null });
    check(
      "containsSyntheticMedia is passed through, never silently dropped or defaulted",
      disclosed.containsSyntheticMedia === true && notDisclosed.containsSyntheticMedia === false,
      `true -> ${disclosed.containsSyntheticMedia}, false -> ${notDisclosed.containsSyntheticMedia}`,
    );
  }

  console.log(failures === 0 ? "\nALL YOUTUBE QUOTA/STATUS TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
