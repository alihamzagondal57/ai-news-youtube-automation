// Generates tiny synthetic WAV fixtures for local preview/render so the
// composition can be exercised without real TTS/music assets (or ffmpeg —
// this writes raw PCM directly). Output is gitignored; re-run any time via
// `npm run fixture --workspace=remotion`.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "sample");

const SAMPLE_RATE = 44100;

function writeWav(samples) {
  const dataSize = samples.length * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Envelope-shaped tone bursts with pauses, roughly standing in for speech cadence. */
function synthesizeVoiceoverLike(durationSeconds) {
  const n = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(n);
  const wordFreqs = [180, 210, 160, 230, 195, 175, 205];
  let wordIndex = 0;
  let phaseAcc = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const wordDuration = 0.32;
    const cyclePos = (t % wordDuration) / wordDuration;
    const inWordGap = cyclePos > 0.85;
    const freq = wordFreqs[wordIndex % wordFreqs.length];
    if (i > 0 && Math.floor(t / wordDuration) !== Math.floor((t - 1 / SAMPLE_RATE) / wordDuration)) {
      wordIndex++;
    }
    phaseAcc += (2 * Math.PI * freq) / SAMPLE_RATE;
    const envelope = inWordGap ? 0 : Math.sin(Math.PI * (cyclePos / 0.85));
    samples[i] = inWordGap ? 0 : 0.22 * envelope * Math.sin(phaseAcc);
  }
  return samples;
}

/** Continuous low pad tone, loops under the voiceover. */
function synthesizeMusicLike(durationSeconds) {
  const n = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] =
      0.15 * Math.sin(2 * Math.PI * 110 * t) + 0.08 * Math.sin(2 * Math.PI * 165 * t + 0.3);
  }
  return samples;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const voiceover = writeWav(synthesizeVoiceoverLike(13));
  const music = writeWav(synthesizeMusicLike(8));

  await writeFile(join(outDir, "voiceover.wav"), voiceover);
  await writeFile(join(outDir, "music.wav"), music);

  console.log(`Wrote fixture audio to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
