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
    // Interim default while the GCE render VM's billing is being sorted (see
    // docs/SETUP.md and infra/gcp/README.md): 1080p renders locally on a
    // desktop CPU in reasonable time, where 4K does not. The 4K capability
    // itself is untouched — set RENDER_WIDTH=3840 RENDER_HEIGHT=2160 (or any
    // other resolution) to override; nothing else in the render pipeline
    // hardcodes a resolution (NewsVideo.tsx reads width/height from its
    // `resolution` prop, which buildInputProps.ts fills in from this config).
    width: Number(process.env.RENDER_WIDTH ?? 1920),
    height: Number(process.env.RENDER_HEIGHT ?? 1080),
    fps: Number(process.env.RENDER_FPS ?? 30),
  },
  /**
   * Parallel frame workers. Undefined lets Remotion use the CPU count, which is
   * right on the 8-vCPU render VM. Cap it on memory-constrained hosts: each
   * worker holds a full frame buffer, and a 4K frame is ~33MB before encoding.
   */
  renderConcurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : undefined,
  branding: {
    channelName: process.env.CHANNEL_NAME ?? "NationScope",
    accentColor: process.env.ACCENT_COLOR ?? "#e11d2e",
  },

  idleShutdownEnabled: process.env.ENABLE_SELF_SHUTDOWN === "true",
  idleShutdownAfterMs: Number(process.env.IDLE_SHUTDOWN_AFTER_MS ?? 5 * 60_000),
};
