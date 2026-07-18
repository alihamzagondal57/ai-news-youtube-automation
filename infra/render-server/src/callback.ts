import type { Logger, RenderResult } from "@ai-news/shared";
import { config } from "./config.js";

/** Notifies n8n that the render step finished (or failed), so the pipeline can continue to youtube-uploader. */
export async function notifyN8n(result: RenderResult, logger: Logger): Promise<void> {
  if (!config.n8nCallbackUrl) {
    logger.warn("N8N_RENDER_CALLBACK_URL not set, skipping callback");
    return;
  }
  try {
    const response = await fetch(config.n8nCallbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, "n8n callback returned non-2xx");
    }
  } catch (err) {
    logger.error({ err }, "Failed to reach n8n callback URL");
  }
}
