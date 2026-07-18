import { exec } from "node:child_process";
import type { Logger } from "@ai-news/shared";
import { config } from "./config.js";

let idleTimer: NodeJS.Timeout | null = null;

/**
 * Powers the VM off after a period with no render in flight, so the GCE
 * instance (see infra/gcp) stops billing between jobs instead of sitting
 * idle. Gated behind ENABLE_SELF_SHUTDOWN so local development (`npm run dev`)
 * never accidentally shuts down a developer's machine — this must only ever
 * be true in the systemd unit provisioned on the actual render VM.
 */
export function scheduleIdleShutdown(logger: Logger): void {
  if (!config.idleShutdownEnabled) {
    return;
  }
  cancelIdleShutdown();
  idleTimer = setTimeout(() => {
    logger.warn({ afterMs: config.idleShutdownAfterMs }, "Idle timeout reached, shutting down VM");
    exec("sudo shutdown -h now", (error) => {
      if (error) {
        logger.error({ err: error }, "Failed to execute shutdown command");
      }
    });
  }, config.idleShutdownAfterMs);
}

export function cancelIdleShutdown(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}
