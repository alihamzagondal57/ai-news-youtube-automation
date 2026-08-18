// Run by start-pipeline.bat every time n8n comes up (every PC boot/restart),
// not just once. n8n's own Schedule Trigger only fires if n8n's process is
// actually running at 06:00 -- if the PC was off, that day's run is silently
// lost with no retry, since there's no missed-cron-tick mechanism for a
// process that wasn't alive to miss it. This is the catch-up half of that:
// if it's on/after the scheduled hour and today hasn't run yet, kick off
// Auto Mode via a dedicated webhook (auto-mode.json's second trigger,
// alongside its normal Daily schedule trigger -- same dual-trigger pattern
// manual-mode.json already uses for its form + webhook triggers).
//
// Safe to run on every startup: if today's run already happened (whether
// from the normal 6am schedule or an earlier catch-up this same day), the
// marker written by mark-auto-mode-run.mts already shows today's date, so
// this is a no-op. Not a global lock, either -- worst case on a race is one
// extra dispatch, not silence, and n8n's own poll-and-wait step design
// tolerates being triggered more than once far better than never running.
//
// Usage: npx tsx n8n/scripts/check-auto-mode-catchup.mts
import "dotenv/config";
import { JobStore } from "@ai-news/shared";
import { z } from "zod";

const markerSchema = z.object({ date: z.string(), markedAt: z.string() });
const MARKER_KEY = "system/auto-mode-last-run.json";
const SCHEDULED_HOUR = 6; // must match auto-mode.json's Daily schedule trigger
const N8N_URL = process.env.N8N_URL || "http://127.0.0.1:5678";
const CATCHUP_WEBHOOK_URL = `${N8N_URL}/webhook/auto-mode-catchup`;

async function main() {
  const store = JobStore.fromEnv();
  const now = new Date();
  const today = now.toLocaleDateString("en-CA");
  const currentHour = now.getHours();

  const marker = await store.getJsonIfExists(MARKER_KEY, markerSchema);
  const lastRunDate = marker?.date ?? null;

  if (lastRunDate === today) {
    console.log(`Auto-mode already ran today (${today}) -- nothing to catch up.`);
    return;
  }
  if (currentHour < SCHEDULED_HOUR) {
    console.log(`It's before ${SCHEDULED_HOUR}:00 local time -- today's normal schedule trigger hasn't happened yet, no catch-up needed.`);
    return;
  }

  console.log(`Auto-mode hasn't run today (last run: ${lastRunDate ?? "never"}) and it's past ${SCHEDULED_HOUR}:00 -- catching up now.`);
  const res = await fetch(CATCHUP_WEBHOOK_URL, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Catch-up webhook returned ${res.status}: ${await res.text().catch(() => "(no body)")}`);
  }
  console.log("Catch-up triggered -- auto-mode is starting a job now.");
}

main().catch((err) => {
  // Non-fatal by design: a failed catch-up check should never block
  // start-pipeline.bat from bringing up the rest of the pipeline.
  console.error("Auto-mode catch-up check failed (non-fatal):", err.message ?? err);
});
