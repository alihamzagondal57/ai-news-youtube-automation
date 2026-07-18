# trend-research

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions (`auto` mode only)

Finds trending, brand-safe European-audience news stories using Firecrawl (`firecrawl_search` / `firecrawl_extract`) against news sources and Google News. Scores candidates for recency, novelty (not already covered on the channel), and copyright-safety (no reliance on paywalled or exclusive footage).

## Input
- `mode: "auto"`, optional `niche` filter (e.g. `world`, `tech`, `business`).

## Output (written to `jobs/{jobId}/trend.json` in R2)
```json
{
  "jobId": "uuid",
  "topic": "string",
  "angle": "string",
  "sourceUrls": ["..."],
  "sourceSummaries": ["..."]
}
```

## Not used in Manual mode
When the user supplies a topic directly, n8n skips this service and writes `trend.json` itself.
