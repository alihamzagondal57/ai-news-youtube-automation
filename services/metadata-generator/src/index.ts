import { JobStore, createLogger, metadataSchema, scriptSchema, segmentTimingSchema } from "@ai-news/shared";
import { activeProviderLicensing, buildProviderChain } from "@ai-news/script-generator/providers/registry";
import { buildChapters, MIN_CHAPTERS_TO_RENDER } from "./chapters.js";
import { config } from "./config.js";
import { generateMetadata } from "./generate.js";
import { assembleMetadata } from "./validate.js";

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `script.json` and `segment-timing.json`, generates SEO title/
 * description/tags/hashtags with the same multi-provider LLM chain
 * script-generator uses (reused, not duplicated — see providers/registry.ts
 * there), derives chapters mechanically from the real segment timing, and
 * writes `metadata.json`. `containsSyntheticMedia` is always true: every
 * video this pipeline makes is AI-narrated and AI-scripted.
 */
export async function runMetadataGeneration(jobId: string): Promise<void> {
  const logger = createLogger("metadata-generator");
  const store = JobStore.fromEnv();

  const script = await store.getJson(store.jobKey(jobId, "script.json"), scriptSchema);
  const segmentTiming = await store.getJson(store.jobKey(jobId, "segment-timing.json"), segmentTimingSchema);

  // Same licensing guardrail as script-generator: a prototype-only provider is
  // fine for development but must not silently produce metadata for a
  // monetized upload. See docs/LICENSING.md §3.2.
  const licensing = activeProviderLicensing();
  if (licensing?.productionUse === "prototype-only") {
    logger.warn(
      { provider: licensing.id },
      `${licensing.label} is a PROTOTYPE-ONLY tier: fine for development, NOT licensed for producing monetized video. ` +
        "Switch to a paid/commercial-permitted provider before publishing (docs/LICENSING.md).",
    );
  }

  logger.info({ jobId, title: script.title, segments: script.segments.length }, "Generating metadata");

  const { metadata: generated, providerName, model } = await generateMetadata({
    script,
    totalDurationSeconds: segmentTiming.totalDurationSeconds,
    providers: buildProviderChain(),
    maxAttempts: config.maxAttempts,
    logger,
  });

  const chapters = buildChapters(script, segmentTiming);
  if (chapters.length < MIN_CHAPTERS_TO_RENDER) {
    logger.warn(
      { jobId, chapters: chapters.length, required: MIN_CHAPTERS_TO_RENDER },
      "Fewer than YouTube's minimum chapter count — the timestamp block will be written to the description, but YouTube won't render it as clickable chapters",
    );
  }

  const assembled = assembleMetadata(generated, chapters);

  // Validate against the shared contract before writing, so a shape drift in
  // this service can never publish an artifact downstream steps can't read.
  const metadata = metadataSchema.parse({
    jobId,
    title: assembled.title,
    description: assembled.description,
    tags: assembled.tags,
    hashtags: assembled.hashtags,
    chapters: assembled.chapters,
    containsSyntheticMedia: true,
  });
  await store.putJson(store.jobKey(jobId, "metadata.json"), metadata);

  logger.info(
    {
      jobId,
      provider: providerName,
      model,
      titleLength: metadata.title.length,
      descriptionLength: metadata.description.length,
      tags: metadata.tags.length,
      hashtags: metadata.hashtags.length,
      chapters: metadata.chapters.length,
    },
    "Wrote metadata.json",
  );
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: node dist/index.js <jobId>");
    process.exit(1);
  }
  runMetadataGeneration(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
