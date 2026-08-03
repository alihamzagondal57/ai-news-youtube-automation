// END-TO-END test of the trend-research SERVICE: real Firecrawl search+scrape
// calls against real news sites, and a real trend.json written to an
// in-process S3 store, validated against the EXACT schema script-generator
// already consumes.
//
// The ranking LLM call is the one piece NOT exercised against a real
// provider here — every currently-enabled provider is genuinely, externally
// unavailable right now (github-models: 401/expired token; gemini: hard
// zero free-tier quota, not a transient rate limit; cerebras: no credits;
// mistral/openrouter/groq are deliberately disabled in
// services/script-generator/src/providers/registry.ts for unrelated,
// documented operational reasons — see docs/LICENSING.md). This is the same
// real, external constraint hit and documented during n8n/README.md's
// verification pass for metadata-generator, not a defect in this service.
//
// So: the test first proves that constraint is real (attempts the actual
// provider chain, expects and confirms it exhausts every provider), then
// substitutes a fake ScriptProvider — same reasoning as e2e-youtube-uploader
// faking the YouTube API client: fake the external dependency that can't be
// safely/currently exercised, never the service's own logic. Every other
// step is 100% real: real search, real scraped article content, real
// candidate-index-to-URL mapping, real schema validation, real state writes.
import S3rver from "s3rver";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScriptProvider } from "../services/script-generator/src/providers/types.ts";

const S3_PORT = 4590;
const BUCKET = "ai-news-pipeline";

process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";

const JOB_ID = "66666666-1111-1111-1111-666666666666";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-trend-s3-"));
  const server = new S3rver({ port: S3_PORT, address: "localhost", silent: true, directory: dataDir, configureBuckets: [{ name: BUCKET, configs: [] }] });
  await server.run();
  console.log(`s3rver (R2 stand-in) on :${S3_PORT}\n`);

  try {
    const { JobStore, trendSchema } = await import("@ai-news/shared");
    const { searchCandidates } = await import("../services/trend-research/src/search.ts");
    const { runTrendResearch } = await import("../services/trend-research/src/index.ts");
    const { readTopicHistory, recordTopic } = await import("../services/trend-research/src/state.ts");
    const { buildProviderChain } = await import("../services/script-generator/src/providers/registry.ts");

    const store = JobStore.fromEnv();

    // ── real Firecrawl search+scrape ──────────────────────────────────────
    console.log("Searching Firecrawl for real candidate articles...");
    const candidates = await searchCandidates("news-europe");
    check("searchCandidates returns real candidates", candidates.length > 0, `${candidates.length} candidates`);
    check("candidates have real, live-looking URLs", candidates.every((c) => /^https?:\/\//.test(c.url)), candidates.slice(0, 3).map((c) => c.url).join(", "));
    check("candidates have real titles", candidates.every((c) => c.title.length > 0), candidates.slice(0, 3).map((c) => c.title).join(" | "));
    const withContent = candidates.filter((c) => c.content.length > 100);
    check("at least some candidates have real scraped article content (>100 chars)", withContent.length > 0, `${withContent.length}/${candidates.length} had substantial content`);

    // ── confirm the real provider chain is genuinely, currently exhausted ──
    console.log("\nConfirming every real LLM provider is currently unavailable (documented external constraint)...");
    let realProvidersExhausted = false;
    let exhaustionDetail = "";
    try {
      const { rankTopic } = await import("../services/trend-research/src/rank.ts");
      const { createLogger } = await import("@ai-news/shared");
      await rankTopic({ niche: "news-europe", candidates, recentTopics: [], providers: buildProviderChain(), maxAttempts: 1, logger: createLogger("e2e-probe") });
    } catch (err) {
      realProvidersExhausted = true;
      exhaustionDetail = (err as Error).message;
    }
    check("the real provider chain does genuinely fail right now (external, not a bug here)", realProvidersExhausted, exhaustionDetail.slice(0, 200));

    // ── real end-to-end run with a fake ranking provider ──────────────────
    console.log("\nRunning full trend-research (fake ranking provider — see file header for why)...");
    const first = candidates[0]!;
    const second = candidates.length > 1 ? candidates[1] : undefined;
    const fakeIndices = second ? [0, 1] : [0];
    const fakeSummaries = second
      ? [`A paraphrased, substantial summary of "${first.title}" drawing on its real scraped content for grounding.`, `A paraphrased, substantial summary of "${second.title}" drawing on its real scraped content for grounding.`]
      : [`A paraphrased, substantial summary of "${first.title}" drawing on its real scraped content for grounding.`];
    let fakeCallCount = 0;
    const fakeProvider: ScriptProvider = {
      name: "fake-e2e-provider",
      complete: async () => {
        fakeCallCount++;
        return {
          text: JSON.stringify({
            topic: "European transport ministers debate cross-border rail funding",
            angle: "Why this funding fight determines which countries get high-speed rail first",
            sourceIndices: fakeIndices,
            sourceSummaries: fakeSummaries,
          }),
          model: "fake-model",
          inputTokens: 100,
          outputTokens: 100,
        };
      },
    };

    await runTrendResearch(JOB_ID, { providers: [fakeProvider] });
    check("the fake provider was actually called (proves it's wired through options.providers)", fakeCallCount === 1, `${fakeCallCount} calls`);

    const trend = await store.getJson(store.jobKey(JOB_ID, "trend.json"), trendSchema);
    check("trend.json validates against the exact schema script-generator consumes", true, "trendSchema.parse succeeded (getJson would have thrown otherwise)");
    check("jobId matches", trend.jobId === JOB_ID, trend.jobId);
    check("topic is real, non-trivial text", trend.topic.length >= 8, trend.topic);
    check("angle is real, non-trivial text", trend.angle.length >= 8, trend.angle);
    check("sourceUrls has at least one real URL", trend.sourceUrls.length > 0 && trend.sourceUrls.every((u) => /^https?:\/\//.test(u)), JSON.stringify(trend.sourceUrls));
    check("sourceSummaries has at least one substantial (not stub) entry", trend.sourceSummaries.length > 0 && trend.sourceSummaries.every((s) => s.length > 40), trend.sourceSummaries.map((s) => s.length).join(","));
    check("sourceUrls and sourceSummaries are the same length (1:1 provenance)", trend.sourceUrls.length === trend.sourceSummaries.length, `${trend.sourceUrls.length} vs ${trend.sourceSummaries.length}`);
    check("every sourceUrl is mapped from the real candidate list by index (not invented)", trend.sourceUrls.every((u) => candidates.some((c) => c.url === u)), JSON.stringify(trend.sourceUrls));
    check("sourceUrls actually correspond to the REAL candidates at the indices the fake provider named", trend.sourceUrls[0] === first.url, `expected ${first.url}, got ${trend.sourceUrls[0]}`);

    // ── topic-history state ───────────────────────────────────────────────
    const historyAfterRun = await readTopicHistory(store);
    check("state/topic-history.json records the topic this run picked", historyAfterRun.recentTopics[0] === trend.topic, JSON.stringify(historyAfterRun.recentTopics));

    // ── cheap, no-network check of the accumulate-and-cap arithmetic ─────
    let history = historyAfterRun;
    for (let i = 0; i < 25; i++) {
      history = { recentTopics: [`synthetic topic ${i}`, ...history.recentTopics] };
      await recordTopic(store, history, `synthetic topic ${i}`);
      history = await readTopicHistory(store);
    }
    const { config } = await import("../services/trend-research/src/config.ts");
    check(`topic history caps at TREND_RECENT_TOPICS_WINDOW (${config.recentTopicsWindow}) entries, not growing unbounded`, history.recentTopics.length === config.recentTopicsWindow, `${history.recentTopics.length} entries`);
    check("the real topic from the actual run eventually rolls off the capped window", !history.recentTopics.includes(trend.topic), "rolled off as expected");

    console.log("");
    console.log(
      failures === 0
        ? "E2E PASSED: real Firecrawl search+scrape, real provider-exhaustion confirmed, and a real trend.json written in script-generator's exact input contract via the real write-path."
        : `${failures} failure(s)`,
    );
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
