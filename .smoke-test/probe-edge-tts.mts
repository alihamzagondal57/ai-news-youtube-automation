// Probes whether the Edge TTS neural endpoint is reachable from *this* host by
// doing a real synthesis (not just a handshake) and measuring the audio. Prints
// a single machine-greppable result line so it reads clearly in CI logs.
//
// Purpose: the endpoint is egress-gated and returns an empty 403 from some IPs
// (notably this dev sandbox). Running this on a GitHub-hosted ubuntu runner
// tells us whether Edge is usable in production CI, where the egress IP differs.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ffprobePath = (require("ffprobe-static") as { path: string }).path;

async function main() {
  const { EdgeTtsEngine } = await import("../services/voiceover/src/engines/edge.ts");
  const { getVoice, DEFAULT_VOICE_ID } = await import("../services/voiceover/src/voices.ts");

  const engine = new EdgeTtsEngine();
  const voice = getVoice(DEFAULT_VOICE_ID);
  const work = await mkdtemp(join(tmpdir(), "edge-probe-"));
  const out = join(work, "probe.mp3");

  console.log(`Probing Edge TTS with voice "${voice.id}" ...`);
  const reachable = await engine.probe();
  console.log(`handshake probe(): ${reachable}`);

  try {
    const started = Date.now();
    await engine.synthesize(
      "Good evening. Tonight, European lawmakers approved a landmark directive on artificial intelligence liability.",
      voice,
      out,
    );
    const bytes = (await stat(out)).size;
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
      out,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`EDGE_TTS_RESULT: SUCCESS voice=${voice.id} bytes=${bytes} duration=${duration.toFixed(2)}s elapsed=${elapsed}s`);
    await rm(work, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    console.log(`EDGE_TTS_RESULT: FAIL ${(err as Error).message}`);
    await rm(work, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.log(`EDGE_TTS_RESULT: FAIL ${(err as Error).message}`);
  process.exit(1);
});
