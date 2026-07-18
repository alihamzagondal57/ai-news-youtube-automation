import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  sharedSecret: requireEnv("RENDER_SERVER_SHARED_SECRET"),
  n8nCallbackUrl: process.env.N8N_RENDER_CALLBACK_URL ?? "",

  // The render project this server bundles + renders — a sibling workspace, not a dependency,
  // since Remotion compositions must stay free of this server's Node-only deps (AWS SDK, Express).
  remotionEntryPoint: join(__dirname, "..", "..", "..", "remotion", "src", "index.ts"),
  remotionCompositionId: "NewsVideo",

  video: {
    width: Number(process.env.RENDER_WIDTH ?? 3840),
    height: Number(process.env.RENDER_HEIGHT ?? 2160),
    fps: Number(process.env.RENDER_FPS ?? 30),
  },
  branding: {
    channelName: process.env.CHANNEL_NAME ?? "EuroWire News",
    accentColor: process.env.ACCENT_COLOR ?? "#e11d2e",
  },

  idleShutdownEnabled: process.env.ENABLE_SELF_SHUTDOWN === "true",
  idleShutdownAfterMs: Number(process.env.IDLE_SHUTDOWN_AFTER_MS ?? 5 * 60_000),
};
