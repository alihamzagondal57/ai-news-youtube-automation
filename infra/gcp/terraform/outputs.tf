output "instance_name" {
  value = google_compute_instance.render_vm.name
}

output "static_ip" {
  description = "Set RENDER_SERVER_URL to http://<this>:<render_server_port>"
  value       = google_compute_address.render_vm.address
}

output "zone" {
  value = google_compute_instance.render_vm.zone
}

output "service_account_email" {
  value = google_service_account.render_vm.email
}
