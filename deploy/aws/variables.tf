# ─── General ──────────────────────────────────────────────────────────────────

variable "project_name" {
  type        = string
  default     = "yclaw"
  description = "Name prefix for all AWS resources"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "cost_tier" {
  type        = string
  default     = "starter"
  description = "starter (single-AZ, small instances, ~$50-80/mo) or production (multi-AZ, HA, ~$300+/mo)"

  validation {
    condition     = contains(["starter", "production"], var.cost_tier)
    error_message = "cost_tier must be 'starter' or 'production'"
  }
}

# ─── Database ─────────────────────────────────────────────────────────────────

variable "database_type" {
  type        = string
  default     = "external"
  description = "external (user provides MONGODB_URI, e.g. Atlas) or documentdb (AWS-managed)"
}

variable "mongodb_uri" {
  type        = string
  default     = ""
  sensitive   = true
  description = "External MongoDB connection string. Required when database_type = external."
}

variable "rds_instance_class" {
  type    = string
  default = ""
  description = "Override RDS instance class. Empty = auto from cost_tier."
}

variable "documentdb_instance_class" {
  type    = string
  default = ""
  description = "Override DocumentDB instance class. Empty = auto from cost_tier."
}

# ─── Cache ────────────────────────────────────────────────────────────────────

variable "redis_node_type" {
  type    = string
  default = ""
  description = "Override Redis node type. Empty = auto from cost_tier."
}

# ─── Compute ──────────────────────────────────────────────────────────────────

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

# ─── HTTPS (optional) ────────────────────────────────────────────────────────

variable "acm_certificate_arn" {
  type    = string
  default = ""
  description = "ACM certificate ARN for HTTPS. Empty = HTTP only (dev/test only — not for production)."
}

variable "domain_name" {
  type    = string
  default = ""
  description = "Custom domain name for the deployment. DNS must be configured externally (CNAME or alias to ALB). Used for app URL configuration and HTTPS certificate validation. Empty = use ALB DNS name."
}

# ─── Application Secrets ──────────────────────────────────────────────────────

variable "setup_token" {
  type      = string
  sensitive = true
  default   = ""
  description = "YCLAW_SETUP_TOKEN for root operator bootstrap"
}

variable "event_bus_secret" {
  type      = string
  sensitive = true
  default   = ""
  description = "EVENT_BUS_SECRET for HMAC-signed event bus"
}

variable "llm_provider" {
  type    = string
  default = "anthropic"
}

variable "llm_api_key" {
  type      = string
  sensitive = true
  default   = ""
  description = "API key for the configured LLM provider"
}

# ─── Discord channel routing ──────────────────────────────────────────────────
# YCLAW is Discord-only. These channel IDs are passed into the core container
# so that channel-routing.ts can post to the correct department channel.
# Defaults are the live production channel IDs — override via tfvars if needed.

variable "discord_channel_general" {
  type        = string
  default     = "1489421589941325904"
  description = "Discord channel ID for #yclaw-general"
}

variable "discord_channel_executive" {
  type        = string
  default     = "1489421619821809735"
  description = "Discord channel ID for #yclaw-executive"
}

variable "discord_channel_development" {
  type        = string
  default     = "1489421639274729502"
  description = "Discord channel ID for #yclaw-development"
}

variable "discord_channel_marketing" {
  type        = string
  default     = "1489421656781885631"
  description = "Discord channel ID for #yclaw-marketing"
}

variable "discord_channel_operations" {
  type        = string
  default     = "1489421674276323368"
  description = "Discord channel ID for #yclaw-operations"
}

variable "discord_channel_finance" {
  type        = string
  default     = "1491454930114973696"
  description = "Discord channel ID for #yclaw-finance"
}

variable "discord_channel_support" {
  type        = string
  default     = "1489421693393965078"
  description = "Discord channel ID for #yclaw-support"
}

variable "discord_channel_audit" {
  type        = string
  default     = "1489421718945661049"
  description = "Discord channel ID for #yclaw-audit"
}

variable "discord_channel_alerts" {
  type        = string
  default     = "1489421877381304391"
  description = "Discord channel ID for #yclaw-alerts"
}

# ─── Monitoring ───────────────────────────────────────────────────────────────

variable "log_retention_days" {
  type    = number
  default = 14
}
