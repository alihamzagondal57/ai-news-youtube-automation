# caption-sync

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Transcribes `voiceover.wav` into `captions.json` — word-level timestamps the
Remotion `<Captions>` component highlights in sync with the narration
(karaoke-style). Runs **self-hosted Whisper** through
[`@huggingface/transformers`](https://github.com/huggingface/transformers.js)
(Apache-2.0, ONNX, CPU).

> **Why TypeScript, not Python?** Specced as Python with `faster-whisper`, but
> the rest of the pipeline is Node/TypeScript with a working s3rver end-to-end
> harness, and `@huggingface/transformers` was already vendored (it backs the
> Kokoro TTS engine). Building here means the real-audio end-to-end test actually
> runs — the same call made for voiceover.

> **Why transcribe at all, when we already have `script.json`?** Because only the
> audio knows *when* each word was spoken. The script gives text; Whisper gives
> the timing that makes captions word-synced instead of merely present.

## No external dependency

Same reasoning as the Kokoro TTS engine (see [`docs/LICENSING.md`](../../docs/LICENSING.md)):
the model runs in-process, so there is **no API key, no egress, no rate limit,
and no terms-of-use question** about the output. Once the weights are cached it
needs no network at all, and it behaves identically on a laptop, in GitHub
Actions, and on the render VM.

| | |
|---|---|
| Model | `Xenova/whisper-base.en` (override with `WHISPER_MODEL`) |
| Quantization | `q8` (~50 MB download; `WHISPER_DTYPE`) |
| Device | `cpu` (`WHISPER_DEVICE`) |

**Why `base.en`:** the input is Kokoro TTS — clean, unaccented, no background
noise — so the accuracy/speed sweet spot sits lower than it would for real-world
audio. `tiny.en` drops and mistimes enough words to be visible in karaoke
captions; `small.en` costs several times the runtime for a marginal gain on audio
this clean. English-only (`.en`) because the channel is English and the
monolingual checkpoints beat the multilingual ones at equal size.

## Long-form audio

Whisper's receptive field is a hard **30 seconds**, so a 5–20 minute narration
must be windowed. The pipeline slides a `chunk_length_s: 30` window with
`stride_length_s: 5` of overlap and re-bases each window's timestamps into
whole-file time. The overlap is what stops a word straddling a seam from being
cut in half and mistimed.

This is also the service's most dangerous silent failure: if chunking broke, a
15-minute video would get 30 seconds of captions and no error. So
`runCaptionSync` **hard-fails** when the caption track covers less than half the
audio, and the E2E asserts coverage ≥ 80%.

## Output (`jobs/{jobId}/captions.json`)
```json
{
  "jobId": "uuid",
  "words": [
    { "word": "Good", "start": 0.0, "end": 0.32 },
    { "word": "evening", "start": 0.32, "end": 0.88 }
  ]
}
```

### Why the output is normalized, not passed through

The renderer picks the highlighted word with a linear scan
(`remotion/src/components/captions/WordHighlightCaptions.tsx`):

```ts
const activeIndex = words.findIndex((w) => t >= w.start && t < w.end);
```

That returns the **first** matching span. So an overlap doesn't error — it
silently highlights the wrong word for the whole overlapping stretch, and any
out-of-order entry becomes unreachable. Whisper produces both often enough to
matter, particularly at chunk seams where the same word can be emitted twice with
slightly different timings.

`normalizeWords()` (`src/captions.ts`) therefore guarantees:

- every `word` is non-empty and trimmed (Whisper emits leading spaces: `" the"`);
- `start` is **ascending**;
- spans **never overlap** — each word's end is capped at the next word's start;
- `end > start` for every entry (Whisper occasionally emits zero-length spans on
  short function words, and leaves the last word of a window open with a `null` end);
- everything lies inside `[0, audioDuration]`.

`assertCaptionInvariants()` re-checks all of the above before anything is
written — belt-and-suspenders, in the same spirit as voiceover's
`assertTimingInvariants`. A caption track that violates these renders wrong
rather than failing, and a wrong highlight is far harder to catch in review than
a failed step.

## Tests

- `.smoke-test/test-caption-sync.mts` — pure logic against fixtures drawn from
  real Whisper failure modes: overlaps, back-steps, `null` ends, zero-length
  spans, empty text, out-of-bounds timings. Its most important assertion
  simulates the renderer's own `findIndex` and proves every word is reachable at
  its own midpoint. No model, no audio; runs in a second.
- `.smoke-test/e2e-caption-sync.mts` — the full path on genuinely real data: runs
  **voiceover** to synthesize actual Kokoro audio, then the real `runCaptionSync`
  against it, then feeds the result through render-server's **own**
  `buildInputProps`. Asserts schema conformance, the ordering/overlap invariants,
  coverage of the whole narration, that the transcript actually matches the
  spoken script (≥75% of distinct words), and that the captions arrive intact in
  the render props. Two CPU models end to end, so it is slow — but it needs no
  keys and no network.
