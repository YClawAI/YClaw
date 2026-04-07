# YCLAW AWS Deployment — Root Module
#
# Composes all sub-modules based on user configuration.
# Variables are generated from yclaw.config.yaml via terraform.auto.tfvars.json.

locals {
  llm_key_map = {
    anthropic  = "ANTHROPIC_API_KEY"
    openai     = "OPENAI_API_KEY"
    openrouter = "OPENROUTER_API_KEY"
  }
  llm_api_key_name = lookup(local.llm_key_map, var.llm_provider, "ANTHROPIC_API_KEY")

  mongodb_uri = var.database_type == "documentdb" ? module.database.documentdb_connection_string : var.mongodb_uri
}

# Cross-variable validation: external MongoDB requires a URI
check "mongodb_uri_required" {
  assert {
    condition     = var.database_type != "external" || length(var.mongodb_uri) > 0
    error_message = "mongodb_uri is required when database_type is 'external'. Use MongoDB Atlas free tier or provide your own MongoDB URI."
  }
}

# Cross-variable validation: ACM cert requires domain_name
# (ALB's *.elb.amazonaws.com hostname won't match a custom ACM certificate)
check "acm_requires_domain" {
  assert {
    condition     = var.acm_certificate_arn == "" || length(var.domain_name) > 0
    error_message = "domain_name is required when acm_certificate_arn is set. The ACM certificate must match your custom domain, not the ALB hostname."
  }
}

# ─── Monitoring (first — log group needed by compute) ─────────────────────────

module "monitoring" {
  source = "./modules/monitoring"

  project_name       = var.project_name
  log_retention_days = var.log_retention_days
}

# ─── Networking ───────────────────────────────────────────────────────────────

module "networking" {
  source = "./modules/networking"

  project_name = var.project_name
  aws_region   = var.aws_region
  cost_tier    = var.cost_tier
}

# ─── Database ─────────────────────────────────────────────────────────────────

module "database" {
  source = "./modules/database"

  project_name              = var.project_name
  cost_tier                 = var.cost_tier
  database_type             = var.database_type
  vpc_id                    = module.networking.vpc_id
  subnet_ids                = module.networking.private_subnet_ids
  security_group_id         = module.networking.database_security_group_id
  rds_instance_class        = var.rds_instance_class
  documentdb_instance_class = var.documentdb_instance_class
}

# ─── Cache ────────────────────────────────────────────────────────────────────

module "cache" {
  source = "./modules/cache"

  project_name      = var.project_name
  cost_tier         = var.cost_tier
  subnet_ids        = module.networking.private_subnet_ids
  security_group_id = module.networking.database_security_group_id
  redis_node_type   = var.redis_node_type
}

# ─── Storage ──────────────────────────────────────────────────────────────────

module "storage" {
  source = "./modules/storage"

  project_name = var.project_name
  aws_region   = var.aws_region
  cost_tier    = var.cost_tier
}

# ─── Secrets ──────────────────────────────────────────────────────────────────

module "secrets" {
  source = "./modules/secrets"

  project_name = var.project_name
  secret_values = {
    MONGODB_URI           = local.mongodb_uri
    MEMORY_DATABASE_URL   = module.database.rds_connection_string
    YCLAW_SETUP_TOKEN     = var.setup_token
    EVENT_BUS_SECRET      = var.event_bus_secret
    (local.llm_api_key_name) = var.llm_api_key
  }
}

# ─── Compute ──────────────────────────────────────────────────────────────────

module "compute" {
  source = "./modules/compute"

  project_name          = var.project_name
  aws_region            = var.aws_region
  cost_tier             = var.cost_tier
  vpc_id                = module.networking.vpc_id
  public_subnet_ids     = module.networking.public_subnet_ids
  ecs_subnet_ids        = module.networking.ecs_subnet_ids
  assign_public_ip      = module.networking.assign_public_ip
  alb_security_group_id = module.networking.alb_security_group_id
  ecs_security_group_id = module.networking.ecs_security_group_id
  ecs_cpu               = var.ecs_cpu
  ecs_memory            = var.ecs_memory
  core_image            = var.core_image
  mc_image              = var.mc_image
  mongodb_uri           = local.mongodb_uri
  redis_url             = module.cache.redis_connection_string
  memory_database_url   = module.database.rds_connection_string
  s3_bucket             = module.storage.bucket_name
  secret_arns           = module.secrets.secret_arns
  all_secret_arns       = module.secrets.all_secret_arns
  log_group_name        = module.monitoring.log_group_name
  acm_certificate_arn   = var.acm_certificate_arn
  domain_name           = var.domain_name
}
