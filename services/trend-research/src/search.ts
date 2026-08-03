import Firecrawl from "firecrawl";
import { config } from "./config.js";

export interface Candidate {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
  /** Scraped article body (markdown), truncated to config.candidateContentChars. Empty if Firecrawl couldn't scrape this hit. */
  content: string;
}

/**
 * Query angles for the default "news-europe" niche — deliberately a few
 * distinct editorial lenses (institutions/politics, economy, and general
 * European-affecting world news) rather than one broad query, so the
 * candidate pool has real variety for the ranking step to choose from instead
 * of five near-duplicate takes on the same top headline.
 */
const NICHE_QUERIES: Record<string, string[]> = {
  "news-europe": [
    "European Union politics news today",
    "Europe economy business news today",
    "European news today",
  ],
};

function queriesForNiche(niche: string): string[] {
  return NICHE_QUERIES[niche] ?? [`${niche} news today`];
}

/**
 * Searches Firecrawl's news vertical across a few query angles for the given
 * niche, deduplicates by URL, and returns up to config.candidateCount
 * candidates with scraped article content attached (requested inline via
 * scrapeOptions — one search call gets both hits and content, rather than a
 * separate scrape() round-trip per URL).
 */
export async function searchCandidates(niche: string = config.niche): Promise<Candidate[]> {
  const firecrawl = new Firecrawl({ apiKey: config.firecrawlApiKey });
  const byUrl = new Map<string, Candidate>();

  for (const query of queriesForNiche(niche)) {
    const result = await firecrawl.search(query, {
      sources: ["news"],
      limit: config.searchLimitPerQuery,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });

    for (const hit of result.news ?? []) {
      const url = "url" in hit ? hit.url : undefined;
      const title = "title" in hit ? hit.title : undefined;
      if (!url || !title || byUrl.has(url)) continue;

      const markdown = "markdown" in hit ? (hit.markdown ?? "") : "";
      byUrl.set(url, {
        title,
        url,
        snippet: "snippet" in hit ? (hit.snippet ?? "") : "",
        date: "date" in hit ? (hit.date ?? null) : null,
        content: markdown.slice(0, config.candidateContentChars),
      });
    }
  }

  return [...byUrl.values()].slice(0, config.candidateCount);
}
