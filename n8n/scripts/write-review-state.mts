// Called by n8n's manual-mode.json workflow (Execute Command node) to seed
// review-state.json at job creation — carries the resolution override chosen
// on review-dashboard's "New job" screen (see reviewOverrides.ts, read by
// render-server) through to the GitHub-Actions-run render step. Written from
// job creation, same convention apps/review-dashboard/server/src/newJob.ts
// and .github/scripts/test-render-in-ci.mts both already use — nothing gates
// on this status until job.json.currentStep actually reaches "review".
//
// Takes base64-encoded JSON for the same quoting reason as write-trend.mts.
//
// Usage: npx tsx n8n/scripts/write-review-state.mts '<base64 json>'
// decoded json: {"jobId": "...", "resolution": {"width": N, "height": N} | null}
import "dotenv/config";
import { JobStore, reviewStateSchema } from "@ai-news/shared";

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: write-review-state.mts '<base64 json>'");
    process.exit(1);
  }
  const input = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  const store = JobStore.fromEnv();
  const reviewState = reviewStateSchema.parse({
    jobId: input.jobId,
    status: "awaiting-review",
    resolution: input.resolution ?? null,
    updatedAt: new Date().toISOString(),
  });
  await store.putJson(store.jobKey(input.jobId, "review-state.json"), reviewState);
  console.log(`Wrote review-state.json for job ${input.jobId} (resolution: ${JSON.stringify(reviewState.resolution)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
