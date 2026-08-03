import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  firecrawlApiKey: requireEnv("FIRECRAWL_API_KEY"),

  /** Which editorial niche to search for — parameterizes the search queries in search.ts. */
  niche: process.env.TREND_NICHE ?? "news-europe",

  /** Firecrawl `search()` result limit per query. */
  searchLimitPerQuery: Number(process.env.TREND_SEARCH_LIMIT ?? 8),

  /** How many top (deduped) candidates get sent to the ranking LLM call — keeps the prompt a sane size. */
  candidateCount: Number(process.env.TREND_CANDIDATE_COUNT ?? 10),

  /** Scraped markdown is truncated to this many characters per candidate before it goes into the ranking prompt. */
  candidateContentChars: Number(process.env.TREND_CANDIDATE_CONTENT_CHARS ?? 2500),

  /**
   * Corrective retries on the SAME provider before falling through to the
   * next one — mirrors metadata-generator's config.maxAttempts.
   */
  maxAttempts: Number(process.env.TREND_MAX_ATTEMPTS ?? 2),

  /** How many recently-covered topics to show the ranking prompt, so it steers away from repeats. Soft guidance, not a hard rotation exclusion. */
  recentTopicsWindow: Number(process.env.TREND_RECENT_TOPICS_WINDOW ?? 20),
};
