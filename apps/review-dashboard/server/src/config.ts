import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.REVIEW_DASHBOARD_PORT ?? 4000),

  /** How long a presigned video/clip/audio URL stays valid. Requested fresh per page load, never persisted (see JobStore.getPresignedUrl). */
  presignedUrlTtlSeconds: Number(process.env.REVIEW_DASHBOARD_PRESIGN_TTL_SECONDS ?? 3600),

  /**
   * Sibling workspace, not a dependency — reads the same pre-generated .wav
   * samples services/voiceover/samples already has, so the dashboard doesn't
   * need its own copy or its own generation step for something that's fixed,
   * non-per-job content.
   */
  voiceSamplesDir: join(__dirname, "..", "..", "..", "..", "services", "voiceover", "samples"),

  /**
   * Vite's dev server runs on a different origin (5173) than this API (4000);
   * the built PWA is served statically in production and calls same-origin,
   * but during local dev CORS must be open for the frontend to reach this API
   * at all. "*" is fine here: this API never sits behind auth of its own — it
   * IS the operator's own local review tool, reachable only on localhost.
   */
  corsOrigin: process.env.REVIEW_DASHBOARD_CORS_ORIGIN ?? "*",

  /**
   * n8n's "release-on-approval" workflow webhook (see n8n/README.md and
   * docs/REVIEW-DASHBOARD.md) — the "webhook resume" half of "n8n is waiting
   * on that (webhook resume or poll)". Optional: unset means approve/reject
   * still work and write review-state.json correctly, there's just nothing to
   * notify (matches thumbnail-generator's HUGGINGFACE_API_TOKEN — an
   * optional integration point, not a required one).
   */
  n8nApprovalWebhookUrl: process.env.N8N_APPROVAL_WEBHOOK_URL || null,

  /**
   * n8n's manual-mode workflow's own webhook trigger ("On webhook
   * submission" in n8n/scripts/_build-manual-mode.mjs) — the "New job"
   * screen POSTs here instead of running any pipeline step itself, same
   * reasoning as every other step: this dashboard's process stays light,
   * the actual work runs on GitHub Actions via n8n's dispatch-and-poll
   * nodes. Defaults to n8n's own default local port.
   */
  n8nManualModeWebhookUrl: process.env.N8N_MANUAL_MODE_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/manual-mode-start-api",

  /**
   * n8n's own REST management API (activate/deactivate a workflow) — used
   * only by the Auto Mode on/off toggle (n8nAdmin.ts), which is the one
   * dashboard feature that needs to actually manage a workflow rather than
   * just call a webhook it exposes. Login, not an API key: n8n's community
   * edition has no API-key auth for this endpoint, only session cookies from
   * /rest/login. Same non-secret local-only login already documented in
   * n8n/scripts/_workflow-helpers.mjs and docs/HOW-TO-RUN.md.
   */
  n8nUrl: process.env.N8N_URL || "http://127.0.0.1:5678",
  n8nAdminEmail: process.env.N8N_ADMIN_EMAIL || "operator@localhost.local",
  n8nAdminPassword: process.env.N8N_ADMIN_PASSWORD || "LocalOnly-Pipeline2026!",
};
