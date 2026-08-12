// Thin CLI wrapper around render-server's real runRender() — render-server's
// own entry point is an HTTP server (infra/render-server/src/index.ts), not a
// per-job CLI, so this gives test-render-in-ci.mts a plain `<script> <jobId>`
// step to shell out to, matching every other pipeline service's CLI shape.
import { createLogger, JobStore } from "@ai-news/shared";
import { runRender } from "../../infra/render-server/src/render.ts";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: render-step.mts <jobId>");
  process.exit(1);
}

const store = JobStore.fromEnv();
const result = await runRender(store, jobId, createLogger("render-step"));
console.log("Render result:", JSON.stringify(result));
if (result.status !== "completed") {
  console.error(`Render did not complete: status=${result.status}`);
  process.exit(1);
}
process.exit(0);
