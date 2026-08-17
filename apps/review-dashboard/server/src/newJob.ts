import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export const RESOLUTION_PRESET_IDS = ["480p", "720p", "1080p", "2k", "4k"] as const;
export type ResolutionPreset = (typeof RESOLUTION_PRESET_IDS)[number];

export interface CreateManualJobInput {
  topic: string;
  angle?: string;
  resolution: ResolutionPreset;
}

/**
 * Starts a manual-mode job by calling n8n's own webhook trigger — this
 * dashboard never runs a pipeline step itself, or writes job.json/
 * trend.json/review-state.json itself. n8n's manual-mode workflow
 * (n8n/scripts/_build-manual-mode.mjs) owns every one of those writes and
 * every actual step, dispatched to GitHub Actions; this call is the exact
 * same door as n8n's own "On form submission" trigger, just a plain POST
 * instead of a filled-in form.
 *
 * The jobId is generated HERE, not inside n8n, specifically so the
 * dashboard can redirect the operator to a live status page immediately
 * without waiting for the (multi-minute-plus) workflow to run — n8n's "Job
 * Context" node uses this id verbatim rather than minting its own (see that
 * node's `f.jobId || uuidv4()` fallback, which only fires for the form
 * trigger, which has no id to pass).
 */
export async function startManualJob(input: CreateManualJobInput): Promise<string> {
  const jobId = randomUUID();
  const res = await fetch(config.n8nManualModeWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, topic: input.topic, angle: input.angle, resolution: input.resolution }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`n8n manual-mode webhook returned ${res.status}: ${body || "(no body)"}`);
  }
  return jobId;
}
