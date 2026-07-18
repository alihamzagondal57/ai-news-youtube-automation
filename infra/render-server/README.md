# render-server

**Runtime:** Node/TypeScript (Express/Fastify) · **Runs on:** Oracle Cloud VM (persistent, not GitHub Actions)

Why this exists: 4K Remotion rendering is CPU/memory-heavy and can run well past GitHub Actions' free-tier job limits for longer (15–20 min) videos, so rendering happens on a small persistent VM instead.

## Responsibilities
1. Expose `POST /render` (authenticated via `RENDER_SERVER_SHARED_SECRET`), called by n8n once all upstream artifacts for a `jobId` exist in R2
2. Pull `jobId`'s artifacts from R2
3. Invoke `@remotion/renderer` against `remotion/` with those artifacts
4. Push `render.mp4` back to R2
5. Call back an n8n webhook with the result (success + R2 path, or failure + error) so the pipeline can continue to `youtube-uploader`
6. `GET /health` for uptime checks; `GET /jobs/:id` for render progress polling

## Why Oracle Cloud
Oracle's Always Free tier includes an Ampere ARM VM (up to 4 OCPU / 24GB RAM) at no cost indefinitely — enough headroom for 4K Remotion renders without paying for compute, unlike GCP/AWS free tiers which are too small for this workload. See `infra/oracle-cloud/`.
