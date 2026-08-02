// Called by n8n's manual-mode.json workflow (Execute Command node) instead of
// n8n hand-rolling R2/S3 auth itself — reuses the same JobStore every pipeline
// service already uses, so this write is validated by the exact schema
// script-generator reads against, not a hand-maintained duplicate.
//
// Takes base64-encoded JSON, not a raw JSON string arg: the payload holds
// free-form operator text (topic/angle/source summaries) that can contain
// quotes, spaces and shell-special characters, and n8n's Execute Command node
// is a single shell command string — base64 sidesteps quoting entirely rather
// than fighting cmd.exe/bash escaping rules from an n8n expression.
//
// Usage: npx tsx n8n/scripts/write-trend.mts '<base64 json>'
// decoded json: {"jobId": "...", "topic": "...", "angle": "...", "sourceUrls": ["..."], "sourceSummaries": ["..."]}
import "dotenv/config";
import { JobStore, trendSchema } from "@ai-news/shared";

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: write-trend.mts '<base64 json>'");
    process.exit(1);
  }
  const trend = trendSchema.parse(JSON.parse(Buffer.from(raw, "base64").toString("utf-8")));
  const store = JobStore.fromEnv();
  await store.putJson(store.jobKey(trend.jobId, "trend.json"), trend);
  console.log(`Wrote trend.json for job ${trend.jobId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
