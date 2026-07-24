import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import WebSocket from "ws";
import type { LibraryVoice } from "../voices.js";
import type { TtsEngine } from "./types.js";

/**
 * Microsoft Edge "Read Aloud" neural TTS over its WebSocket API — free, no key.
 * This is the same protocol the Python `edge-tts` package speaks; it is
 * reimplemented here so the pipeline carries no opaque third-party TTS
 * dependency and the exact bytes on the wire are auditable.
 *
 * The endpoint is DRM-gated: each connection carries a `Sec-MS-GEC` token
 * derived from the current time and a public trusted-client token. The token is
 * time-validated server-side, so a client whose clock disagrees with
 * Microsoft's by more than a few minutes is rejected with an empty 403.
 */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "130.0.2849.68";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// Seconds between the Windows FILETIME epoch (1601-01-01) and the Unix epoch.
const WIN_EPOCH_SECONDS = 11644473600n;

/**
 * The Sec-MS-GEC token: SHA-256 of (current time, floored to a 5-minute
 * boundary and expressed in 100-nanosecond ticks since 1601) concatenated with
 * the trusted client token, uppercased. Matches edge-tts's DRM.generate_sec_ms_gec.
 */
function generateSecMsGec(now: number = Date.now()): string {
  let ticks = BigInt(Math.floor(now / 1000)) + WIN_EPOCH_SECONDS;
  ticks -= ticks % 300n; // floor to the nearest 5 minutes, in seconds
  ticks *= 10_000_000n; // seconds -> 100-nanosecond ticks
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest("hex").toUpperCase();
}

function wssUrl(): string {
  const params = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    "Sec-MS-GEC": generateSecMsGec(),
    "Sec-MS-GEC-Version": `1-${CHROMIUM_FULL_VERSION}`,
  });
  return `${WSS_BASE}?${params.toString()}`;
}

const CONNECT_HEADERS = {
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
};

/** XML-escape text before it goes into an SSML body. */
function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Split long narration into request-sized chunks on sentence boundaries. The
 * Edge endpoint rejects oversized SSML, so a 500-word segment has to be sent as
 * several turns; the resulting audio parts are concatenated into one segment
 * file by the caller-visible `synthesize`, so this split is invisible downstream.
 */
function splitForRequests(text: string, maxChars = 1800): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    // A single sentence longer than the cap still goes out on its own turn.
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

/** One WebSocket turn: connect, send config + one SSML body, collect mp3 bytes until turn.end. */
function synthesizeChunk(text: string, voice: LibraryVoice): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(wssUrl(), { headers: CONNECT_HEADERS });
    const audio: Buffer[] = [];
    let settled = false;

    const done = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      if (err) reject(err);
      else resolve(buf!);
    };

    const timer = setTimeout(() => done(new Error("Edge TTS turn timed out after 30s")), 30_000);

    ws.on("open", () => {
      const configMessage =
        `X-Timestamp:${new Date().toString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                outputFormat: OUTPUT_FORMAT,
              },
            },
          },
        });
      ws.send(configMessage);

      const requestId = randomUUID().replace(/-/g, "");
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voice.locale}'>` +
        `<voice name='${voice.id}'>${escapeSsml(text)}</voice></speak>`;
      ws.send(
        `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${new Date().toString()}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml,
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (data.toString().includes("Path:turn.end")) {
          const merged = Buffer.concat(audio);
          if (merged.length === 0) done(new Error("Edge TTS returned no audio for a turn"));
          else done(null, merged);
        }
        return;
      }
      // Binary frame: 2-byte big-endian header length, then the header block,
      // then the raw audio bytes.
      const headerLength = (data[0] << 8) | data[1];
      audio.push(data.subarray(2 + headerLength));
    });

    ws.on("unexpected-response", (_req, res) => {
      done(
        new Error(
          `Edge TTS refused the connection: HTTP ${res.statusCode} ${res.statusMessage ?? ""}`.trim() +
            ". The Sec-MS-GEC token is time-validated and the endpoint blocks some egress IPs; " +
            "set VOICEOVER_ENGINE=sapi where Edge is unreachable.",
        ),
      );
    });
    ws.on("error", (err: Error) => done(err));
  });
}

export class EdgeTtsEngine implements TtsEngine {
  readonly kind = "edge" as const;

  /** A cheap reachability check against the same endpoint, so "auto" can fall back before it starts. */
  async probe(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const ws = new WebSocket(wssUrl(), { headers: CONNECT_HEADERS });
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* noop */
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 10_000);
      ws.on("open", () => finish(true));
      ws.on("unexpected-response", () => finish(false));
      ws.on("error", () => finish(false));
    });
  }

  async synthesize(text: string, voice: LibraryVoice, outputPath: string): Promise<void> {
    const parts: Buffer[] = [];
    for (const chunk of splitForRequests(text)) {
      parts.push(await synthesizeChunk(chunk, voice));
    }
    await writeFile(outputPath, Buffer.concat(parts));
  }
}

// Exposed for unit testing the DRM token derivation without a network call.
export const __test = { generateSecMsGec, splitForRequests };
