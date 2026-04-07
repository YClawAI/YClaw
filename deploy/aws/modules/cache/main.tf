# Cache module — ElastiCache Redis
#
# Single replication group for both tiers (aws_elasticache_cluster does NOT
# support transit_encryption_enabled — only replication_group does).
#
# Starter: 1 node, no failover
# Production: 2 nodes, automatic failover, multi-AZ

locals {
  node_type      = var.redis_node_type != "" ? var.redis_node_type : (var.cost_tier == "production" ? "cache.t4g.small" : "cache.t4g.micro")
  use_production = var.cost_tier == "production"
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-redis"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.project_name}-redis-subnet-group" }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.project_name}-redis"
  description                = "${var.project_name} Redis"
  node_type                  = local.node_type
  num_cache_clusters         = local.use_production ? 2 : 1
  automatic_failover_enabled = local.use_production
  multi_az_enabled           = local.use_production
  engine_version             = "7.1"
  parameter_group_name       = "default.redis7"
  port                       = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.security_group_id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  snapshot_retention_limit = local.use_production ? 3 : 0

  tags = { Name = "${var.project_name}-redis" }
}
