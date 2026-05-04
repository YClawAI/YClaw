# ─── AgentHub ────────────────────────────────────────────────────────────────
#
# Lightweight agent collaboration platform (Go, SQLite).
# Provides Git DAG layer + message board for agent coordination.
# Source: infra/agenthub/ (forked from ygivenx/agenthub)
#
# Already deployed via AWS CLI on 2026-03-13. This config documents
# the infrastructure and enables Terraform management going forward.
# Import ALL existing resources before first apply:
#
#   # ECR
#   terraform import aws_ecr_repository.agenthub yclaw-agenthub
#
#   # EFS
#   terraform import aws_efs_file_system.agenthub_data fs-02f279b565bd89027
#   terraform import 'aws_efs_mount_target.agenthub["subnet-XXXX"]' fsmt-XXXX  # repeat per subnet
#   terraform import aws_efs_access_point.agenthub fsap-099d64d4bcde89fa2
#
#   # Security Groups
#   terraform import aws_security_group.agenthub <AGENTHUB_SECURITY_GROUP_ID>
#   terraform import aws_security_group.efs_agenthub <AGENTHUB_EFS_SECURITY_GROUP_ID>
#
#   # IAM (new dedicated roles — skip if not yet created)
#   terraform import aws_iam_role.agenthub_task_execution yclaw-agenthub-task-execution
#   terraform import aws_iam_role.agenthub_task yclaw-agenthub-task
#
#   # Secrets Manager
#   terraform import aws_secretsmanager_secret.agenthub_admin_key yclaw/agenthub-admin-key
#   terraform import aws_secretsmanager_secret.agenthub_agent_keys yclaw/agenthub-agent-keys
#
#   # CloudWatch
#   terraform import aws_cloudwatch_log_group.agenthub /ecs/yclaw-agenthub
#
#   # ALB
#   terraform import aws_lb_target_group.agenthub arn:aws:elasticloadbalancing:us-east-1:<AWS_ACCOUNT_ID>:targetgroup/yclaw-agenthub/<TG_ID>
#   terraform import aws_lb_listener_rule.agenthub arn:aws:elasticloadbalancing:us-east-1:<AWS_ACCOUNT_ID>:listener-rule/XXXX
#
#   # ECS
#   terraform import aws_ecs_task_definition.agenthub yclaw-agenthub
#   terraform import aws_ecs_service.agenthub yclaw-cluster-production/yclaw-agenthub

# ─── Data Sources ────────────────────────────────────────────────────────────

data "aws_lb" "internal" {
  name = "yclaw-internal-${var.environment}"
}

data "aws_lb_listener" "internal_https" {
  load_balancer_arn = data.aws_lb.internal.arn
  port              = 443
}

data "aws_caller_identity" "current" {}

# ─── ECR ─────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "agenthub" {
  name                 = "yclaw-agenthub"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ─── EFS ─────────────────────────────────────────────────────────────────────

resource "aws_efs_file_system" "agenthub_data" {
  creation_token = "yclaw-agenthub-data"
  encrypted      = true

  tags = {
    Name = "yclaw-agenthub-data"
  }
}

resource "aws_efs_mount_target" "agenthub" {
  for_each        = toset(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.agenthub_data.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs_agenthub.id]
}

resource "aws_efs_access_point" "agenthub" {
  file_system_id = aws_efs_file_system.agenthub_data.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/agenthub"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }
}

# ─── Security Groups ────────────────────────────────────────────────────────

resource "aws_security_group" "agenthub" {
  name        = "yclaw-agenthub"
  description = "AgentHub ECS task"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [tolist(data.aws_lb.internal.security_groups)[0]]
    description     = "HTTP from internal ALB"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound"
  }

  tags = { Name = "yclaw-agenthub" }
}

resource "aws_security_group" "efs_agenthub" {
  name        = "yclaw-agenthub-efs"
  description = "EFS for AgentHub data"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.agenthub.id]
    description     = "NFS from AgentHub tasks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "yclaw-agenthub-efs" }
}

# ─── IAM Roles (dedicated to AgentHub) ─────────────────────────────────────

resource "aws_iam_role" "agenthub_task_execution" {
  name = "yclaw-agenthub-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "agenthub_task_execution_policy" {
  role       = aws_iam_role.agenthub_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "agenthub_secrets_access" {
  name = "agenthub-secrets-access"
  role = aws_iam_role.agenthub_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:yclaw/agenthub-*"
    }]
  })
}

resource "aws_iam_role" "agenthub_task" {
  name = "yclaw-agenthub-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "agenthub_efs_access" {
  name = "agenthub-efs-access"
  role = aws_iam_role.agenthub_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite", "elasticfilesystem:DescribeMountTargets"]
      Resource = "*"
      Condition = {
        StringEquals = {
          "elasticfilesystem:AccessPointArn" = aws_efs_access_point.agenthub.arn
        }
      }
    }]
  })
}

# ─── Secrets ─────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "agenthub_admin_key" {
  name        = "yclaw/agenthub-admin-key"
  description = "AgentHub admin API key"
}

resource "aws_secretsmanager_secret" "agenthub_agent_keys" {
  name        = "yclaw/agenthub-agent-keys"
  description = "AgentHub per-agent API keys (JSON object)"
}

# ─── CloudWatch ──────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "agenthub" {
  name              = "/ecs/yclaw-agenthub"
  retention_in_days = 30
}

# ─── ALB Target Group + Listener Rule ───────────────────────────────────────

resource "aws_lb_target_group" "agenthub" {
  name        = "yclaw-agenthub"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    port                = "traffic-port"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = { Name = "yclaw-agenthub" }
}

resource "aws_lb_listener_rule" "agenthub" {
  listener_arn = data.aws_lb_listener.internal_https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agenthub.arn
  }

  condition {
    host_header {
      values = ["agenthub-internal.<YOUR_DOMAIN>", "agenthub.<YOUR_DOMAIN>"]
    }
  }
}

# ─── ECS Task Definition ────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "agenthub" {
  family                   = "yclaw-agenthub"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.agenthub_task_execution.arn
  task_role_arn            = aws_iam_role.agenthub_task.arn

  volume {
    name = "agenthub-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.agenthub_data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.agenthub.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "agenthub"
    image     = "${aws_ecr_repository.agenthub.repository_url}:latest"
    essential = true

    portMappings = [{ containerPort = 8080, protocol = "tcp" }]

    mountPoints = [{
      sourceVolume  = "agenthub-data"
      containerPath = "/data"
      readOnly      = false
    }]

    command     = ["--data", "/data", "--listen", ":8080"]
    environment = []

    secrets = [{
      name      = "AGENTHUB_ADMIN_KEY"
      valueFrom = aws_secretsmanager_secret.agenthub_admin_key.arn
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.agenthub.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "agenthub"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:8080/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }
  }])
}

# ─── ECS Service ─────────────────────────────────────────────────────────────

resource "aws_ecs_service" "agenthub" {
  name            = "yclaw-agenthub"
  cluster         = aws_ecs_cluster.yclaw.id
  task_definition = aws_ecs_task_definition.agenthub.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.agenthub.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agenthub.arn
    container_name   = "agenthub"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener_rule.agenthub]
}
