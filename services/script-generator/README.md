# script-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Turns `trend.json` (or a manually supplied topic) into a broadcast-style news script using the Claude API, with Groq (`llama-3.3-70b`) as a fast/cheap fallback. Enforces:

- Runtime target: 5–20 minutes of spoken word (~750–3000 words at ~150 wpm)
- Structure: cold open hook → headline → body segments → closing/CTA
- A short on-screen `headline` per segment (rendered in the video's lower-third — distinct from the spoken `text`)
- Explicit `visualCue` per segment (a sourcing instruction, e.g. "stock footage of the ECB building"), used later by `media-sourcing` to fetch matching stock footage — never rendered as on-screen text
- Factual grounding restricted to `sourceSummaries` from `trend.json` — no fabricated claims
- Neutral, EU-audience-appropriate tone; no unverified speculation presented as fact

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
