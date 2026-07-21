# script-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Turns `trend.json` (or a manually supplied topic) into a broadcast-style news script using the Claude API, with Groq (`llama-3.3-70b`) as a fast/cheap fallback. Enforces:

- Runtime target: 5–20 minutes of spoken word (~750–3000 words at ~150 wpm)
- **Structure varies per video** — the skeleton is selected from a rotating catalog rather than fixed (see below), so consecutive videos don't share an opening move, segment rhythm, or outro
- A short on-screen `headline` per segment (rendered in the video's lower-third — distinct from the spoken `text`)
- Explicit `visualCue` per segment (a sourcing instruction, e.g. "stock footage of the ECB building"), used later by `media-sourcing` to fetch matching stock footage — never rendered as on-screen text
- Factual grounding restricted to `sourceSummaries` from `trend.json` — no fabricated claims
- Neutral, EU-audience-appropriate tone; no unverified speculation presented as fact
- **Original-insight layer (required):** every segment's `text` must go beyond restating the source headline — it adds at least one of: context/background, analysis, comparison to prior events, or implications for the EU audience. Verbatim or lightly-reworded headline reading is not acceptable output.

## Why the insight layer is mandatory (not stylistic)

YouTube's 2026 **inauthentic-content** monetization policy explicitly disqualifies verbatim news reading and generic templated content from monetization. A channel that just narrates headlines over stock footage risks demonetization. The insight layer — genuine added context/analysis/implications per segment — is what makes each video transformative rather than a reading of someone else's reporting. This is a hard requirement on the prompt design, not a nice-to-have, and should be reflected in the system prompt and in any output QA checks (e.g. reject a segment whose `text` is too close to its `sourceSummary`).

The prompt must still keep every added claim grounded in `sourceSummaries` — "original insight" means original *framing and analysis*, never invented facts.

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
