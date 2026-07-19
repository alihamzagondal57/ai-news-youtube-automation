# script-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Turns `trend.json` (or a manually supplied topic) into a broadcast-style news script using the Claude API, with Groq (`llama-3.3-70b`) as a fast/cheap fallback. Enforces:

- Runtime target: 5–20 minutes of spoken word (~750–3000 words at ~150 wpm)
- Structure: cold open hook → headline → body segments → closing/CTA
- A short on-screen `headline` per segment (rendered in the video's lower-third — distinct from the spoken `text`)
- Explicit `visualCue` per segment (a sourcing instruction, e.g. "stock footage of the ECB building"), used later by `media-sourcing` to fetch matching stock footage — never rendered as on-screen text
- Factual grounding restricted to `sourceSummaries` from `trend.json` — no fabricated claims
- Neutral, EU-audience-appropriate tone; no unverified speculation presented as fact
- **Original-insight layer (required):** every segment's `text` must go beyond restating the source headline — it adds at least one of: context/background, analysis, comparison to prior events, or implications for the EU audience. Verbatim or lightly-reworded headline reading is not acceptable output.

## Why the insight layer is mandatory (not stylistic)

YouTube's 2026 **inauthentic-content** monetization policy explicitly disqualifies verbatim news reading and generic templated content from monetization. A channel that just narrates headlines over stock footage risks demonetization. The insight layer — genuine added context/analysis/implications per segment — is what makes each video transformative rather than a reading of someone else's reporting. This is a hard requirement on the prompt design, not a nice-to-have, and should be reflected in the system prompt and in any output QA checks (e.g. reject a segment whose `text` is too close to its `sourceSummary`).

The prompt must still keep every added claim grounded in `sourceSummaries` — "original insight" means original *framing and analysis*, never invented facts.

## Output (`jobs/{jobId}/script.json`)
```json
{
  "jobId": "uuid",
  "title": "string",
  "segments": [
    { "id": 1, "text": "string", "headline": "string", "visualCue": "string", "estSeconds": 12 }
  ]
}
```
