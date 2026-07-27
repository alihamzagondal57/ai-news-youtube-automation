import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore, captionsSchema, createLogger, type Captions } from "@ai-news/shared";
import { decodeToWhisperInput, probeDurationSeconds } from "./audio.js";
import { assertCaptionInvariants, normalizeWords } from "./captions.js";
import { config, modelAliasNotice } from "./config.js";
import { transcribeWords } from "./whisper.js";

/**
 * If the caption track stops less than this far into the audio, something went
 * wrong structurally — almost always long-form chunking silently failing, which
 * would leave a 15-minute video with 30 seconds of captions. A real narration
 * ends on speech, so genuine coverage is well above this.
 */
const MIN_COVERAGE_RATIO = 0.5;

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `voiceover.wav`, transcribes it with a self-hosted Whisper model, and
 * writes `captions.json` — the word-level timings the Remotion `<Captions>`
 * component highlights in sync with the narration.
 *
 * Transcribing the synthetic narration (rather than reusing `script.json`'s
 * text) is what makes the captions *word-synced*: only the actual audio knows
 * when each word was spoken.
 */
export async function runCaptionSync(jobId: string): Promise<void> {
  const logger = createLogger("caption-sync");
  const store = JobStore.fromEnv();

  if (modelAliasNotice) logger.warn({ model: config.model }, modelAliasNotice);

  const work = await mkdtemp(join(tmpdir(), `caption-sync-${jobId}-`));
  try {
    const wavPath = join(work, "voiceover.wav");
    await store.downloadToFile(store.jobKey(jobId, "voiceover.wav"), wavPath);

    const audioDurationSeconds = await probeDurationSeconds(wavPath);
    logger.info(
      { jobId, audioDurationSeconds: Number(audioDurationSeconds.toFixed(2)), model: config.model },
      "Transcribing voiceover",
    );

    const audio = await decodeToWhisperInput(wavPath, join(work, "audio.f32"));
    const started = Date.now();
    const { words: rawWords, text } = await transcribeWords(audio);
    const elapsed = (Date.now() - started) / 1000;

    // Whisper's raw output overlaps and back-steps at chunk seams; the renderer
    // cannot tolerate either. See captions.ts.
    const words = normalizeWords(rawWords, audioDurationSeconds);
    assertCaptionInvariants(words, audioDurationSeconds);

    const lastEnd = words[words.length - 1].end;
    if (lastEnd < audioDurationSeconds * MIN_COVERAGE_RATIO) {
      throw new Error(
        `Captions cover only ${lastEnd.toFixed(1)}s of ${audioDurationSeconds.toFixed(1)}s of audio — ` +
          "long-form chunking likely failed, so most of the video would have no captions.",
      );
    }

    // Parse against the shared contract before writing, so a shape drift fails
    // here rather than in the render step that consumes it.
    const captions: Captions = captionsSchema.parse({ jobId, words });
    await store.putJson(store.jobKey(jobId, "captions.json"), captions);

    logger.info(
      {
        jobId,
        words: captions.words.length,
        coverageSeconds: Number(lastEnd.toFixed(2)),
        audioDurationSeconds: Number(audioDurationSeconds.toFixed(2)),
        transcribeSeconds: Number(elapsed.toFixed(1)),
        preview: text.trim().slice(0, 80),
      },
      "Wrote captions.json",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// CLI: `node dist/index.js <jobId>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: node dist/index.js <jobId>");
    process.exit(1);
  }
  runCaptionSync(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
