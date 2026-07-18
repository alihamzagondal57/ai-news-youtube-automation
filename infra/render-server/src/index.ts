import { createLogger, JobStore, renderJobRequestSchema, type RenderResult } from "@ai-news/shared";
import express from "express";
import { requireSharedSecret } from "./auth.js";
import { notifyN8n } from "./callback.js";
import { config } from "./config.js";
import { runRender } from "./render.js";
import { cancelIdleShutdown, scheduleIdleShutdown } from "./shutdown.js";

const logger = createLogger("render-server");
const app = express();
app.use(express.json());

type JobState = { status: "running" | "completed" | "failed"; result?: RenderResult; error?: string };
const jobStates = new Map<string, JobState>();

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/jobs/:id", (req, res) => {
  const state = jobStates.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Unknown job" });
    return;
  }
  res.status(200).json(state);
});

app.post("/render", requireSharedSecret, (req, res) => {
  const parsed = renderJobRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { jobId } = parsed.data;

  if (jobStates.get(jobId)?.status === "running") {
    res.status(409).json({ error: "Job already rendering" });
    return;
  }

  cancelIdleShutdown();
  jobStates.set(jobId, { status: "running" });
  res.status(202).json({ jobId, status: "running" });

  processJob(jobId).catch((err) => {
    logger.error({ jobId, err }, "Unhandled error processing render job");
  });
});

async function processJob(jobId: string): Promise<void> {
  const jobLogger = logger.child({ jobId });
  let result: RenderResult;
  try {
    const store = JobStore.fromEnv();
    result = await runRender(store, jobId, jobLogger);
    jobStates.set(jobId, { status: "completed", result });
    jobLogger.info("Job completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLogger.error({ err }, "Render failed");
    result = { jobId, status: "failed", renderKey: null, durationSeconds: null, error: message };
    jobStates.set(jobId, { status: "failed", error: message });
  }

  await notifyN8n(result, jobLogger);
  scheduleIdleShutdown(jobLogger);
}

app.listen(config.port, () => {
  logger.info({ port: config.port }, "render-server listening");
  scheduleIdleShutdown(logger);
});
