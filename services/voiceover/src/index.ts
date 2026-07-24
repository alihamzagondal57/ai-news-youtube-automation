import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JobStore,
  createLogger,
  reviewStateSchema,
  scriptSchema,
  segmentTimingSchema,
  type SegmentTiming,
} from "@ai-news/shared";
import { concatWav, makeSilence, normalizeLoudness, probeDurationSeconds, toCanonicalWav } from "./audio.js";
import { config } from "./config.js";
import { resolveEngine } from "./engines/index.js";
import { assertTimingInvariants, buildSegmentTiming, type TimelinePiece } from "./timing.js";
import { getVoice, resolveVoiceId } from "./voices.js";

/** Difference we tolerate between the summed piece durations and the finished file (encoder/rounding slack). */
const DURATION_TOLERANCE_SECONDS = 0.05;

/**
 * Pipeline entry point, invoked per job by GitHub Actions.
 *
 * Reads `script.json`, resolves the narrator voice (review override -> default)
 * and a synthesis engine, synthesizes every segment, concatenates them with
 * paced pauses into a single loudness-normalized `voiceover.wav`, and writes
 * `segment-timing.json` — the per-segment offsets render-server turns into
 * frames. Frame-exact sync depends on that timing describing the actual audio,
 * so every offset is measured from the real synthesized pieces.
 */
export async function runVoiceover(jobId: string): Promise<void> {
  const logger = createLogger("voiceover");
  const store = JobStore.fromEnv();

  const script = await store.getJson(store.jobKey(jobId, "script.json"), scriptSchema);

  // Optional per-job voice override from the review dashboard.
  const reviewState = await store.getJsonIfExists(store.jobKey(jobId, "review-state.json"), reviewStateSchema);
  const requestedVoice = getVoice(resolveVoiceId(reviewState?.voiceId ?? config.defaultVoiceId));
  const { engine, voice } = await resolveEngine(requestedVoice, logger);

  logger.info(
    { jobId, segments: script.segments.length, requestedVoice: requestedVoice.id, voice: voice.id, engine: engine.kind },
    "Generating voiceover",
  );

  const work = await mkdtemp(join(tmpdir(), `voiceover-${jobId}-`));
  try {
    // Synthesize each segment, transcode to the canonical format, and measure it.
    const segmentWavs: string[] = [];
    const pieces: TimelinePiece[] = [];
    for (const segment of script.segments) {
      const rawPath = join(work, `seg-${segment.id}.src`);
      const wavPath = join(work, `seg-${segment.id}.wav`);
      await engine.synthesize(segment.text, voice, rawPath);
      await toCanonicalWav(rawPath, wavPath);
      const durationSeconds = await probeDurationSeconds(wavPath);
      segmentWavs.push(wavPath);
      pieces.push({ kind: "segment", id: segment.id, durationSeconds });
      logger.debug({ jobId, segmentId: segment.id, durationSeconds }, "Synthesized segment");
    }

    // One silence clip, measured once, reused between every pair of segments.
    let pauseSeconds = 0;
    let silenceWav: string | null = null;
    if (script.segments.length > 1 && config.interSegmentPauseSeconds > 0) {
      silenceWav = join(work, "pause.wav");
      await makeSilence(config.interSegmentPauseSeconds, silenceWav);
      pauseSeconds = await probeDurationSeconds(silenceWav);
    }

    // Interleave segment, pause, segment, ... into the concat order and the
    // matching timeline. The pause after the last segment is intentionally
    // omitted — the track ends on speech.
    const concatOrder: string[] = [];
    const timelinePieces: TimelinePiece[] = [];
    pieces.forEach((piece, i) => {
      concatOrder.push(segmentWavs[i]);
      timelinePieces.push(piece);
      if (silenceWav && i < pieces.length - 1) {
        concatOrder.push(silenceWav);
        timelinePieces.push({ kind: "pause", durationSeconds: pauseSeconds });
      }
    });

    const joinedPath = join(work, "joined.wav");
    const finalPath = join(work, "voiceover.wav");
    await concatWav(concatOrder, work, joinedPath);
    await normalizeLoudness(joinedPath, finalPath);

    // Build and validate the timing against the render contract.
    const timing = buildSegmentTiming(jobId, timelinePieces);
    assertTimingInvariants(timing, script.segments.map((s) => s.id));

    // Cross-check: the timing's total must match the actual finished audio, or a
    // downstream render would place the outro card at the wrong frame.
    const measuredTotal = await probeDurationSeconds(finalPath);
    if (Math.abs(measuredTotal - timing.totalDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
      throw new Error(
        `Finished voiceover.wav is ${measuredTotal.toFixed(3)}s but segment-timing totals ` +
          `${timing.totalDurationSeconds.toFixed(3)}s (tolerance ${DURATION_TOLERANCE_SECONDS}s)`,
      );
    }

    // Parse against the shared contract before writing — a shape drift here must
    // fail in this service, never in the render step that consumes it.
    const validated: SegmentTiming = segmentTimingSchema.parse(timing);

    await store.putFile(store.jobKey(jobId, "voiceover.wav"), finalPath, "audio/wav");
    await store.putJson(store.jobKey(jobId, "segment-timing.json"), validated);

    logger.info(
      {
        jobId,
        voice: voice.id,
        engine: engine.kind,
        durationSeconds: Number(validated.totalDurationSeconds.toFixed(2)),
        segments: validated.segments.length,
      },
      "Wrote voiceover.wav and segment-timing.json",
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
  runVoiceover(jobId).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
