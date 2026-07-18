# caption-sync

**Runtime:** Python · **Trigger:** GitHub Actions

Runs `faster-whisper` (word-level timestamps) against `voiceover.wav` to produce a word-synced caption track, used by the Remotion `<Captions>` component to highlight each word as it's spoken.

## Output (`jobs/{jobId}/captions.json`)
```json
{
  "words": [
    { "word": "string", "start": 0.42, "end": 0.61 }
  ]
}
```

Model size defaults to `medium` (accuracy/speed balance); overridable via `WHISPER_MODEL` env var. Runs on CPU in GitHub Actions — small enough to stay within free-tier minutes for a 5–20 min script.
