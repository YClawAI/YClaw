# Compute module — ECS Fargate cluster, task definitions, services, ALB, IAM
#
# IAM scoping: all container workload IAM lives in this module.
# - ECS task execution role (pull images, read secrets, write logs)
# - ECS task role (S3 access for the application)

locals {
  cpu    = var.ecs_cpu > 0 ? var.ecs_cpu : (var.cost_tier == "production" ? 512 : 256)
  memory = var.ecs_memory > 0 ? var.ecs_memory : (var.cost_tier == "production" ? 1024 : 512)

  use_https = var.acm_certificate_arn != ""

  # Single base URL for both server-side and client-side API references.
  # When HTTPS is enabled, domain_name is required (enforced by root check block)
  # so the https://<alb-dns> fallback is intentionally omitted — ACM certs
  # won't match *.elb.amazonaws.com hostnames.
  public_base_url = local.use_https ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
  namespace_name  = "${var.project_name}.local"
  core_url        = "http://core.${local.namespace_name}:3000"
  ao_url          = "http://ao.${local.namespace_name}:8420"
}

data "aws_caller_identity" "current" {}

# ─── IAM ──────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.project_name}-secrets-read"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.all_secret_arns
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.project_name}-s3-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:HeadObject"]
      Resource = ["arn:aws:s3:::${var.s3_bucket}", "arn:aws:s3:::${var.s3_bucket}/*"]
    }]
  })
}

resource "aws_iam_role" "mc_task" {
  name = "${var.project_name}-mc-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# ─── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = var.cost_tier == "production" ? "enabled" : "disabled"
  }

  tags = { Name = "${var.project_name}-cluster" }
}

# ─── Private Service Discovery ────────────────────────────────────────────────

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = local.namespace_name
  description = "Private service discovery for YCLAW ECS services"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "core" {
  name = "core"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_service_discovery_service" "ao" {
  name = "ao"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ─── ALB ──────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  tags = { Name = "${var.project_name}-alb" }
}

# HTTP listener — always present (redirect to HTTPS if cert configured)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = local.use_https ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = local.use_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "forward" {
      for_each = local.use_https ? [] : [1]
      content {
        target_group {
          arn = aws_lb_target_group.mc.arn
        }
      }
    }
  }
}

# HTTPS listener — only when ACM cert provided
resource "aws_lb_listener" "https" {
  count             = local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.mc.arn
  }
}

# API target group (core runtime)
resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = { Name = "${var.project_name}-api-tg" }
}

# Mission Control target group
resource "aws_lb_target_group" "mc" {
  name        = "${var.project_name}-mc"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = { Name = "${var.project_name}-mc-tg" }
}

# Path-based routing: /api/*, /health, /v1/* → core API
locals {
  api_paths    = ["/api/*", "/health", "/health/*", "/v1/*", "/github/*"]
  listener_arn = local.use_https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = local.listener_arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = local.api_paths
    }
  }
}

# ─── Task Definitions ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "core" {
  family                   = "${var.project_name}-core"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.cpu
  memory                   = local.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "core"
    image     = var.core_image
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    # Non-sensitive config as plaintext environment
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "YCLAW_S3_BUCKET", value = var.s3_bucket },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "REDIS_URL", value = var.redis_url },
      { name = "AO_SERVICE_URL", value = local.ao_url },
      { name = "GITHUB_OWNER", value = var.github_owner },
      { name = "GITHUB_REPO", value = var.github_repo },
      # Discord channel routing — agents are Discord-only
      { name = "DISCORD_CHANNEL_GENERAL", value = var.discord_channel_general },
      { name = "DISCORD_CHANNEL_EXECUTIVE", value = var.discord_channel_executive },
      { name = "DISCORD_CHANNEL_DEVELOPMENT", value = var.discord_channel_development },
      { name = "DISCORD_CHANNEL_MARKETING", value = var.discord_channel_marketing },
      { name = "DISCORD_CHANNEL_OPERATIONS", value = var.discord_channel_operations },
      { name = "DISCORD_CHANNEL_FINANCE", value = var.discord_channel_finance },
      { name = "DISCORD_CHANNEL_SUPPORT", value = var.discord_channel_support },
      { name = "DISCORD_CHANNEL_AUDIT", value = var.discord_channel_audit },
      { name = "DISCORD_CHANNEL_ALERTS", value = var.discord_channel_alerts },
    ]

    # Sensitive values injected from Secrets Manager by ARN
    secrets = [
      for name, arn in var.secret_arns : { name = name, valueFrom = arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "core"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = { Name = "${var.project_name}-core-task" }
}

resource "aws_ecs_task_definition" "mc" {
  family                   = "${var.project_name}-mc"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.mc_task.arn

  container_definitions = jsonencode([{
    name      = "mission-control"
    image     = var.mc_image
    essential = true

    portMappings = [{
      containerPort = 3001
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "PORT", value = "3001" },
      { name = "YCLAW_API_URL", value = local.public_base_url },
      { name = "NEXT_PUBLIC_YCLAW_API_URL", value = local.public_base_url },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "mc"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --spider -q http://localhost:3001/ || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = { Name = "${var.project_name}-mc-task" }
}

resource "aws_ecs_task_definition" "ao" {
  family                   = "${var.project_name}-ao"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.cpu
  memory                   = local.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  ephemeral_storage {
    size_in_gib = var.ao_ephemeral_storage_gib
  }

  container_definitions = jsonencode([{
    name      = "ao"
    image     = var.ao_image
    essential = true

    portMappings = [{
      containerPort = 8420
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "AO_BRIDGE_PORT", value = "8420" },
      { name = "AO_CALLBACK_URL", value = "${local.core_url}/api/ao/callback" },
      { name = "AO_DEFAULT_AGENT", value = var.ao_default_agent },
      { name = "AO_MAX_CONCURRENT", value = tostring(var.ao_max_concurrent) },
      { name = "REDIS_URL", value = var.redis_url },
      { name = "YCLAW_AO_PROJECT", value = var.yclaw_ao_project },
      { name = "YCLAW_REPOS", value = var.yclaw_repos },
      { name = "GITHUB_OWNER", value = var.github_owner },
      { name = "GITHUB_REPO", value = var.github_repo },
    ]

    secrets = [
      for name, arn in var.secret_arns : { name = name, valueFrom = arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ao"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8420/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = { Name = "${var.project_name}-ao-task" }
}

# ─── ECS Services ─────────────────────────────────────────────────────────────

resource "aws_ecs_service" "core" {
  name            = "${var.project_name}-core"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.core.arn
  desired_count   = var.cost_tier == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "core"
    container_port   = 3000
  }

  service_registries {
    registry_arn = aws_service_discovery_service.core.arn
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.project_name}-core-service" }
}

resource "aws_ecs_service" "mc" {
  name            = "${var.project_name}-mc"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.mc.arn
  desired_count   = var.cost_tier == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.mc.arn
    container_name   = "mission-control"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.project_name}-mc-service" }
}

resource "aws_ecs_service" "ao" {
  name            = "${var.project_name}-ao"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ao.arn
  desired_count   = var.cost_tier == "production" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = var.assign_public_ip
  }

  service_registries {
    registry_arn = aws_service_discovery_service.ao.arn
  }

  tags = { Name = "${var.project_name}-ao-service" }
}
