// END-TO-END test of the caption-sync SERVICE, on genuinely real data: it runs
// the voiceover service first to synthesize actual Kokoro audio, then runs the
// real runCaptionSync() entry point against that audio — download, decode,
// self-hosted Whisper transcription, normalization — and finally feeds the
// result through render-server's OWN buildInputProps to prove the captions land
// in the render props the way the composition expects.
//
// No API keys and no network: both Kokoro and Whisper run in-process, so this
// is reproducible anywhere. It does real ML inference on CPU, so it is slow.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { buildInputProps } from "../infra/render-server/src/buildInputProps.ts";

const S3_PORT = 4576;
const BUCKET = "ai-news-pipeline";
const JOB_ID = "88888888-8888-8888-8888-888888888888";

// R2 -> s3rver, before importing anything that reads config at load time.
process.env.R2_ACCOUNT_ID = "e2e";
process.env.R2_ACCESS_KEY_ID = "S3RVER";
process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
process.env.R2_BUCKET_NAME = BUCKET;
process.env.R2_ENDPOINT = `http://localhost:${S3_PORT}`;
process.env.R2_FORCE_PATH_STYLE = "true";
process.env.VOICEOVER_ENGINE = process.env.VOICEOVER_ENGINE ?? "kokoro";
// Pin the checkpoint so the test is deterministic and fast regardless of what a
// developer's .env happens to carry (a stale faster-whisper size name there is
// exactly how this test first failed).
process.env.WHISPER_MODEL = "Xenova/whisper-base.en";

// Deliberately short: this runs two CPU ML models end to end. The text is
// plain, clearly-enunciated news copy so the transcript-accuracy assertion is
// about the pipeline working, not about Whisper's limits on hard audio.
const SCRIPT = {
  jobId: JOB_ID,
  title: "European Parliament Approves AI Liability Directive",
  structureId: "deep-dive",
  segments: [
    {
      id: 0,
      text: "Good evening, and welcome to the programme. Tonight, European lawmakers approve a landmark directive on artificial intelligence liability.",
      headline: "AI Liability Directive Approved",
      visualCue: "wide shot of the European Parliament building",
      estSeconds: 8,
    },
    {
      id: 1,
      text: "The directive shifts the burden of proof. Claimants may now request technical information from companies that operate high risk systems.",
      headline: "Burden Of Proof Shifts",
      visualCue: "stock footage of a data centre",
      estSeconds: 8,
    },
    {
      id: 2,
      text: "Industry groups warn that compliance costs could rise for smaller developers. Consumer advocates say the final text is weaker than the original proposal.",
      headline: "Industry And Advocates React",
      visualCue: "stock footage of an office meeting",
      estSeconds: 9,
    },
    {
      id: 3,
      text: "Member states must still sign off, and companies have a two year transition period. That is all for tonight. Thank you for watching.",
      headline: "What Happens Next",
      visualCue: "stock footage of a calendar and clock",
      estSeconds: 8,
    },
  ],
};

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

/** Bag of lowercase alphanumeric tokens, for comparing transcript against script. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "e2e-captions-"));
  const server = new S3rver({
    port: S3_PORT,
    address: "localhost",
    silent: true,
    directory: dataDir,
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  await server.run();
  console.log(`s3rver (R2 stand-in) on :${S3_PORT}\n`);

  try {
    const { JobStore, captionsSchema, segmentTimingSchema } = await import("@ai-news/shared");
    const { runVoiceover } = await import("../services/voiceover/src/index.ts");
    const { runCaptionSync } = await import("../services/caption-sync/src/index.ts");
    const { config } = await import("../services/caption-sync/src/config.ts");

    const store = JobStore.fromEnv();
    await store.putJson(store.jobKey(JOB_ID, "script.json"), SCRIPT);

    // ── Upstream: produce REAL narration audio to caption ────────────────────
    console.log("Generating real voiceover audio (Kokoro)...");
    const tVoice = Date.now();
    await runVoiceover(JOB_ID);
    console.log(`  voiceover done in ${((Date.now() - tVoice) / 1000).toFixed(1)}s\n`);

    // ── The service under test ───────────────────────────────────────────────
    console.log(`Running caption-sync (${config.model}) against that audio...`);
    const tCap = Date.now();
    await runCaptionSync(JOB_ID);
    const capSeconds = (Date.now() - tCap) / 1000;
    console.log(`  caption-sync done in ${capSeconds.toFixed(1)}s\n`);

    // ── captions.json must satisfy the shared contract ───────────────────────
    const captions = await store.getJsonIfExists(store.jobKey(JOB_ID, "captions.json"), captionsSchema);
    check("captions.json written and satisfies captionsSchema", captions !== null, captions ? "parsed" : "MISSING or invalid");
    if (!captions) throw new Error("no captions.json to inspect");

    check("jobId is carried through", captions.jobId === JOB_ID, captions.jobId);
    check("a substantial number of words was produced", captions.words.length >= 40, `${captions.words.length} words`);

    // ── The invariants the renderer depends on ───────────────────────────────
    const words = captions.words;
    let ascending = true;
    let overlapping = false;
    let nonPositive = false;
    for (let i = 0; i < words.length; i++) {
      if (!(words[i].end > words[i].start)) nonPositive = true;
      if (i > 0) {
        if (words[i].start < words[i - 1].start) ascending = false;
        if (words[i].start < words[i - 1].end - 1e-9) overlapping = true;
      }
    }
    check("words are in ascending time order", ascending, "no back-steps");
    check("word spans never overlap", !overlapping, "each word ends at or before the next begins");
    check("every word has a positive span", !nonPositive, "no zero-length words");
    check("no word text is empty", words.every((w) => w.word.trim().length > 0), "all words carry text");
    check("first word starts at or after zero", words[0].start >= 0, `${words[0].start.toFixed(2)}s`);

    // ── Coverage: the long-form chunking actually worked ─────────────────────
    const timing = await store.getJson(store.jobKey(JOB_ID, "segment-timing.json"), segmentTimingSchema);
    const audioSeconds = timing.totalDurationSeconds;
    const lastEnd = words[words.length - 1].end;
    check("captions stay inside the audio", lastEnd <= audioSeconds + 0.05, `last word ends ${lastEnd.toFixed(2)}s, audio is ${audioSeconds.toFixed(2)}s`);
    check(
      "captions cover the whole narration",
      lastEnd >= audioSeconds * 0.8,
      `covered to ${lastEnd.toFixed(2)}s of ${audioSeconds.toFixed(2)}s (${((lastEnd / audioSeconds) * 100).toFixed(0)}%)`,
    );

    // ── The transcript actually matches what was spoken ──────────────────────
    // Guards against a caption track that is well-formed but wrong — e.g. the
    // model transcribing silence, or the audio being decoded at the wrong rate.
    const spoken = new Set(tokens(SCRIPT.segments.map((s) => s.text).join(" ")));
    const heard = new Set(tokens(words.map((w) => w.word).join(" ")));
    const matched = [...spoken].filter((t) => heard.has(t));
    const accuracy = matched.length / spoken.size;
    check(
      "transcript matches the spoken script",
      accuracy >= 0.75,
      `${matched.length}/${spoken.size} distinct script words present (${(accuracy * 100).toFixed(0)}%)`,
    );

    // ── The renderer's own lookup resolves every word ────────────────────────
    const unreachable = words.filter((w) => {
      const t = (w.start + w.end) / 2;
      const hit = words.findIndex((x) => t >= x.start && t < x.end);
      return hit === -1 || words[hit] !== w;
    });
    check(
      "every word is reachable by the renderer's findIndex",
      unreachable.length === 0,
      unreachable.length === 0
        ? "each word highlights at its own midpoint"
        : `${unreachable.length} unreachable, e.g. "${unreachable[0].word}"`,
    );

    // ── The decisive check: render-server accepts these captions ─────────────
    let propsOk = false;
    let propsDetail = "";
    try {
      const props = buildInputProps({
        dir: dataDir,
        script: SCRIPT,
        segmentTiming: timing,
        captions,
        mediaManifest: { jobId: JOB_ID, clips: [], music: null, sfx: [] },
      } as never);
      const carried = props.captionWords.length === words.length;
      const firstMatches =
        props.captionWords[0]?.word === words[0].word &&
        props.captionWords[0]?.start === words[0].start &&
        props.captionWords[0]?.end === words[0].end;
      // Captions are in seconds while segments are in frames; confirm the
      // caption timeline actually spans the rendered video rather than ending early.
      const videoSeconds = props.segments.reduce((n, s) => n + s.durationInFrames, 0) / props.fps;
      propsOk = carried && firstMatches && lastEnd <= videoSeconds + 0.05;
      propsDetail = `${props.captionWords.length} captionWords carried into props; caption timeline ${lastEnd.toFixed(2)}s vs ${videoSeconds.toFixed(2)}s of segment video`;
    } catch (err) {
      propsDetail = `buildInputProps rejected the captions: ${(err as Error).message}`;
    }
    check("render-server buildInputProps accepts the captions", propsOk, propsDetail);

    // ── Show the real output ─────────────────────────────────────────────────
    console.log(`\n── Generated captions ──`);
    console.log(`  ${words.length} words over ${lastEnd.toFixed(1)}s (${audioSeconds.toFixed(1)}s of audio) · model ${config.model}`);
    console.log(`  transcribed in ${capSeconds.toFixed(1)}s (${(audioSeconds / capSeconds).toFixed(2)}x realtime)`);
    console.log(`  first 12 words:`);
    console.log(
      "    " + words.slice(0, 12).map((w) => `${w.word}[${w.start.toFixed(2)}]`).join(" "),
    );

    console.log("");
    console.log(failures === 0 ? "E2E PASSED: voiceover.wav -> captions.json, verified against the render props." : `${failures} failure(s)`);
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
