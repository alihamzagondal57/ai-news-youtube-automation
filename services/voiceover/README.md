# voiceover

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Converts `script.json` into a single narrated `voiceover.wav` plus a
`segment-timing.json` the render pipeline turns into frames. Each script segment
is synthesized separately, the parts are concatenated with a short paced pause
between them, the whole track is loudness-normalized once (EBU R128), and the
per-segment offsets are measured from the real audio.

> **Why TypeScript, not Python?** This service was specced as Python, but the
> entire rest of the pipeline (script-generator, render-server, shared) is
> Node/TypeScript with a working s3rver end-to-end harness, and the repo already
> vendors `ffmpeg-static`/`ffprobe-static` and the `JobStore` client. Building
> here means the real-audio end-to-end test actually runs. The Edge TTS protocol
> is reimplemented natively (no Python `edge-tts` dependency).

## Voice library

A curated catalog of narrator voices (`src/voices.ts`) the review dashboard
offers per video via `review-state.json.voiceId`, with a pipeline default
(`en-GB-RyanNeural` — British male reads as "European" to the target audience).
Two engine kinds back these:

| Engine | Voices | Notes |
|---|---|---|
| **`edge`** | 13 Microsoft Edge **neural** voices — British, Irish, American, Australian, Canadian; male & female | The real library. Free, no key. Production default. |
| **`sapi`** | 2 offline Windows System.Speech voices (David, Zira) | Robotic by comparison. No network. Exists as a last-resort fallback and as the engine the tests can always run. |

Selection is `review-state.json.voiceId` → pipeline default. An override naming
an unknown voice throws rather than silently substituting — shipping a video in
the wrong voice unnoticed is worse than a loud failure.

## Engine selection — `VOICEOVER_ENGINE`

| Mode | Behaviour |
|---|---|
| `auto` (default) | Use the resolved voice's native engine. If it is Edge and Edge is unreachable, **throw** — unless `VOICEOVER_ALLOW_SAPI_FALLBACK=true`, which allows degrading to the gender-matched offline voice with a loud warning. |
| `edge` | Force the neural engine; fail if unreachable. Never degrades. |
| `sapi` | Force the offline engine (maps any request to its gender-matched offline voice). Used by CI/tests and any host with no outbound access to Microsoft's TTS endpoint. |

The default refuses to silently swap a neural voice for the robotic one — same
"halt rather than ship something visibly worse" stance as script-generator.

### A note on the Edge endpoint

Edge's synthesize endpoint is DRM-gated: every connection carries a `Sec-MS-GEC`
token derived from the current time (`src/engines/edge.ts`). The token is
time-validated server-side, and the endpoint also blocks some datacenter egress
IPs, returning an empty `403`. Where Edge is unreachable (some CI sandboxes),
use `VOICEOVER_ENGINE=sapi`. GitHub-hosted `ubuntu-latest` runners normally
reach it fine.

## Output

### `jobs/{jobId}/voiceover.wav`
One continuous, loudness-normalized PCM track (24 kHz mono) — the whole
narration, never cut at a segment boundary.

### `jobs/{jobId}/segment-timing.json`
```json
{
  "jobId": "uuid",
  "totalDurationSeconds": 28.7,
  "segments": [
    { "id": 0, "startSeconds": 0, "endSeconds": 5.73 },
    { "id": 1, "startSeconds": 5.73, "endSeconds": 11.53 }
  ]
}
```

**Frame-exact sync is this file's whole job.** render-server converts it with
`startFrame = round(startSeconds × fps)` and `durationInFrames = round((end −
start) × fps)`, then tiles the timeline from consecutive `startFrame`s
(`infra/render-server/src/segmentPlan.ts`). The contract this service guarantees:

- **one entry per script segment**, in the script's own id order (buildInputProps
  throws if any segment lacks a timing entry — the outro segment included);
- **the first segment starts at 0**;
- **entries are contiguous and gap-free** — the inter-segment pause is folded
  into the *preceding* segment's span, so each segment ends exactly where the
  next begins. A gap would drop frames and an overlap would duplicate them,
  desyncing every frame after the fault against the one continuous audio track;
- **`totalDurationSeconds` equals the real audio length** — cross-checked against
  the finished `voiceover.wav` with `ffprobe` before anything is written.

Every offset is derived from the *measured* duration of the audio that was
actually concatenated (`src/timing.ts`), so the timing matches the waveform to
the sample. `assertTimingInvariants` re-checks all of the above before upload.

## How it fits the render pipeline

A **voice** change re-times the entire video (new audio, new offsets), so it
forces a full re-run of `voiceover → caption-sync → render` — it must never be
sent as a targeted `changedSegmentIds` re-render (see `docs/PIPELINE.md`).

## Tests

- `.smoke-test/test-voiceover.mts` — pure logic: DRM token derivation, timing
  math, voice-library integrity. No network, no audio; runs in a second.
- `.smoke-test/e2e-voiceover.mts` — full service through an in-process S3 store
  (s3rver): uploads `script.json`, runs `runVoiceover`, generates **real audio**
  (forces `VOICEOVER_ENGINE=sapi`, since Edge is unreachable in CI), then proves
  the timing by feeding it through render-server's **own** `buildInputProps` +
  `buildChunkPlan` — the planner accepts it into a gap-free frame plan or the
  test fails.
