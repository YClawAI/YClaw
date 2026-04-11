terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.30.0"
    }
  }

  backend "s3" {
    bucket = "<TERRAFORM_STATE_BUCKET>"
    key    = "agents/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment (staging, production)"
  type        = string
  default     = "production"
}

variable "image_tag" {
  description = "Docker image tag"
  type        = string
  default     = "latest"
}

variable "telegram_chat_id" {
  description = "Telegram group chat ID for KEEPER agent"
  type        = string
  default     = ""
}

variable "github_username" {
  description = "GitHub username for agent assignees and approved deployers"
  type        = string
}

variable "openclaw_url" {
  description = "OpenClaw gateway URL (e.g., http://<host>:<port>)"
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "VPC ID (shared networking only)"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Fargate tasks"
  type        = list(string)
}

# ─── ECS Cluster ────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "yclaw" {
  name = "yclaw-cluster-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# moved block removed — gaze cluster dropped from state, yclaw cluster imported directly

# ─── ECR Repository ──────────────────────────────────────────────────────────

resource "aws_ecr_repository" "agents" {
  name                 = "yclaw"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecr_repository" "showcase" {
  name                 = "yclaw-showcase"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Project = "yclaw"
  }
}

resource "aws_ecr_lifecycle_policy" "showcase" {
  repository = aws_ecr_repository.showcase.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

resource "aws_ecr_repository" "ao" {
  name                 = "yclaw-ao"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "ao" {
  repository = aws_ecr_repository.ao.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# ─── Secrets ──────────────────────────────────────────────────────────────────
#
# Store API keys as individual key/value pairs in a single JSON secret.
# The ECS task definition references each key individually so the container
# receives them as separate environment variables.
#
# Populate via CLI:
#   aws secretsmanager put-secret-value --secret-id yclaw/<env>/secrets \
#     --secret-string '{"ANTHROPIC_API_KEY":"sk-...","SLACK_BOT_TOKEN":"xoxb-...",
#       "REDIS_URL":"redis://...","MONGODB_URI":"mongodb+srv://...",...}'

resource "aws_secretsmanager_secret" "agent_secrets" {
  name        = "yclaw/${var.environment}/secrets"
  description = "YClaw Agent System API keys and credentials"
}

# ─── IAM ──────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "task_execution" {
  name = "yclaw-task-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_policy" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "secrets-access"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.agent_secrets.arn]
      }
    ]
  })
}

resource "aws_iam_role" "task_role" {
  name = "yclaw-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_policy" {
  name = "task-policy"
  role = aws_iam_role.task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SES"
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = ["arn:aws:ses:${var.aws_region}:*:identity/*<YOUR_DOMAIN>"]
      },
      {
        Sid    = "ECSReadOwn"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:DescribeAlarms",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks"
        ]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "ecs:cluster" = aws_ecs_cluster.yclaw.arn
          }
        }
      },
      {
        Sid      = "ECSUpdateOwn"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService"]
        Resource = [aws_ecs_service.agents.id]
      },
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.agents.arn}:*",
          "${aws_cloudwatch_log_group.ao.arn}:*"
        ]
      }
    ]
  })
}

# ─── CloudWatch Log Group ────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "agents" {
  name              = "/ecs/yclaw"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "ao" {
  name              = "/ecs/yclaw-ao"
  retention_in_days = 30
}

# ─── ECS Task Definition ─────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "agents" {
  family                   = "yclaw-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "2048"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  # Ephemeral volumes for writable paths (read-only root filesystem).
  # Data persists for the task's lifetime only — fresh on each deployment.
  volume { name = "departments" }
  volume { name = "prompts" }
  volume { name = "memory" }
  volume { name = "logs" }
  volume { name = "tmp" }
  volume { name = "custom-tools" }

  container_definitions = jsonencode([
    {
      name  = "yclaw"
      image = "${aws_ecr_repository.agents.repository_url}:${var.image_tag}"

      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      # Individual secret keys extracted from the JSON secret.
      # Every key listed here MUST exist in the Secrets Manager JSON blob.
      # Key names must match what the application code reads from process.env.
      secrets = [
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:ANTHROPIC_API_KEY::" },
        { name = "OPENROUTER_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:OPENROUTER_API_KEY::" },
        { name = "MONGODB_URI", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:MONGODB_URI::" },
        { name = "MONGODB_DB", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:MONGODB_DB::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:REDIS_URL::" },
        { name = "SLACK_BOT_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:SLACK_BOT_TOKEN::" },
        { name = "SLACK_SIGNING_SECRET", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:SLACK_SIGNING_SECRET::" },
        { name = "TWITTER_APP_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TWITTER_APP_KEY::" },
        { name = "TWITTER_APP_SECRET", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TWITTER_APP_SECRET::" },
        { name = "TWITTER_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TWITTER_ACCESS_TOKEN::" },
        { name = "TWITTER_ACCESS_SECRET", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TWITTER_ACCESS_SECRET::" },
        { name = "TWITTERAPI_IO_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TWITTERAPI_IO_KEY::" },
        { name = "XAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:XAI_API_KEY::" },
        { name = "TELEGRAM_BOT_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELEGRAM_BOT_TOKEN::" },
        { name = "INSTAGRAM_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:INSTAGRAM_ACCESS_TOKEN::" },
        { name = "INSTAGRAM_BUSINESS_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:INSTAGRAM_BUSINESS_ID::" },
        { name = "TIKTOK_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TIKTOK_ACCESS_TOKEN::" },
        { name = "GITHUB_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_TOKEN::" },
        { name = "GITHUB_APP_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_ID::" },
        { name = "GITHUB_APP_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_PRIVATE_KEY::" },
        { name = "GITHUB_APP_INSTALLATION_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_INSTALLATION_ID::" },
        { name = "FLUX_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:FLUX_API_KEY::" },
        { name = "SES_FROM_ADDRESS", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:SES_FROM_ADDRESS::" },
        { name = "YCLAW_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:YCLAW_API_KEY::" },
        { name = "TELEGRAM_WEBHOOK_SECRET", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELEGRAM_WEBHOOK_SECRET::" },
        { name = "TELEGRAM_PAIRING_CODE", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELEGRAM_PAIRING_CODE::" },
        { name = "GITHUB_WEBHOOK_SECRET", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_WEBHOOK_SECRET::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:OPENAI_API_KEY::" },
        { name = "VERCEL_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:VERCEL_TOKEN::" },
        { name = "VERCEL_ORG_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:VERCEL_ORG_ID::" },
        { name = "HELIUS_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:HELIUS_API_KEY::" },
        { name = "ALCHEMY_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:ALCHEMY_API_KEY::" },
        { name = "FIGMA_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:FIGMA_ACCESS_TOKEN::" },
        { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GEMINI_API_KEY::" },
        { name = "TELLER_ACCESS_TOKENS", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELLER_ACCESS_TOKENS::" },
        { name = "TELLER_CERTIFICATE", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELLER_CERTIFICATE::" },
        { name = "TELLER_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:TELLER_PRIVATE_KEY::" },
        { name = "MEMORY_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:MEMORY_DATABASE_URL::" },
        { name = "OPENCLAW_GATEWAY_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:OPENCLAW_GATEWAY_TOKEN::" },
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = "3000" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SOLANA_RPC_URL", value = "https://api.mainnet-beta.solana.com" },
        { name = "TELEGRAM_POLLING", value = "true" },
        { name = "TELEGRAM_CHAT_ID", value = var.telegram_chat_id },
        { name = "TELEGRAM_PAIRING_REQUIRED", value = "true" },
        { name = "TELEGRAM_ADMIN_IDS", value = "" },
        { name = "TELEGRAM_ALLOWED_SENDER_IDS", value = "" },
        { name = "AGENT_ASSIGNEES", value = var.github_username },
        { name = "APPROVED_DEPLOYERS", value = var.github_username },
        { name = "OPENCLAW_URL", value = var.openclaw_url },
        { name = "AO_SERVICE_URL", value = "http://ao.yclaw.internal:8420" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agents.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "agents"
        }
      }

      # Read-only root filesystem — only explicitly mounted volumes are writable.
      # Equivalent to OpenClaw's --read-only Docker sandbox pattern.
      # Application-layer scoping (assertWithinDir in self/tools.ts) is the second layer.
      readonlyRootFilesystem = true

      mountPoints = [
        { sourceVolume = "departments", containerPath = "/app/departments", readOnly = false },
        { sourceVolume = "prompts",     containerPath = "/app/prompts",     readOnly = false },
        { sourceVolume = "memory",      containerPath = "/app/memory",      readOnly = false },
        { sourceVolume = "logs",        containerPath = "/app/logs",        readOnly = false },
        { sourceVolume = "tmp",         containerPath = "/app/tmp",         readOnly = false },
        { sourceVolume = "custom-tools", containerPath = "/app/packages/core/src/actions/custom", readOnly = false },
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
}

# ─── ALB ──────────────────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "yclaw-alb-${var.environment}"
  description = "Security group for YClaw ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "Allow HTTP from authorized networks"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "Allow HTTPS from authorized networks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }
}

# Standalone rule to avoid cycle: ALB SG ↔ agents SG both reference each other inline.
resource "aws_security_group_rule" "alb_from_agents" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb.id
  source_security_group_id = aws_security_group.agents.id
  description              = "Allow HTTPS from ECS tasks (AO callbacks to CORE via ALB)"
}

resource "aws_lb" "gaze" {
  name               = "yclaw-lb-${var.environment}"
  internal           = true  # Phase 2: VPC-only access via Tailscale subnet router
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.private_subnet_ids # Internal ALB in private subnets, accessed via Tailscale

  enable_deletion_protection = true
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "agents" {
  name        = "yclaw-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the ALB. WAF provides rate limiting and managed rules as defense-in-depth."
  type        = list(string)
  # No default — forces operator to explicitly choose their access policy
}

variable "waf_rate_limit" {
  description = "Maximum requests per 5-minute window per IP before WAF blocks"
  type        = number
  default     = 1000
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.gaze.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agents.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.gaze.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ─── Security Group (ECS Tasks) ─────────────────────────────────────────────

resource "aws_security_group" "agents" {
  name        = "yclaw-${var.environment}"
  description = "Security group for YClaw Agent System tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "Allow traffic from YClaw ALB only"
  }

  ingress {
    from_port   = 8420
    to_port     = 8420
    protocol    = "tcp"
    self        = true
    description = "AO bridge from CORE (same SG)"
  }

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    self        = true
    description = "AO callback to CORE API (same SG)"
  }

  # Egress restricted to required ports only (defense against exfil via non-standard ports)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS (all APIs: Anthropic, Telegram, Slack, Twitter, OpenRouter, etc.)"
  }

  egress {
    from_port   = 27017
    to_port     = 27017
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "MongoDB Atlas"
  }

  egress {
    from_port   = 6379
    to_port     = 6380
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Redis (6379 plain, 6380 TLS)"
  }

  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "DNS (VPC resolver)"
  }

  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "DNS over TCP (VPC resolver)"
  }

  egress {
    from_port   = 8420
    to_port     = 8420
    protocol    = "tcp"
    self        = true
    description = "CORE to AO bridge (same SG)"
  }

  egress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    self        = true
    description = "AO to CORE callback (same SG)"
  }
}

# ─── WAF ──────────────────────────────────────────────────────────────────────
#
# Rate limiting + AWS managed rule groups. Sits in front of the ALB.
# Even with SG CIDR restrictions, WAF adds defense-in-depth:
#   - Rate limiting per IP (prevents credential brute-force and DoS)
#   - AWS managed rules block known bad inputs (SQLi, XSS, bad bots)

resource "aws_wafv2_web_acl" "agents" {
  name        = "yclaw-waf-${var.environment}"
  description = "WAF for YClaw Agent ALB"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # Rule 1: Rate limit per IP
  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "yclaw-waf-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2: AWS Managed — Common Rule Set (XSS, SQLi, path traversal, etc.)
  rule {
    name     = "aws-managed-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "yclaw-waf-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Rule 3: AWS Managed — Known Bad Inputs
  rule {
    name     = "aws-managed-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "yclaw-waf-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Rule 4: AWS Managed — Bot Control (count-only: logs bot traffic without blocking legitimate API clients)
  rule {
    name     = "aws-managed-bot-control"
    priority = 4

    override_action {
      count {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesBotControlRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "yclaw-waf-bot-control"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "yclaw-waf-acl"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "agents_alb" {
  resource_arn = aws_lb.gaze.arn
  web_acl_arn  = aws_wafv2_web_acl.agents.arn
}

# ─── ECS Service ──────────────────────────────────────────────────────────────

resource "aws_ecs_service" "agents" {
  name            = "yclaw-${var.environment}"
  cluster         = aws_ecs_cluster.yclaw.id
  task_definition = aws_ecs_task_definition.agents.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.agents.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agents.arn
    container_name   = "yclaw"
    container_port   = 3000
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ─── Service Discovery (Cloud Map) ───────────────────────────────────────────
# Creates ao.yclaw.internal DNS that auto-resolves to the AO task's private IP.
# When AO restarts, AWS updates the A-record automatically within seconds.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "yclaw.internal"
  description = "YCLAW internal service discovery"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "ao" {
  name = "ao"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id

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

# ─── AO Task Definition ──────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "ao" {
  family                   = "yclaw-ao-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  # Ephemeral volume for repo clones, worktrees, AO state.
  # Re-cloned from GitHub on every restart via entrypoint.sh.
  volume { name = "ao-data" }

  ephemeral_storage {
    size_in_gib = 50
  }

  container_definitions = jsonencode([
    {
      name      = "yclaw-ao"
      image     = "${aws_ecr_repository.ao.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 8420
          hostPort      = 8420
          protocol      = "tcp"
          name          = "ao-bridge"
        }
      ]

      environment = [
        { name = "YCLAW_AO_PROJECT", value = "yclaw" },
        { name = "NODE_ENV", value = var.environment },
        { name = "YCLAW_REPOS", value = "YClawAI/YClaw" },
        { name = "YCLAW_AO_OVERLAY_REPO", value = "YClawAI/YClaw" },
        { name = "AO_CALLBACK_URL", value = "https://${aws_lb.gaze.dns_name}/api/ao/callback" },
      ]

      secrets = [
        { name = "GITHUB_TOKEN", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_TOKEN::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:ANTHROPIC_API_KEY::" },
        { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:REDIS_URL::" },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:OPENAI_API_KEY::" },
        { name = "GITHUB_APP_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_ID::" },
        { name = "GITHUB_APP_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_PRIVATE_KEY::" },
        { name = "GITHUB_APP_INSTALLATION_ID", valueFrom = "${aws_secretsmanager_secret.agent_secrets.arn}:GITHUB_APP_INSTALLATION_ID::" },
      ]

      mountPoints = [
        { sourceVolume = "ao-data", containerPath = "/data", readOnly = false },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ao.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ao"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:8420/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 120
      }
    }
  ])
}

# ─── AO ECS Service (with Cloud Map) ─────────────────────────────────────────

resource "aws_ecs_service" "ao" {
  name            = "yclaw-ao-${var.environment}"
  cluster         = aws_ecs_cluster.yclaw.id
  task_definition = aws_ecs_task_definition.ao.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.agents.id]
    assign_public_ip = false
  }

  # Cloud Map service discovery — registers ao.yclaw.internal automatically
  service_registries {
    registry_arn = aws_service_discovery_service.ao.arn
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "ecr_repository_url" {
  value = aws_ecr_repository.agents.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.yclaw.name
}

output "ecs_service_name" {
  value = aws_ecs_service.agents.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.agents.name
}

output "target_group_arn" {
  value = aws_lb_target_group.agents.arn
}

output "alb_dns_name" {
  value = aws_lb.gaze.dns_name
}

output "service_url" {
  value = "https://${aws_lb.gaze.dns_name}"
}

output "ao_ecr_repository_url" {
  value = aws_ecr_repository.ao.repository_url
}

output "ao_service_name" {
  value = aws_ecs_service.ao.name
}

output "ao_internal_dns" {
  value       = "ao.${aws_service_discovery_private_dns_namespace.internal.name}"
  description = "Internal DNS name for AO service (resolves within VPC only)"
}
