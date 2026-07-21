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

Multi-provider, quality-ranked fallback chain. **Validation thresholds are identical for every provider** — rank sets the order in which providers are *asked*, never how leniently they are *judged*. A provider whose output fails validation falls through exactly like one that returned an HTTP error, and if every provider is exhausted, generation throws. Nothing weak ships.

| Rank | Provider | Default model | Cost | Env var |
|---|---|---|---|---|
| 0 | Anthropic Claude | `claude-opus-4-8` | Paid, ~$0.10–0.15/script | `ANTHROPIC_API_KEY` |
| 1 | Google Gemini (AI Studio) | `gemini-2.5-pro` | Free, no card | `GEMINI_API_KEY` |
| 2 | GitHub Models | `gpt-4o` | Free with GitHub account | `GITHUB_MODELS_TOKEN` |
| 3 | Cerebras Cloud | `qwen-3-235b-a22b-instruct-2507` | Free, ~1M tokens/day | `CEREBRAS_API_KEY` |
| — | ~~Groq~~ | — | — | **disabled, see below** |

Run `npx tsx .smoke-test/provider-status.mts` for the live chain and per-provider setup instructions; `npx tsx .smoke-test/qualify-providers.mts` re-tests every configured provider against the bar.

### Adding or removing a provider

One entry in `src/providers/registry.ts`. Nothing else in the service branches on provider identity. Groq, Cerebras and GitHub Models share a single `OpenAICompatibleProvider` adapter (same wire protocol, differing only in base URL, model and token ceiling); Gemini and Claude have their own adapters because their request shapes differ.

Output-token ceilings live on the **provider**, not on the request — they're a property of the plan, not of the script. A global ceiling either over-requests (Groq's free tier returns 413 above 8k/min) or under-requests and truncates a model that could have gone longer.

### Groq: disabled after measured failure

Two models were tested live against the full bar and **both under-write**:

| Model | Required (`the-explainer`) | Produced |
|---|---|---|
| `llama-3.3-70b-versatile` | 300–450 words/segment | 94–167 |
| `openai/gpt-oss-120b` | 300–450 words/segment | 139–196 |

`gpt-oss-120b` additionally truncates: Groq's free tier caps it at **8,000 tokens per minute** (input + output combined), which also limits retries to roughly one per minute.

Critically, the *compliance* checks were satisfiable — on its best attempt `llama-3.3-70b` passed every novelty, verbatim and insight check, and only word budgets failed. The blocker is length, not analysis quality. Rather than relax the bar or ship short scripts, Groq is marked `disabledReason` in the registry: it stays in the catalog so the evidence isn't lost and so `qualify-providers.mts` can re-test it (e.g. on a paid tier), but it is excluded from the live chain.

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

## Structural variety (the heavier compliance lever)

Original insight alone is not enough. If every script follows one skeleton — same opening move, same segment count, same place the analysis sits, same outro — the channel still reads as one template with the nouns swapped, which is precisely what the inauthentic-content policy targets. Visual themes address the *look*; this addresses the *shape*.

The skeleton is data, not prompt boilerplate. `services/shared/src/script-structure` holds a catalog of **13 structures**, each varying five dimensions:

| dimension | variants |
|---|---|
| opening | question · statistic · scene · direct statement · contrast · historical echo |
| throughline | chronological · thematic · compare/contrast · problem→response · zoom-out · stakeholder lens |
| segment rhythm | 3 deep segments (up to 450 words each) → 7 brief ones (from 115 words) |
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
    { "id": 1, "text": "string", "headline": "string", "visualCue": "string", "estSeconds": 12 }
  ]
}
```

`structureId` records which skeleton the script was written against — for traceability, and so the review dashboard can show it alongside the theme. Also written to `jobs/{jobId}/script-structure.json`, which is what makes the choice sticky across retries.
