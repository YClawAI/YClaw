output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "core_service_name" {
  value = aws_ecs_service.core.name
}

output "mc_service_name" {
  value = aws_ecs_service.mc.name
}

output "ao_service_name" {
  value = aws_ecs_service.ao.name
}

output "ao_service_url" {
  value = local.ao_url
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "alb_url" {
  value = local.public_base_url
}
