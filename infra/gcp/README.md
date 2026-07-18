# gcp

Provisioning for the render VM — Google Cloud Compute Engine.

## Why Compute Engine, and why on-demand
4K Remotion rendering needs real CPU/RAM headroom (headless Chromium per frame, ffmpeg encode), which is why this isn't a GitHub Actions job. This VM is **not** always-on:

- GitHub Actions (`.github/workflows/07-trigger-render.yml`) starts the VM on demand via the Compute Engine API when a job actually needs rendering.
- The VM boots, `render-server` auto-starts via `systemd`, GitHub Actions polls `/health` until it's ready, then POSTs `/render`.
- After the render completes (result uploaded to R2, n8n webhook called), `render-server` shuts the guest OS down (`shutdown -h now`) — GCE treats a guest-initiated shutdown as a stop request automatically, no API call or IAM permission needed, and it **stops compute billing** (only the idle persistent disk keeps costing, a few cents/month for the boot image).

This keeps the $2,000 Google for Startups credit lasting for many months of actual rendering instead of paying for 24/7 idle uptime.

## Machine sizing
Default: `c2-standard-8` (8 vCPU, compute-optimized, 32GB RAM) — Remotion's rendering concurrency scales with CPU count, and compute-optimized instances give more consistent per-vCPU performance than general-purpose `n2` for the CPU-bound Chromium + ffmpeg work. 100GB SSD persistent disk for the boot image, node_modules, Chromium, and per-job temp frames/media.

Adjust `machine_type` / `boot_disk_size_gb` in `terraform/variables.tf` if a render job needs more headroom (e.g. `c2-standard-16` for consistently longer/higher-bitrate videos) — sizing is a knob, not a hard architectural choice.

Default region/zone: `europe-west4-a` (Netherlands) — keeps render infra in the same region as the target European audience and simplifies any future EU data-residency conversation, though it has no effect on viewer-facing latency since this is offline rendering, not serving.

## Structure
- `terraform/` — the VM itself (`google_compute_instance`), a minimally-scoped service account (`render-server` talks to R2 over the public S3-compatible endpoint with access keys, not GCP IAM, and self-shutdown needs no API permission — so this SA only carries default logging/monitoring write scopes), and a firewall rule opening only the `render-server` port
- `setup/provision-vm.sh` — the instance's startup script: installs Node.js 20, ffmpeg, and Chromium's headless system deps, clones this repo, installs the `render-server` + `remotion` workspaces, and registers `render-server` as a `systemd` service that starts on every boot (since the VM stops and restarts per job, this can't rely on a one-time manual setup step)

## First-time setup
```bash
cd infra/gcp/terraform
terraform init
terraform apply \
  -var="project_id=<your-gcp-project-id>" \
  -var="repo_url=https://github.com/<you>/ai-news-youtube-automation.git"
```
Requires `gcloud auth application-default login` first, and a GCP project with the Compute Engine API enabled and (once approved) the Google for Startups credit applied. This provisions real, billable cloud infrastructure — review the plan (`terraform plan`) before applying.

After `apply`, put `terraform output instance_name` / `static_ip` into GitHub Actions secrets (`GCP_INSTANCE_NAME`, `GCP_ZONE`, `GCP_PROJECT_ID`, `RENDER_SERVER_URL=http://<static_ip>:8080`) and a service-account key with `roles/compute.instanceAdmin.v1` as `GCP_SA_KEY`, so `07-trigger-render.yml` can start it. The IP is reserved statically (`google_compute_address`) specifically so it stays constant across every stop/start cycle — otherwise `RENDER_SERVER_URL` would go stale the moment the VM restarted for the next job.

## Delivering secrets to the VM
`render-server` needs its own `.env` (R2 keys, `RENDER_SERVER_SHARED_SECRET`, n8n callback URL) on the box, and that file must never be committed or baked into the startup script (which lives in Terraform state and GCE instance metadata, both of which are broader-access surfaces than they look). Two options:
1. **Simplest**: `gcloud compute scp infra/render-server/.env render-vm:/opt/ai-news-youtube-automation/infra/render-server/.env --zone=<zone>` once, manually, after first boot — it persists on the boot disk across stop/start cycles (the disk isn't wiped, only compute stops).
2. **Better once this is running for real**: move secrets to Secret Manager and have `provision-vm.sh.tpl` fetch them at boot via the metadata server's attached service account — not implemented yet, noted here as the next hardening step.

## Why not GCP's free tier (`e2-micro`)
The always-free `e2-micro` (0.25–2 vCPU burstable, 1GB RAM) can't run headless Chromium-based 4K rendering. This is exactly why the plan is a paid, on-demand-billed `c2-standard-8` funded by the startup credit instead of trying to force rendering into a free-tier shape.
