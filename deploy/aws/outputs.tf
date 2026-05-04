output "alb_url" {
  value       = module.compute.alb_url
  description = "URL to access YCLAW (Mission Control + API)"
}

output "alb_dns_name" {
  value       = module.compute.alb_dns_name
  description = "ALB DNS name"
}

output "ecs_cluster" {
  value = module.compute.cluster_name
}

output "core_service" {
  value = module.compute.core_service_name
}

output "mc_service" {
  value = module.compute.mc_service_name
}

output "ao_service" {
  value = module.compute.ao_service_name
}

output "ao_service_url" {
  value       = module.compute.ao_service_url
  description = "Private AO bridge URL used by Core"
}

output "s3_bucket" {
  value = module.storage.bucket_name
}

output "rds_endpoint" {
  value = module.database.rds_endpoint
}

output "redis_endpoint" {
  value = module.cache.redis_endpoint
}

output "log_group" {
  value = module.monitoring.log_group_name
}

output "aws_region" {
  value = var.aws_region
}

output "dns_setup_required" {
  value       = var.domain_name != "" ? "Create a CNAME or alias record pointing ${var.domain_name} to ${module.compute.alb_dns_name}" : "No custom domain configured — access via ALB DNS name"
  description = "DNS configuration instructions (if custom domain is set)"
}
