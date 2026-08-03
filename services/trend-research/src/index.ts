import { JobStore, createLogger, trendSchema } from "@ai-news/shared";
import { activeProviderLicensing, buildProviderChain } from "@ai-news/script-generator/providers/registry";
import type { ScriptProvider } from "@ai-news/script-generator/providers/types";
import { config } from "./config.js";
import { rankTopic } from "./rank.js";
import { searchCandidates } from "./search.js";
import { readTopicHistory, recordTopic } from "./state.js";

export interface RunTrendResearchOptions {
  /**
   * Injectable, same reasoning as runYoutubeUpload's {client} option:
   * defaults to the real script-generator provider chain, but a test can
   * substitute a fake to exercise this service's own logic (ranking-result
   * validation, index-to-URL mapping, retry-with-corrective-feedback,
   * provider fallback, trend.json assembly) independently of whether a real
   * LLM provider happens to be reachable/funded right now.
   */
  providers?: ScriptProvider[];
}

/**
 * Pipeline entry point, invoked per job by GitHub Actions (auto mode only —
 * manual mode writes trend.json directly, skipping this service entirely).
 *
 * Searches Firecrawl's news vertical for the channel's niche, ranks the
 * results with the same multi-provider LLM chain script-generator uses
 * (reused, not duplicated — see providers/registry.ts there) for viral
 * potential, evergreen value, and audience relevance while steering away from
 * recently-covered topics, and writes trend.json in the exact shape
 * script-generator already expects.
 */
export async function runTrendResearch(jobId: string, options: RunTrendResearchOptions = {}): Promise<void> {
  const logger = createLogger("trend-research");
  const store = JobStore.fromEnv();

  // Same licensing guardrail as script-generator/metadata-generator: a
  // prototype-only provider is fine for development but must not silently
  // pick the topic for a monetized upload. See docs/LICENSING.md §3.2.
  const licensing = activeProviderLicensing();
  if (licensing?.productionUse === "prototype-only") {
    logger.warn(
      { provider: licensing.id },
      `${licensing.label} is a PROTOTYPE-ONLY tier: fine for development, NOT licensed for producing monetized video. ` +
        "Switch to a paid/commercial-permitted provider before publishing (docs/LICENSING.md).",
    );
  }

  logger.info({ jobId, niche: config.niche }, "Searching for candidate topics");
  const candidates = await searchCandidates(config.niche);
  logger.info({ jobId, candidates: candidates.length }, "Found candidate articles");

  const history = await readTopicHistory(store);

  const { trend: generated, providerName, model } = await rankTopic({
    niche: config.niche,
    candidates,
    recentTopics: history.recentTopics,
    providers: options.providers ?? buildProviderChain(),
    maxAttempts: config.maxAttempts,
    logger,
  });

  const sourceUrls = generated.sourceIndices.map((i) => candidates[i]!.url);

  const trend = trendSchema.parse({
    jobId,
    topic: generated.topic,
    angle: generated.angle,
    sourceUrls,
    sourceSummaries: generated.sourceSummaries,
  });
  await store.putJson(store.jobKey(jobId, "trend.json"), trend);
  await recordTopic(store, history, trend.topic);

  logger.info(
    { jobId, provider: providerName, model, topic: trend.topic, sources: trend.sourceUrls.length },
    "Wrote trend.json",
  );
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: node dist/index.js <jobId>");
    process.exit(1);
  }
  runTrendResearch(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
