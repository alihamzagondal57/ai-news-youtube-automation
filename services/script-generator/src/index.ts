import { JobStore, createLogger, scriptSchema, trendSchema } from "@ai-news/shared";
import { getStructure } from "@ai-news/shared/script-structure";
import { buildProviders, config } from "./config.js";
import { checkSegmentClaims, sourceNumberIndex } from "./factCheck.js";
import { generateScript } from "./generate.js";
import { activeProviderLicensing } from "./providers/registry.js";
import type { ScriptProvider } from "./providers/types.js";
import { resolveJobStructure } from "./structureSelection.js";

export interface RunScriptGenerationOptions {
  /**
   * Injectable, same reasoning as runYoutubeUpload's {client} option and
   * runTrendResearch's {providers}: defaults to the real registry chain
   * (which skips any disabledReason entry), but a caller can substitute an
   * explicit list — e.g. to dev-test a disabled provider directly, bypassing
   * the live-chain filter without touching registry.ts's actual state.
   */
  providers?: ScriptProvider[];
}

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `trend.json`, resolves the job's script structure (override → recorded
 * → auto-rotate), generates and validates the script, and writes `script.json`.
 */
export async function runScriptGeneration(jobId: string, options: RunScriptGenerationOptions = {}): Promise<void> {
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
    providers: options.providers ?? buildProviders(),
    maxAttempts: config.maxAttempts,
    logger,
  });

  // Validate against the shared contract before writing, so a shape change in
  // this service can never publish an artifact downstream steps can't read.
  const script = scriptSchema.parse(result.script);

  // Lightweight fact-check (mechanical, not an LLM call — see factCheck.ts):
  // flag numbers/percentages/years in each segment that never appear in the
  // trend's sourceSummaries, so the reviewer sees a concrete warning instead
  // of trusting the script blindly. Advisory only — never blocks a write.
  const sourceNumbers = sourceNumberIndex(trend.sourceSummaries);
  let segmentsWithWarnings = 0;
  script.segments = script.segments.map((segment) => {
    const warnings = checkSegmentClaims(segment.text, sourceNumbers);
    if (warnings.length === 0) return segment;
    segmentsWithWarnings++;
    return { ...segment, factCheckWarnings: warnings };
  });
  if (segmentsWithWarnings > 0) {
    logger.warn(
      { jobId, segmentsWithWarnings, totalSegments: script.segments.length },
      "Fact-check flagged unverified numeric claims — reviewer should double-check before publishing",
    );
  }

  await store.putJson(store.jobKey(jobId, "script.json"), script);

  logger.info(
    {
      jobId,
      structureId,
      provider: result.providerName,
      model: result.model,
      calls: result.calls,
      segments: script.segments.length,
      segmentsWithFactCheckWarnings: segmentsWithWarnings,
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
