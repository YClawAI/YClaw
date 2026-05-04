# ─── Showcase ──────────────────────────────────────────────────────────────────
#
# Public-facing Next.js showcase site. Runs on port 3002.
# Connected to the internal ALB (yclaw-internal-production).
#
# IMPORT: These resources were initially created via AWS CLI (2026-04-10).
# Before first `terraform apply`, import them:
#
#   terraform import aws_cloudwatch_log_group.showcase /ecs/yclaw-showcase
#   terraform import aws_lb_target_group.showcase arn:aws:elasticloadbalancing:<AWS_REGION>:<AWS_ACCOUNT_ID>:targetgroup/yclaw-showcase-tg/<TARGET_GROUP_ID>
#   terraform import aws_ecs_task_definition.showcase arn:aws:ecs:<AWS_REGION>:<AWS_ACCOUNT_ID>:task-definition/yclaw-showcase-production:1
#   terraform import aws_ecs_service.showcase arn:aws:ecs:<AWS_REGION>:<AWS_ACCOUNT_ID>:service/yclaw-cluster-production/yclaw-showcase-production

# ─── Internal ALB reference ───────────────────────────────────────────────────
# The internal ALB and its security group were created outside this Terraform
# workspace. Reference them as variables to avoid a hard dependency.

variable "internal_alb_sg_id" {
  description = "Security group ID for the internal ALB (yclaw-internal-production)"
  type        = string
  default     = ""
}

variable "internal_https_listener_arn" {
  description = "HTTPS listener ARN on the internal ALB"
  type        = string
  default     = ""
}

# ─── Route53 reference ────────────────────────────────────────────────────────
# Route53 hosted zone for yclaw.ai. Used to create the live.yclaw.ai subdomain.
# Find with: aws route53 list-hosted-zones-by-name --dns-name yclaw.ai

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for yclaw.ai"
  type        = string
}

# ─── CloudWatch ───────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "showcase" {
  name              = "/ecs/yclaw-showcase"
  retention_in_days = 30

  tags = { Project = "yclaw" }
}

# ─── Target Group ─────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "showcase" {
  name        = "yclaw-showcase-tg"
  port        = 3002
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Project = "yclaw" }
}

# ─── ALB Listener Rule ────────────────────────────────────────────────────────

resource "aws_lb_listener_rule" "showcase" {
  listener_arn = var.internal_https_listener_arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.showcase.arn
  }

  condition {
    path_pattern {
      values = ["/_showcase_health"]
    }
  }
}

# ─── Security Group Rules ────────────────────────────────────────────────────

# Task SG — allow port 3002 from external ALB
resource "aws_vpc_security_group_ingress_rule" "showcase_from_external_alb" {
  security_group_id            = aws_security_group.agents.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3002
  to_port                      = 3002
  ip_protocol                  = "tcp"
  description                  = "Showcase from external ALB"
}

# Task SG — allow port 3002 from internal ALB
resource "aws_vpc_security_group_ingress_rule" "showcase_from_internal_alb" {
  security_group_id            = aws_security_group.agents.id
  referenced_security_group_id = var.internal_alb_sg_id
  from_port                    = 3002
  to_port                      = 3002
  ip_protocol                  = "tcp"
  description                  = "Showcase from internal ALB"
}

# Internal ALB SG — allow egress to task SG on port 3002
resource "aws_vpc_security_group_egress_rule" "internal_alb_to_showcase" {
  security_group_id            = var.internal_alb_sg_id
  referenced_security_group_id = aws_security_group.agents.id
  from_port                    = 3002
  to_port                      = 3002
  ip_protocol                  = "tcp"
  description                  = "Internal ALB to Showcase"
}

# ─── Task Definition ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "showcase" {
  family                   = "yclaw-showcase-production"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([
    {
      name      = "showcase"
      image     = "${aws_ecr_repository.showcase.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 3002
          hostPort      = 3002
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3002" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.showcase.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "showcase"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:3002').then(r=>{if(r.ok||r.status<400)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = { Project = "yclaw" }
}

# ─── ECS Service ──────────────────────────────────────────────────────────────

resource "aws_ecs_service" "showcase" {
  name            = "yclaw-showcase-production"
  cluster         = aws_ecs_cluster.yclaw.id
  task_definition = aws_ecs_task_definition.showcase.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.agents.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.showcase.arn
    container_name   = "showcase"
    container_port   = 3002
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

  tags = { Project = "yclaw" }
}

# ─── Public ALB listener rule (live.yclaw.ai) ────────────────────────────────
#
# Routes requests with Host: live.yclaw.ai on the public ALB HTTPS listener
# to the showcase target group. Priority 20 leaves room above the internal
# health-check rule (priority 10 on the internal ALB).

resource "aws_lb_listener_rule" "showcase_live" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.showcase.arn
  }

  condition {
    host_header {
      values = ["live.yclaw.ai"]
    }
  }
}

# ─── Route53 — live.yclaw.ai ──────────────────────────────────────────────────
#
# ALIAS record pointing live.yclaw.ai at the same public ALB used by
# agents.yclaw.ai.  AWS ALIAS records are free and support health-check
# propagation; CNAME is not allowed at the zone apex but is fine here.
# The ACM wildcard cert (*.yclaw.ai) already covers this subdomain.

resource "aws_route53_record" "live" {
  zone_id = var.route53_zone_id
  name    = "live.yclaw.ai"
  type    = "A"

  alias {
    name                   = aws_lb.yclaw.dns_name
    zone_id                = aws_lb.yclaw.zone_id
    evaluate_target_health = true
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "showcase_ecr_url" {
  value = aws_ecr_repository.showcase.repository_url
}

output "showcase_service_name" {
  value = aws_ecs_service.showcase.name
}

output "live_subdomain_dns" {
  value       = aws_route53_record.live.fqdn
  description = "Public DNS name for the live showcase (live.yclaw.ai)"
}
