import "dotenv/config";
import { buildProviderChain } from "./providers/registry.js";

export const config = {
  /**
   * 3, not 2: live runs showed corrective retries genuinely converging
   * (verbatim lifting fell 13 tokens -> 9 -> under the limit across successive
   * attempts) but needing more than two rounds. Two attempts threw away drafts
   * that were still improving.
   */
  maxAttempts: Number(process.env.SCRIPT_MAX_ATTEMPTS ?? 3),

  /** Same env var and default as infra/render-server's on-screen branding — kept in sync so the spoken script and the video's own lower-third/ticker never name different channels. */
  channelName: process.env.CHANNEL_NAME ?? "NationScope",
};

/**
 * The quality-ranked provider chain, built from whatever credentials exist.
 * See providers/registry.ts — provider identity lives there and nowhere else.
 */
export { buildProviderChain as buildProviders };
