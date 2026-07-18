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

## Why an on-demand GCE VM instead of GitHub Actions or a serverless option
Chromium-based frame rendering at 4K needs sustained CPU/RAM beyond what's practical/free on a GitHub-hosted runner for a 15–20 minute video, and the project's render infra runs on Google Compute Engine funded by Google for Startups credit. Running it on-demand (start → render → self-stop) rather than always-on keeps that credit going much further than a persistent box would. See [`infra/gcp/README.md`](../gcp/README.md).
