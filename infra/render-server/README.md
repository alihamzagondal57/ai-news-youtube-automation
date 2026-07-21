# render-server

**Runtime:** Node/TypeScript (Express) · **Runs on:** an on-demand Google Compute Engine VM, started per job — not GitHub Actions

Why this exists: 4K Remotion rendering is CPU/memory-heavy and can run well past GitHub Actions' free-tier job limits for longer (15–20 min) videos, so rendering happens on a small VM instead. That VM is only powered on while a job is actually rendering (see `infra/gcp/`), which is why `render-server` — not an external scheduler — owns starting its own idle-shutdown timer once a job finishes.

## Responsibilities
1. Auto-start on VM boot via `systemd` (installed by `infra/gcp/setup/provision-vm.sh.tpl`) and expose `GET /health` so GitHub Actions knows when it's ready to receive work
2. Expose `POST /render` (authenticated via a `RENDER_SERVER_SHARED_SECRET` bearer token), called by the `07-trigger-render.yml` GitHub Actions workflow once all upstream artifacts for a `jobId` exist in R2
3. Pull the job's artifacts from R2 into a local temp dir
4. Bundle and render the `remotion/` composition against those artifacts via `@remotion/renderer`
5. Push `render.mp4` back to R2
6. Call back an n8n webhook with the result (success + R2 path, or failure + error) so the pipeline can continue to `youtube-uploader`
7. `GET /jobs/:id` for render progress polling
8. After a job completes (or after an idle timeout with nothing in flight), shut the VM down (`shutdown -h now`) so it stops billing — gated behind `ENABLE_SELF_SHUTDOWN=true` so local development never accidentally powers off a dev machine

## Render performance at 4K

Measured by `.smoke-test/smoke-test-4k.mts` at 3840x2160, concurrency 4, on a 4-core i5-3470 / 8GB dev box — **not** the production VM, so treat the absolute times as an upper bound and the ratios as the transferable part.

| | frames | time | s/frame |
|---|---|---|---|
| Monolithic reference (1 encode pass) | 180 | 2m 13s | 0.74 |
| Segmented + stitched, cold | 180 | 2m 48s | 0.93 |
| Segmented + stitched, cold (7 chunks) | 285 | 5m 7s | 1.08 |
| **Targeted re-render (3 of 7 chunks)** | 285 | **1m 33s** | — |

Three things this establishes:

- **Stitching is seam-free at 4K**, not just at the 640x360 the main stitch suite uses: PSNR 58.5 dB against a monolithic 4K render, frame-exact, audio in sync. Higher than the ~52 dB the same comparison scores at 360p, because per-pixel encode error shrinks relative to the frame.
- **The chunked path costs ~26% more than a monolithic render on a cold pass** (2m 48s vs 2m 13s). That is the price of N encode passes plus a full-timeline audio render plus concat/mux, and it is only worth paying because re-renders happen — see below.
- **A targeted re-render is ~70% faster than a full one** (1m 33s vs 5m 7s), which is the payoff that justifies the cache.

Two scaling caveats:

- **Per-chunk overhead is real.** s/frame rose from 0.93 (4 chunks) to 1.08 (7 chunks) on the same hardware — each chunk is a separate `renderMedia` call with its own browser startup. A 5–20 minute video has far more segments, so this grows. Worth revisiting if segment counts get high.
- **The audio track is re-rendered on every cold render** and its cost scales with total video length, not with the chunks being rebuilt. Cheap here (~1 min); less cheap for a 20-minute video.

`RENDER_CONCURRENCY` caps parallel frame workers. Leave it unset on the VM to use the CPU count; cap it on memory-constrained hosts, since each worker holds a full frame buffer (~33MB at 4K). Peak node RSS stayed under 550MB throughout, so memory was not the constraint here — CPU was.

## Why an on-demand GCE VM instead of GitHub Actions or a serverless option
Chromium-based frame rendering at 4K needs sustained CPU/RAM beyond what's practical/free on a GitHub-hosted runner for a 15–20 minute video, and the project's render infra runs on Google Compute Engine funded by Google for Startups credit. Running it on-demand (start → render → self-stop) rather than always-on keeps that credit going much further than a persistent box would. See [`infra/gcp/README.md`](../gcp/README.md).
