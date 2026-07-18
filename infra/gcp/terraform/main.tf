resource "google_service_account" "render_vm" {
  account_id   = "render-vm-sa"
  display_name = "Render VM service account (render-server)"
  description  = "Minimal SA for the on-demand Remotion render VM. R2 access uses access keys, not GCP IAM; self-shutdown needs no API permission."
}

resource "google_compute_address" "render_vm" {
  name   = "${var.instance_name}-ip"
  region = var.region

  # Static so RENDER_SERVER_URL can be a stable secret across stop/start
  # cycles instead of being rediscovered on every render trigger.
}

resource "google_compute_firewall" "render_server" {
  name    = "allow-render-server"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = [tostring(var.render_server_port)]
  }

  source_ranges = var.allowed_ingress_cidrs
  target_tags   = ["render-vm"]

  description = "Exposes render-server's port. The RENDER_SERVER_SHARED_SECRET bearer token is the real access gate — narrow allowed_ingress_cidrs once CI/n8n egress IPs are known."
}

resource "google_compute_instance" "render_vm" {
  name         = var.instance_name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["render-vm"]

  # Instance starts TERMINATED after creation: GitHub Actions starts it on
  # demand per render job, and render-server self-stops when idle/done.
  desired_status = "TERMINATED"

  boot_disk {
    initialize_params {
      image = var.boot_disk_image
      size  = var.boot_disk_size_gb
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.render_vm.address
    }
  }

  service_account {
    email  = google_service_account.render_vm.email
    scopes = ["logging-write", "monitoring-write"]
  }

  metadata = {
    render-server-port = tostring(var.render_server_port)
  }

  metadata_startup_script = templatefile("${path.module}/../setup/provision-vm.sh.tpl", {
    repo_url           = var.repo_url
    repo_ref           = var.repo_ref
    render_server_port = var.render_server_port
  })

  allow_stopping_for_update = true

  labels = {
    purpose = "remotion-render"
  }
}
