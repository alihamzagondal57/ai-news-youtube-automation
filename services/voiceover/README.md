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
> here means the real-audio end-to-end test actually runs. Kokoro runs in-process
> via `kokoro-js`, so there is no Python TTS dependency either.

## Voice library

A curated catalog of narrator voices (`src/voices.ts`) the review dashboard
offers per video via `review-state.json.voiceId`. Absent an override, the voice
is **auto-rotated** across the top news-anchor voices (see Voice rotation below)
rather than fixed. Two engine kinds back the library:

| Engine | Voices | Notes |
|---|---|---|
| **`kokoro`** ⭐ | 8 Kokoro-82M **neural** voices — American & British, male & female | **Self-hosted, the only production engine.** Apache-2.0, runs on CPU (~86 MB q8 ONNX), 24 kHz native. No egress, no key, no rate limit, no license risk — identical locally, in CI, and on the render VM. |
| **`sapi`** | 2 offline Windows System.Speech voices (David, Zira) | Robotic by comparison. No network, no model weights. Last-resort fallback and an engine the tests can always run. |

An override naming an unknown voice throws rather than silently substituting —
shipping a video in the wrong voice unnoticed is worse than a loud failure.

> **Why no Microsoft Edge neural voices?** An earlier version used them (free,
> higher naturalness), but they were **removed**: the endpoint 403s from
> datacenter IPs (verified on GitHub Actions) *and* Microsoft publishes no terms
> permitting commercial/programmatic use — an unacceptable path for a monetized
> channel. See [`docs/LICENSING.md`](../../docs/LICENSING.md).

## Voice rotation — the third variety axis

Voice is rotated per video the same way themes and script structures are, using
the **same shared rotation helper** (`@ai-news/shared` `rotate()`). Narrating
consecutive videos in a different anchor voice is another lever against the
template-repetition ("inauthentic content") concern — on top of a different
*shape* (structure) and a different *look* (theme), each video also has a
different *voice*.

`resolveJobVoice()` (`src/voiceSelection.ts`) resolves in priority order,
mirroring `resolveJobStructure()` exactly:

1. **Manual override** — `review-state.json.voiceId` (any library voice,
   including a Kokoro voice outside the rotation pool).
2. **The voice this job already used** — `jobs/{jobId}/voice.json`.
3. **Auto-rotation** — excludes the last `VOICE_AVOID_WINDOW` (2) picks, records
   the choice to `state/voice-rotation.json`.

Step 2 makes the voice **sticky per job**, and it matters more than it does for
structure: **a voice change re-times the entire video** (new audio → new
offsets), so a voiceover retry that re-rolled the voice would desync the
captions, media, and render already built against the first take. Rotation
happens once per job, not once per attempt.

### The rotation pool

`VOICE_ROTATION_POOL` is the best Kokoro voice in each **accent × gender**
quadrant, so every draw moves *both* axes:

| voice | accent | gender | grade |
|---|---|---|---|
| `kokoro-af-heart` | American | female | A |
| `kokoro-bf-emma` | British | female | B- |
| `kokoro-am-michael` | American | male | C+ |
| `kokoro-bm-george` | British | male | C |

The pool is **self-hosted (Kokoro) on purpose**: auto-rotation runs unattended in
CI, so every voice must work with no egress or license risk. A manual override
may still name any library voice (including a Kokoro voice outside the pool); an
out-of-pool override is honored but doesn't enter the pool's rotation history.

### Kokoro voice quality

By Kokoro's own published grades, `af_heart` **A** and `af_bella` **A-**
(American female) are the most natural overall; `bf_emma` **B-** is the best
British voice (the default). Weights default to `q8` (`VOICEOVER_KOKORO_DTYPE`)
for a small, fast CPU download; set `fp32` for maximum fidelity where the time
and disk allow.

## Engine selection — `VOICEOVER_ENGINE`

| Mode | Behaviour |
|---|---|
| `auto` (default) | Run the resolved voice on its own engine — Kokoro for library voices, SAPI for the offline fallbacks. Both are local, so nothing to be "unreachable". |
| `kokoro` | Force the self-hosted Kokoro engine, mapping any request to its gender-matched Kokoro voice. |
| `sapi` | Force the offline engine (maps any request to its gender-matched offline voice). Used by tests and hosts that can't load the Kokoro weights. |

The production library is fully self-hosted, so `auto` runs with no egress and no
key out of the box.

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

- `.smoke-test/test-voiceover.mts` — pure logic: timing math, voice-library
  integrity, voice rotation, Kokoro chunk-splitter + WAV encoder. No network, no
  audio; runs in a second.
- `.smoke-test/test-voice-rotation-persistence.mts` — voice rotation through
  s3rver: no-repeat window, per-job stickiness, override precedence, out-of-pool
  handling, and independence from the theme/structure rotation keys.
- `.smoke-test/e2e-voiceover.mts` — full service through an in-process S3 store
  (s3rver): uploads `script.json`, runs `runVoiceover`, generates **real audio**
  (defaults to `VOICEOVER_ENGINE=kokoro` — self-hosted, so real neural audio in
  CI; override with `=sapi` on a host without the Kokoro weights), then proves the
  timing by feeding it through render-server's **own** `buildInputProps` +
  `buildChunkPlan` — the planner accepts it into a gap-free frame plan or the
  test fails. Verified: `voiceover.wav` @ 24 kHz, timing total == measured audio,
  gap-free, one entry per segment, startFrames land where the planner expects.
