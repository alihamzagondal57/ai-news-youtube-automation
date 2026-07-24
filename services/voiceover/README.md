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
(`kokoro-bf-emma` — Kokoro's best-graded British voice; reads as "European" and,
being self-hosted, works where the pipeline actually runs). Three engine kinds
back the library:

| Engine | Voices | Notes |
|---|---|---|
| **`kokoro`** ⭐ | 8 Kokoro-82M **neural** voices — American & British, male & female | **Self-hosted primary.** Apache-2.0, runs on CPU (~86 MB q8 ONNX), 24 kHz native. No egress, no key, no rate limit — identical locally, in CI, and on the render VM. |
| **`edge`** | 13 Microsoft Edge **neural** voices — British, Irish, American, Australian, Canadian; male & female | Higher naturalness, but **403s from datacenter IPs** (see below), so it's only usable from a residential/local machine. Kept for that case. |
| **`sapi`** | 2 offline Windows System.Speech voices (David, Zira) | Robotic by comparison. No network. Last-resort fallback and an engine the tests can always run without model weights. |

Selection is `review-state.json.voiceId` → pipeline default. An override naming
an unknown voice throws rather than silently substituting — shipping a video in
the wrong voice unnoticed is worse than a loud failure.

### Why Kokoro is the primary, not Edge

Edge's neural voices sound marginally more natural, but its synthesize endpoint
returns an empty **`403 Forbidden` from datacenter egress IPs** — verified from
both the dev sandbox *and* a GitHub-hosted `ubuntu-latest` runner (the
`Probe - Edge TTS reachability` workflow). This pipeline runs on GitHub Actions
and a render VM — both datacenter IPs — so Edge cannot be its backbone. Kokoro
has **zero external dependency**: once the weights are cached it needs no
network at all, so it behaves identically everywhere and can't be rate-limited,
blocked, or deprecated out from under the pipeline. That reliability is decisive;
Edge stays in the catalog for anyone rendering from a residential connection.

Kokoro voice quality (its own published grades): `af_heart` **A** and
`af_bella` **A-** (American female) are the most natural overall; `bf_emma`
**B-** is the best British voice (the default). Weights default to `q8`
(`VOICEOVER_KOKORO_DTYPE`) for a small, fast CPU download; set `fp32` for maximum
fidelity where the time and disk allow.

## Engine selection — `VOICEOVER_ENGINE`

| Mode | Behaviour |
|---|---|
| `auto` (default) | Use the resolved voice's native engine. Kokoro and offline voices just run; an **Edge** voice that is unreachable **throws** — unless `VOICEOVER_ALLOW_SAPI_FALLBACK=true`, which degrades to the gender-matched offline voice with a loud warning. |
| `kokoro` | Force the self-hosted Kokoro engine, mapping any request to its gender-matched Kokoro voice. The reliable choice for the automated pipeline. |
| `edge` | Force the Edge neural engine; fail if unreachable (which it is from datacenter IPs — really for residential/local use). Never degrades. |
| `sapi` | Force the offline engine (maps any request to its gender-matched offline voice). Used by tests and any host with no neural engine available. |

The default refuses to silently swap a neural voice for the robotic one — same
"halt rather than ship something visibly worse" stance as script-generator.
Because the default *voice* is now a Kokoro voice, `auto` runs entirely
self-hosted out of the box; no egress, no key.

### A note on the Edge endpoint

Edge's synthesize endpoint is DRM-gated: every connection carries a `Sec-MS-GEC`
token derived from the current time (`src/engines/edge.ts`). The token is
time-validated server-side, and the endpoint **blocks datacenter egress IPs**,
returning an empty `403` — confirmed from both the dev sandbox and a GitHub
`ubuntu-latest` runner via the `Probe - Edge TTS reachability` workflow
(`.smoke-test/probe-edge-tts.mts`). That's why Edge is not the pipeline default;
use it only via `VOICEOVER_ENGINE=edge` from a residential/local machine.

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
  math, voice-library integrity, Kokoro chunk-splitter + WAV encoder. No network,
  no audio; runs in a second.
- `.smoke-test/e2e-voiceover.mts` — full service through an in-process S3 store
  (s3rver): uploads `script.json`, runs `runVoiceover`, generates **real audio**
  (defaults to `VOICEOVER_ENGINE=kokoro` — self-hosted, so real neural audio in
  CI; override with `=sapi` on a host without the Kokoro weights), then proves the
  timing by feeding it through render-server's **own** `buildInputProps` +
  `buildChunkPlan` — the planner accepts it into a gap-free frame plan or the
  test fails. Verified: `voiceover.wav` @ 24 kHz, timing total == measured audio,
  gap-free, one entry per segment, startFrames land where the planner expects.
- `.github/workflows/probe-edge-tts.yml` — one-off `workflow_dispatch` diagnostic
  that runs a real Edge synthesis on an ubuntu runner (the reachability evidence
  above).
