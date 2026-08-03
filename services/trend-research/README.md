# trend-research

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions / n8n (`auto` mode only)

Finds a trending, brand-safe European-audience news story using Firecrawl's
`search()` (news vertical, with scraping requested inline so one call returns
both hits and article content — see `src/search.ts`) against a few distinct
European-news query angles, then ranks the candidates with the same
multi-provider LLM chain `script-generator` uses (reused via
`@ai-news/script-generator/providers/registry`, not duplicated) for **viral
potential**, **evergreen value**, and **audience relevance**, steering away
from recently-covered topics via `state/topic-history.json` (soft guidance
fed into the ranking prompt — see `src/prompt.ts` — not a hard rotation
exclusion, since news topics don't come from a fixed catalog the way themes
or script structures do).

## Input
- `jobId` (CLI arg). `TREND_NICHE` (env, default `news-europe`) selects which
  query angles `src/search.ts` uses.

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
Matches `trendSchema` exactly — this is the real input contract
`script-generator` already reads (`sourceSummaries` in particular: it's what
script-generator's anti-plagiarism checks compare the finished script against
to catch verbatim/lightly-reworded lifting, so summaries need to be genuine,
substantial paraphrases of the real article content, not one-line stubs).

## Not used in Manual mode
When the user supplies a topic directly, n8n writes `trend.json` itself
(`n8n/workflows/manual-mode.json`'s "Write trend.json" node) and this service
is skipped entirely.

## Tests
- `.smoke-test/test-trend-validation.mts` — pure-logic unit test of
  `rank.ts`'s index/length validation, no network.
- `.smoke-test/e2e-trend-research.mts` — real Firecrawl search+scrape against
  real news sites, real scraped article content, a real `trend.json` written
  through the real write-path (candidate-index-to-URL mapping, schema
  validation, topic-history state). The ranking LLM call itself is the one
  piece it fakes — every real provider is genuinely, externally unavailable
  at the time of writing (expired token / zero quota / no credits); the test
  first confirms that's real before falling back, and the fake substitutes
  only the external LLM call, never this service's own logic. See the test
  file's header comment for the full reasoning, same pattern as
  `e2e-youtube-uploader.mts` faking the YouTube API client.
