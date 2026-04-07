output "redis_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  value = 6379
}

output "redis_connection_string" {
  value       = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  description = "Redis connection string with TLS (rediss://)"
}
