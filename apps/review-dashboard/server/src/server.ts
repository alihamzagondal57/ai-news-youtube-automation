import { createReadStream } from "node:fs";
import cors from "@fastify/cors";
import { jobManifestSchema, renderStyleSchema, type JobStore } from "@ai-news/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { getJobDetail, listJobsAwaitingReview } from "./jobs.js";
import { RESOLUTION_PRESET_IDS, startManualJob } from "./newJob.js";
import { notifyApproval } from "./n8nWebhook.js";
import { patchReviewState, removeClipOverride, setReviewStatus, upsertClipOverride } from "./reviewState.js";
import { listThemeCatalog } from "./themes.js";
import { listVoiceCatalog, voiceSamplePath } from "./voices.js";

const reviewStatePatchSchema = z.object({
  voiceId: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
  structureId: z.string().nullable().optional(),
  stylePresetId: z.string().nullable().optional(),
  style: renderStyleSchema.optional(),
});

const clipOverrideBodySchema = z.object({
  segmentId: z.number().int().nonnegative(),
  file: z.string().min(1),
});

const reviewActionBodySchema = z.object({
  reviewedBy: z.string().nullable().optional(),
});

const newJobBodySchema = z.object({
  topic: z.string().min(1),
  angle: z.string().optional(),
  resolution: z.enum([...RESOLUTION_PRESET_IDS] as [string, ...string[]]),
});

/** Built as a factory (not a module-level singleton) so tests can point it at an s3rver-backed JobStore instead of real R2 — see docs/REVIEW-DASHBOARD.md and the e2e test. */
export function buildServer(store: JobStore): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: config.corsOrigin });

  app.get("/api/jobs", async () => {
    const jobs = await listJobsAwaitingReview(store);
    return { jobs };
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return await getJobDetail(store, jobId);
    } catch {
      return reply.code(404).send({ error: `Job ${jobId} not found or missing required artifacts` });
    }
  });

  app.get("/api/themes", async () => ({ themes: listThemeCatalog() }));

  app.get("/api/render-capability", async () => ({
    // Whether a real GCE render VM is configured — 4K works either way, but
    // only fast on the VM; local rendering falls back to the desktop CPU.
    hasRenderVm: Boolean(process.env.GCP_PROJECT_ID),
    resolutions: RESOLUTION_PRESET_IDS,
  }));

  app.post("/api/jobs", async (request, reply) => {
    const parsed = newJobBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const jobId = await startManualJob(parsed.data as { topic: string; angle?: string; resolution: (typeof RESOLUTION_PRESET_IDS)[number] });
      return { jobId };
    } catch (err) {
      return reply.code(502).send({ error: `Could not start job via n8n: ${(err as Error).message}` });
    }
  });

  app.get("/api/jobs/:jobId/status", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const manifest = await store.getJsonIfExists(store.jobKey(jobId, "job.json"), jobManifestSchema);
    if (!manifest) {
      return reply.code(404).send({ error: `Job ${jobId} not found` });
    }
    return manifest;
  });

  app.get("/api/voices", async () => ({ voices: listVoiceCatalog() }));

  app.get("/api/voices/:voiceId/sample", async (request, reply) => {
    const { voiceId } = request.params as { voiceId: string };
    const path = voiceSamplePath(voiceId);
    if (!path) {
      return reply.code(404).send({ error: `No sample audio for voice "${voiceId}"` });
    }
    reply.type("audio/wav");
    return reply.send(createReadStream(path));
  });

  app.patch("/api/jobs/:jobId/review-state", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const parsed = reviewStatePatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    return patchReviewState(store, jobId, parsed.data);
  });

  app.put("/api/jobs/:jobId/clip-override", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const parsed = clipOverrideBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    return upsertClipOverride(store, jobId, parsed.data.segmentId, parsed.data.file);
  });

  app.delete("/api/jobs/:jobId/clip-override/:segmentId", async (request, reply) => {
    const { jobId, segmentId } = request.params as { jobId: string; segmentId: string };
    const id = Number(segmentId);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: `Invalid segmentId "${segmentId}"` });
    }
    return removeClipOverride(store, jobId, id);
  });

  app.post("/api/jobs/:jobId/approve", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const parsed = reviewActionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const reviewState = await setReviewStatus(store, jobId, "approved", parsed.data.reviewedBy ?? null);
    await notifyApproval(reviewState);
    return reviewState;
  });

  app.post("/api/jobs/:jobId/reject", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const parsed = reviewActionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    return setReviewStatus(store, jobId, "rejected", parsed.data.reviewedBy ?? null);
  });

  return app;
}
