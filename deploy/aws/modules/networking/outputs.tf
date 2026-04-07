output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = local.use_nat ? aws_subnet.private[*].id : aws_subnet.public[*].id
  description = "Private subnets if NAT exists, otherwise public subnets (starter tier)"
}

output "ecs_subnet_ids" {
  value       = local.use_nat ? aws_subnet.private[*].id : aws_subnet.public[*].id
  description = "Subnets for ECS tasks — private with NAT or public with assign_public_ip"
}

output "assign_public_ip" {
  value       = !local.use_nat
  description = "true when starter tier (no NAT) — ECS tasks need public IP for ECR pulls"
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "database_security_group_id" {
  value = aws_security_group.database.id
}
