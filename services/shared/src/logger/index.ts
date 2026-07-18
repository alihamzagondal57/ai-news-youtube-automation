import pino from "pino";

/** Structured JSON logger shared by every Node service so GitHub Actions logs and the render VM's logs read the same way. */
export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
  });
}

export type Logger = ReturnType<typeof createLogger>;
