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
};

/**
 * The quality-ranked provider chain, built from whatever credentials exist.
 * See providers/registry.ts — provider identity lives there and nowhere else.
 */
export { buildProviderChain as buildProviders };
