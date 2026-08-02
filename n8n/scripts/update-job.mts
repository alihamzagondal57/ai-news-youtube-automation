// Called by n8n after each pipeline step succeeds (or by shared-error-handling
// on failure) to create/advance jobs/{jobId}/job.json. No pipeline service
// writes this file itself (see docs/PIPELINE.md's "job.json is owned by n8n,
// not the individual services") — this script is n8n's own write path,
// reusing JobStore rather than n8n hand-rolling R2 auth.
//
// Idempotent by design: if job.json already exists, its createdAt is
// preserved and only the fields passed in are changed; if it doesn't exist
// yet, this call creates it (createdAt = now). n8n never needs to know
// whether a given call is the "first" one.
//
// Takes base64-encoded JSON, not a raw JSON string arg — the optional `error`
// field can carry an arbitrary caught-exception message (quotes, spaces,
// shell-special characters), and n8n's Execute Command node is a single shell
// command string; base64 sidesteps quoting entirely.
//
// Usage: npx tsx n8n/scripts/update-job.mts '<base64 json>'
// decoded json: {"jobId": "...", "mode": "manual"|"auto", "status": "pending"|"running"|"completed"|"failed",
//          "currentStep": "script-generator"|...|null, "niche": "...", "error"?: "..." }
import "dotenv/config";
import { JobStore, jobManifestSchema } from "@ai-news/shared";

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: update-job.mts '<base64 json>'");
    process.exit(1);
  }
  const input = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  const store = JobStore.fromEnv();
  const key = store.jobKey(input.jobId, "job.json");
  const existing = await store.getJsonIfExists(key, jobManifestSchema);

  const now = new Date().toISOString();
  const manifest = jobManifestSchema.parse({
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  await store.putJson(key, manifest);
  console.log(`job.json for ${manifest.jobId}: currentStep=${manifest.currentStep} status=${manifest.status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
