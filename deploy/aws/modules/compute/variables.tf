variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "cost_tier" {
  type    = string
  default = "starter"
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "ecs_subnet_ids" {
  type = list(string)
}

variable "assign_public_ip" {
  type        = bool
  default     = true
  description = "Assign public IP to ECS tasks (required when no NAT gateway)"
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_security_group_id" {
  type = string
}

variable "ecs_cpu" {
  type    = number
  default = 0
  description = "Override Fargate CPU units. 0 = auto from cost_tier."
}

variable "ecs_memory" {
  type    = number
  default = 0
  description = "Override Fargate memory (MB). 0 = auto from cost_tier."
}

variable "core_image" {
  type    = string
  default = "yclaw/core:latest"
}

variable "mc_image" {
  type    = string
  default = "yclaw/mission-control:latest"
}

# ─── Connection strings (from other modules) ─────────────────────────────────

variable "mongodb_uri" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type = string
}

variable "memory_database_url" {
  type      = string
  sensitive = true
}

variable "s3_bucket" {
  type = string
}

# ─── Discord channel routing ──────────────────────────────────────────────────
# YCLAW is Discord-only. These channel IDs are injected into the core container
# for agent notification routing via channel-routing.ts.

variable "discord_channel_general" {
  type    = string
  default = ""
}

variable "discord_channel_executive" {
  type    = string
  default = ""
}

variable "discord_channel_development" {
  type    = string
  default = ""
}

variable "discord_channel_marketing" {
  type    = string
  default = ""
}

variable "discord_channel_operations" {
  type    = string
  default = ""
}

variable "discord_channel_finance" {
  type    = string
  default = ""
}

variable "discord_channel_support" {
  type    = string
  default = ""
}

variable "discord_channel_audit" {
  type    = string
  default = ""
}

variable "discord_channel_alerts" {
  type    = string
  default = ""
}

variable "secret_arns" {
  type        = map(string)
  description = "Map of env var name → Secrets Manager ARN"
}

variable "all_secret_arns" {
  type        = list(string)
  description = "List of all secret ARNs for IAM policy"
}

variable "log_group_name" {
  type = string
}

# ─── HTTPS (optional) ────────────────────────────────────────────────────────

variable "acm_certificate_arn" {
  type    = string
  default = ""
  description = "ACM certificate ARN for HTTPS. Empty = HTTP only (dev/test)."
}

variable "domain_name" {
  type    = string
  default = ""
  description = "Domain name for Route53 alias. Empty = use ALB DNS name."
}

