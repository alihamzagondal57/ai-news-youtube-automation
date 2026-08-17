# script-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Turns `trend.json` (or a manually supplied topic) into a broadcast-style news script via a quality-ranked multi-provider chain (see Providers below). Enforces:

- Runtime target: 5–20 minutes of spoken word (~750–3000 words at ~150 wpm)
- **Structure varies per video** — the skeleton is selected from a rotating catalog rather than fixed (see below), so consecutive videos don't share an opening move, segment rhythm, or outro
- A short on-screen `headline` per segment (rendered in the video's lower-third — distinct from the spoken `text`)
- Explicit `visualCue` per segment (a sourcing instruction, e.g. "stock footage of the ECB building"), used later by `media-sourcing` to fetch matching stock footage — never rendered as on-screen text
- Factual grounding restricted to `sourceSummaries` from `trend.json` — no fabricated claims
- Neutral, EU-audience-appropriate tone; no unverified speculation presented as fact
- **Original-insight layer (required):** every segment's `text` must go beyond restating the source headline — it adds at least one of: context/background, analysis, comparison to prior events, or implications for the EU audience. Verbatim or lightly-reworded headline reading is not acceptable output.

## Providers

Multi-provider, quality-ranked chain. **Validation thresholds are identical for every provider** — rank sets the order providers are *asked*, never how leniently they are *judged*. A provider whose output fails validation falls through like an HTTP error; if the chain is exhausted, generation throws. Nothing weak ships.

Generation is **two-phase**: one JSON call plans the title, opening, outro and per-segment skeleton; then one plain-text call writes each segment's prose. This is the fix for the wall where a single all-segments-in-one-JSON call made every model ration its budget and under-write each segment ~2x. See `generate.ts`.

### Measured qualification (identical strict bar, both bracket structures)

Run `npx tsx .smoke-test/qualify-providers.mts`; `provider-status.mts` shows the live chain.

| Provider | Model | Verdict | Evidence |
|---|---|---|---|
| Anthropic Claude | claude-opus-4-8 | untested (paid) | Runs first when `ANTHROPIC_API_KEY` is set; key currently unset |
| **Groq** | **openai/gpt-oss-120b** | ✅ **QUALIFIES — free, commercially permitted, currently primary** | Re-measured 2026-08 against the two-phase architecture: rapid-wire PASS (164s, 201-238 w/seg, band 180-320); the-explainer PASS twice (127s, 354-397 w/seg; re-run 144s, 383-493 w/seg, band 330-520). The original disabled-reason's 94-196 w/seg was measured *before* the two-phase per-segment rewrite — see registry.ts's comment. `gpt-oss-120b` is a reasoning model (Groq returns chain-of-thought in a separate `reasoning` field, which eats into the token budget before `content` appears — the real mechanism behind the old failure). Free tier caps it at 8,000 tokens/minute, counted against the *requested* ceiling, not actual usage. **Caveat:** spot-checking real output against its source summaries found the same fact-invention pattern already documented for DeepSeek/Mistral (one run stated the EU's 2030 target as "forty-five percent," a number not in the sources and inconsistent with the real 55% Fit-for-55 target) — the validation bar catches under-length/repetitive/unsourced-insight output, not invented statistics. Fact-check script output before trusting it downstream, same as any other provider here. |
| GitHub Models | gpt-4o | ✅ was qualified (2026-07), 🔴 **permanently retired 2026-07-30** | rapid-wire 212-220, the-explainer 334-385 words/segment when it worked. GitHub fully shut the service down — confirmed via GitHub's own changelog/docs ("the playground, model catalog, inference API, and BYOK are no longer available to any customer"). Not a token problem: a freshly-generated token is independently confirmed VALID against `GET /rate_limit` (200, authenticated tier) but still rejected by the Models endpoint specifically, because that endpoint no longer exists in any working form. No token rotation fixes this. |
| DeepSeek | deepseek-chat | ⏳ pending real balance | Registered 2026-08, paid-only (see docs/LICENSING.md §3.2 — already vetted as commercially compliant). Two keys tried so far both returned $0.00 balance from `GET /user/balance` — DeepSeek is not granting free trial credit to this account; needs an actual funded balance before qualification can run for real. Ranked above Groq for when that happens, but not re-promoted until it's actually re-qualified with real output. |
| Mistral | mistral-large-latest | ✗ disabled | Re-measured 2026-08: rapid-wire passes (229-314 w/seg), the-explainer fails on `verbatim_lifting` across all 10 attempts (400-517 w/seg — length is fine, it copies too many consecutive words from sources). Different failure mode than the earlier 429/rate-limit run — quality is not stable across runs for this provider. |
| OpenRouter | nemotron-120b:free | ✗ disabled | Re-measured 2026-08, same result as before: rapid-wire passes (199-250 w/seg, 841s), the-explainer truncates at the 16k cap (342-428 w/seg reached, 957s). ~14-16 min/structure regardless — impractical even if length were fixed. |
| Gemini | gemini-2.5-pro | ✗ runtime-fail | Free-tier quota is a hard 0 (not a transient rate limit) — needs Cloud Billing enabled on the AI Studio project |
| Cerebras | zai-glm-4.7 | ✗ runtime-fail | All models 402 payment-required — needs billing/credits |

**Groq is the current production default** (2026-08 status) — the only provider that is simultaneously qualified (both bracket structures, for real), reachable, free, and commercially permitted by its own terms. See `.smoke-test/check-provider-health.mts` for a fast, ongoing reachability check (also runs daily via `.github/workflows/check-provider-health.yml`) and `qualify-providers.mts` for the full quality bar. DeepSeek remains ranked above it for when it's funded and re-qualified, since its quality against our bar has never actually been measured (every attempt so far has been a $0-balance 402).

> ### ✅ Groq is commercially permitted — but fact-check before publishing
>
> Groq's Services Agreement (`console.groq.com/docs/legal/services-agreement`
> §8.1) grants the customer full IP ownership of Inputs and Outputs, and this is
> **not tier-gated** — the free tier carries the same commercial-use rights as
> paid. The only restriction (§6.3(f)) is preserving AI-provenance disclosure
> markers on outputs, which this pipeline already does on every upload.
>
> That resolves the *licensing* blocker. It does **not** resolve the
> *hallucination* risk: passing the mechanical validation bar (length,
> anti-lifting, insight-groundedness) is not the same as being fact-checked —
> see the Groq row above for a concrete invented-statistic example. Review
> generated scripts against `trend.json`'s `sourceSummaries` before publishing,
> regardless of which provider produced them.
>
> Measured paid-tier costs remain useful as a fallback if Groq's free tier ever
> becomes unreliable (this pipeline's real token usage is ~9.4k in / 6.0k out
> per 15-min script):
>
> | Paid option | 2 videos/week | 1 video/day | Note |
> |---|---|---|---|
> | DeepSeek V4 Flash | $0.03/mo | $0.09/mo | cheapest viable; quality still unmeasured (never funded) |
> | **Mistral Large 3** | **$0.48/mo** | $1.64/mo | proven to pass rapid-wire; unstable on the-explainer |
> | Gemini 2.5 Flash | $0.08/mo | $0.27/mo | paid tier only |
>
> Full analysis: [`docs/LICENSING.md`](../../docs/LICENSING.md).

### Realistic structure bands

The per-segment word bands were re-based to match how developed prose actually comes out (floors ~180, wider bands, ceilings raised) — applied equally to all providers, so this is not per-provider leniency. The *quality* checks (novelty, verbatim, insight coverage) are unchanged. The segment prompt targets the **lower third** of each band, because models systematically over-write a stated target.

### Adding or removing a provider

One entry in `src/providers/registry.ts`. Groq/Cerebras/GitHub/Mistral/OpenRouter share one `OpenAICompatibleProvider`; Gemini and Claude have their own adapters. A `disabledReason` keeps a measured-failing provider in the catalog (for re-testing) but out of the live chain. Output-token ceilings live on the provider, not the request.

## Why the insight layer is mandatory (not stylistic)

YouTube's 2026 **inauthentic-content** monetization policy explicitly disqualifies verbatim news reading and generic templated content from monetization. A channel that just narrates headlines over stock footage risks demonetization. The insight layer — genuine added context/analysis/implications per segment — is what makes each video transformative rather than a reading of someone else's reporting. This is a hard requirement on the prompt design, not a nice-to-have, and should be reflected in the system prompt and in any output QA checks (e.g. reject a segment whose `text` is too close to its `sourceSummary`).

The prompt must still keep every added claim grounded in `sourceSummaries` — "original insight" means original *framing and analysis*, never invented facts.

### How it's enforced, not just requested

Asking the model for insight isn't enough — a script that reads the news back would still ship. Every generated script is checked mechanically before it is accepted, and generation **throws rather than returning** a script that fails (`src/validate.ts`):

| Check | Catches | Threshold |
|---|---|---|
| Longest shared token run vs sources | Verbatim lifting | > 8 consecutive words |
| Novel content ratio | Reworded restatement that adds nothing | < 35% new content words |
| Insight coverage | An `insight` declared but never written into the narration | < 40% of its key terms present in `text` |
| Insight length / originality | Rubber-stamp or lifted insight | < 6 words, or > 8 words shared with a source |
| Segment count + per-segment words | Drift from the structural brief | the selected structure's own bounds |

The `insight` field is what makes this possible: each segment must state the specific analysis it adds, and that claim is checked against the spoken text. A model can't declare "adds context on prior rate decisions" without writing it — that's the `insight_not_in_text` check, and it's the difference between a requirement and a request.

Two failure modes are caught by *different* checks on purpose: copy-paste trips the shared-run limit, while paraphrasing around it trips novelty. `test-script-validation.mts` calibrates both against crafted fixtures, and its most important assertion is that a genuinely good script **passes** — a validator with false positives would block every generation.

**What this cannot do:** it cannot judge whether the analysis is correct, insightful, or worth watching. That remains a human-review question (the review gate) and a candidate for an LLM-judge pass later. What it does guarantee is that a script which simply restates its sources cannot reach the pipeline.

Failed validation is retried on the same provider with the specific issues fed back as corrective instructions; only a provider-level error (outage, rate limit, refusal, truncation) falls through to the fallback model.

### Fact-check pass (mechanical, advisory — narrows the "correct" gap above)

Every free/cheap provider measured here (DeepSeek, Mistral, Groq — see
`docs/LICENSING.md` §3.2a) occasionally invents a specific number that isn't
in the sources — passing every check above (it's not lifted, it's novel, the
insight is grounded) while still being unsourced or wrong. `src/factCheck.ts`
runs after generation, before `script.json` is written: it extracts every
number/percentage/year from each segment (digit- *and* word-form — "90
percent" and "ninety percent" are the same claim) and flags any whose value
never appears anywhere in `trend.sourceSummaries`. Attached to the segment as
`factCheckWarnings` (omitted when nothing was flagged) and surfaced in
review-dashboard as an amber banner, not blocked here — this is a numeric
cross-reference, not a truth check, and it doesn't gate the write the way
`validate.ts`'s checks do.

## Structural variety (the heavier compliance lever)

Original insight alone is not enough. If every script follows one skeleton — same opening move, same segment count, same place the analysis sits, same outro — the channel still reads as one template with the nouns swapped, which is precisely what the inauthentic-content policy targets. Visual themes address the *look*; this addresses the *shape*.

The skeleton is data, not prompt boilerplate. `services/shared/src/script-structure` holds a catalog of **13 structures**, each varying five dimensions:

| dimension | variants |
|---|---|
| opening | question · statistic · scene · direct statement · contrast · historical echo |
| throughline | chronological · thematic · compare/contrast · problem→response · zoom-out · stakeholder lens |
| segment rhythm | 3 deep segments (up to 560 words each) → 7 brief ones (from 180 words) |
| analysis placement | per-segment · midpoint block · closing block · bookended |
| outro | open question · key takeaways · what to watch · viewer implication |

No two structures share an opening/throughline/analysis/outro combination, and every structure's word budgets are arithmetically constrained to land inside the 5–20 minute runtime target — `test-script-structure.mts` enforces both, so a new structure that breaks the envelope fails the build.

### How it reaches the LLM

`buildStructuralBrief(structure)` renders the selected skeleton into a block of hard constraints that the service embeds in its prompt. The service's own prompt stays fixed; only the brief swaps per video. For example `deep-dive` produces `BODY: 3-3 segments, 280-450 spoken words each`, while `rapid-wire` produces `BODY: 6-7 segments, 115-170 spoken words each` — along with the matching opening, throughline, analysis-placement, and outro directives.

Segment counts and per-segment word budgets in the brief are the same numbers output validation checks against, so the brief and the validator cannot ask for different things.

### Selection and stickiness

Resolved by `resolveJobStructure()` in priority order:

1. **Manual override** — `review-state.json.structureId`, set from the review dashboard.
2. **The structure this job already used** — `jobs/{jobId}/script-structure.json`.
3. **Auto-rotation** — excludes the last 4 skeletons, then records the pick to `state/script-structure-rotation.json`.

Step 2 makes the structure **sticky per job**, and it matters: re-running a failed script-generator step is the pipeline's normal retry path, and re-rolling the skeleton on retry would produce a structurally different script than the one downstream steps were told about. Rotation happens once per job, not once per attempt.

Changing the structure via override regenerates the script and therefore **everything downstream** — voiceover, captions, media, render. It is the most expensive override in the system.

Rotation state is read-modify-write with no lock, which is safe for the one-job-at-a-time pipeline; concurrent jobs could pick the same skeleton, costing variety but breaking nothing.

## Output (`jobs/{jobId}/script.json`)
```json
{
  "jobId": "uuid",
  "title": "string",
  "structureId": "deep-dive",
  "segments": [
    { "id": 1, "text": "string", "headline": "string", "visualCue": "string", "estSeconds": 12, "factCheckWarnings": ["\"2030\" does not appear in any source summary — verify before publishing."] }
  ]
}
```

`structureId` records which skeleton the script was written against — for traceability, and so the review dashboard can show it alongside the theme. Also written to `jobs/{jobId}/script-structure.json`, which is what makes the choice sticky across retries.

`factCheckWarnings` is omitted (not an empty array) on any segment with nothing flagged, so most segments never carry the key — see the fact-check section above.
