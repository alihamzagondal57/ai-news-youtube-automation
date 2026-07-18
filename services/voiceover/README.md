# voiceover

**Runtime:** Python · **Trigger:** GitHub Actions

Converts `script.json` into a single narrated `voiceover.wav` using `edge-tts` (free Microsoft neural voices). Concatenates per-segment audio with natural pacing pauses, normalizes loudness (EBU R128 via `ffmpeg-normalize`), and records per-segment start/end offsets so downstream steps can align captions and B-roll to audio.

Default voice: `en-GB-RyanNeural` (British English reads naturally as "European" to the target audience). Configurable per niche in `config/niches/*.config.json`.

## Output (`jobs/{jobId}/voiceover.wav`, `jobs/{jobId}/segment-timing.json`)
