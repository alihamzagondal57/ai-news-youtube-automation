import { JobStore, createLogger, scriptSchema, trendSchema } from "@ai-news/shared";
import { getStructure } from "@ai-news/shared/script-structure";
import { buildProviders, config } from "./config.js";
import { generateScript } from "./generate.js";
import { activeProviderLicensing } from "./providers/registry.js";
import { resolveJobStructure } from "./structureSelection.js";

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `trend.json`, resolves the job's script structure (override → recorded
 * → auto-rotate), generates and validates the script, and writes `script.json`.
 */
export async function runScriptGeneration(jobId: string): Promise<void> {
  const logger = createLogger("script-generator");
  const store = JobStore.fromEnv();

  const trend = await store.getJson(store.jobKey(jobId, "trend.json"), trendSchema);
  const structureId = await resolveJobStructure(store, jobId, logger);
  const structure = getStructure(structureId);

  // Licensing guardrail: the free tiers are scoped to prototyping, so warn on
  // every run rather than letting a dev-only provider quietly produce a script
  // that gets monetized. Advisory by design — see docs/LICENSING.md §3.2.
  const licensing = activeProviderLicensing();
  if (licensing?.productionUse === "prototype-only") {
    logger.warn(
      { provider: licensing.id },
      `${licensing.label} is a PROTOTYPE-ONLY tier: fine for development, NOT licensed for producing monetized video. ` +
        "Switch to a paid/commercial-permitted provider before publishing (docs/LICENSING.md).",
    );
  }

  logger.info({ jobId, structureId, topic: trend.topic }, "Generating script");

  const result = await generateScript({
    jobId,
    trend,
    structure,
    providers: buildProviders(),
    maxAttempts: config.maxAttempts,
    logger,
  });

  // Validate against the shared contract before writing, so a shape change in
  // this service can never publish an artifact downstream steps can't read.
  const script = scriptSchema.parse(result.script);
  await store.putJson(store.jobKey(jobId, "script.json"), script);

  logger.info(
    {
      jobId,
      structureId,
      provider: result.providerName,
      model: result.model,
      calls: result.calls,
      segments: script.segments.length,
    },
    "Wrote script.json",
  );
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: script-generator <jobId>");
    process.exit(1);
  }
  runScriptGeneration(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
