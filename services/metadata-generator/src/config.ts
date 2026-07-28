import "dotenv/config";

export const config = {
  /**
   * Corrective retries on the SAME provider before falling through to the
   * next one — mirrors script-generator's config.maxAttempts, but metadata
   * failures are structural (bad JSON, over length) rather than the nuanced
   * quality judgments script validation makes, so fewer attempts converge.
   */
  maxAttempts: Number(process.env.METADATA_MAX_ATTEMPTS ?? 2),
};
