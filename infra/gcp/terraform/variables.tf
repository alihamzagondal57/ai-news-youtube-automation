variable "project_id" {
  description = "GCP project ID (the one with Google for Startups credit applied)"
  type        = string
}

variable "region" {
  description = "GCP region for the render VM"
  type        = string
  default     = "europe-west4"
}

variable "zone" {
  description = "GCP zone for the render VM"
  type        = string
  default     = "europe-west4-a"
}

variable "machine_type" {
  description = "Compute-optimized machine type sized for 4K Remotion rendering"
  type        = string
  default     = "c2-standard-8"
}

variable "boot_disk_size_gb" {
  description = "Boot disk size — holds the OS, Node/Chromium/ffmpeg deps, and per-job temp media"
  type        = number
  default     = 100
}

variable "boot_disk_image" {
  description = "Base OS image"
  type        = string
  default     = "ubuntu-os-cloud/ubuntu-2204-lts"
}

variable "instance_name" {
  description = "Name of the render VM instance"
  type        = string
  default     = "render-vm"
}

variable "repo_url" {
  description = "Git URL of this repo, cloned onto the VM by the startup script"
  type        = string
}

variable "repo_ref" {
  description = "Git ref (branch/tag) to check out on the VM"
  type        = string
  default     = "main"
}

variable "render_server_port" {
  description = "Port render-server listens on"
  type        = number
  default     = 8080
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach render-server's port. Restrict to your n8n/CI egress IPs once known — the shared-secret bearer token is the primary gate in the meantime."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
