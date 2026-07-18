# oracle-cloud

Provisioning for the always-on render VM.

- `terraform/` — VM shape (`VM.Standard.A1.Flex`, Always Free eligible), networking, security list (only 22/tcp from your IP + 443/tcp for the render-server webhook, nothing else public)
- `setup/provision-vm.sh` — one-time bootstrap run on a fresh VM: installs Node, ffmpeg, Chromium's Remotion system deps (`fonts-liberation`, `libnss3`, etc.), clones this repo, installs the `render-server` + `remotion` workspaces, registers `render-server` as a `systemd` service so it survives reboots

## Why not GCP
GCP's always-free `e2-micro` (1 shared vCPU / 1GB RAM) can't run headless Chromium-based 4K rendering reliably. Oracle's Always Free Ampere shape (up to 4 OCPU / 24GB RAM) is the only major provider's free tier with enough headroom for this workload. Swap this folder for a `gcp/` or `aws/` equivalent later if you outgrow it — `render-server` and `remotion` don't care which VM they run on.
