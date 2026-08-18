// Called by auto-mode.json right after it starts (from either the daily
// schedule or the catch-up webhook — see auto-mode-catchup.mts) to record
// that today's run has happened. check-auto-mode-catchup.mts reads this
// marker to decide whether a missed 6am trigger (PC was off) needs to be
// caught up, and to avoid double-firing on a day the schedule already ran.
//
// Not job-scoped — this lives outside jobs/{jobId}/ since it tracks
// "did auto-mode run today" independent of any single job's outcome.
//
// Usage: npx tsx n8n/scripts/mark-auto-mode-run.mts
import "dotenv/config";
import { JobStore } from "@ai-news/shared";

const MARKER_KEY = "system/auto-mode-last-run.json";

async function main() {
  const store = JobStore.fromEnv();
  // en-CA gives YYYY-MM-DD, and using local time (not toISOString's UTC)
  // matches the schedule trigger's own "triggerAtHour: 6" being interpreted
  // in the server's local timezone, so both sides agree on what day it is.
  const date = new Date().toLocaleDateString("en-CA");
  await store.putJson(MARKER_KEY, { date, markedAt: new Date().toISOString() });
  console.log(`Marked auto-mode as run for ${date}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
