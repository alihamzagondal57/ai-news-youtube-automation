import type { ReviewState } from "@ai-news/shared";
import { config } from "./config.js";

/**
 * Notifies n8n's "release-on-approval" workflow that a job was approved, so
 * it can resume and trigger youtube-uploader — the "webhook resume" half of
 * "n8n is waiting on that (webhook resume or poll)" (docs/REVIEW-DASHBOARD.md).
 * Best-effort, same reasoning as render-server's callback.ts: the approval
 * itself already succeeded and persisted to review-state.json by the time
 * this runs, so a failed notification shouldn't undo that or fail the API
 * response — it just means n8n won't hear about it via webhook this time.
 */
export async function notifyApproval(reviewState: ReviewState): Promise<void> {
  if (!config.n8nApprovalWebhookUrl) return;
  try {
    const response = await fetch(config.n8nApprovalWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reviewState),
    });
    if (!response.ok) {
      console.error(`n8n approval webhook returned ${response.status}`);
    }
  } catch (err) {
    console.error("Failed to reach n8n approval webhook:", err);
  }
}
