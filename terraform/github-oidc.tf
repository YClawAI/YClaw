# ─── GitHub Actions OIDC ──────────────────────────────────────────────────────
#
# STATUS: Deployed and active. GitHub Actions CI/CD uses OIDC federation.
# Role ARN: arn:aws:iam::<AWS_ACCOUNT_ID>:role/yclaw-github-deploy-production
# GitHub secret AWS_ROLE_ARN is set.
#
# Allows GitHub Actions to assume an IAM role via OIDC federation — no static
# AWS credentials (access keys) needed. The trust policy is scoped to:
#   - Only the <GITHUB_ORG>/yclaw repo
#   - Only the master branch
#
# Key gotchas (documented in skill: github-actions-oidc-ecs):
#   - Thumbprint is a dummy value — AWS validates GitHub's cert chain directly
#   - Use StringLike (not StringEquals) for the sub claim
#   - iam:PassRole is required on both execution and task roles
#   - ecs:RegisterTaskDefinition cannot be resource-scoped (must use "*")

# ─── OIDC Identity Provider ──────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint (standard, used by all AWS accounts)
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]
}

# ─── IAM Role for GitHub Actions ─────────────────────────────────────────────

resource "aws_iam_role" "github_actions_deploy" {
  name = "yclaw-github-deploy-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github_actions.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:<GITHUB_ORG>/yclaw:ref:refs/heads/master"
          }
        }
      }
    ]
  })
}

# ─── ECR Permissions (push images) ──────────────────────────────────────────
#
# The deploy workflow pushes to multiple ECR repos (yclaw-agents,
# yclaw-mission-control, yclaw-ao, yclaw-showcase). Use a wildcard ARN
# so new services don't require a Terraform change to deploy.

data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "github_ecr" {
  name = "ecr-push"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImageScanFindings",
          "ecr:DescribeImages"
        ]
        Resource = [
          "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/yclaw-*"
        ]
      }
    ]
  })
}

# ─── ECS Permissions (deploy service) ───────────────────────────────────────
#
# The deploy workflow updates multiple ECS services (core, MC, AO, showcase).
# Scope UpdateService to any service in the cluster rather than a single service.

resource "aws_iam_role_policy" "github_ecs" {
  name = "ecs-deploy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECSTaskDef"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition"
        ]
        Resource = ["*"]
      },
      {
        Sid    = "ECSService"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = ["arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${aws_ecs_cluster.yclaw.name}/*"]
      },
      {
        Sid    = "PassRole"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.task_execution.arn,
          aws_iam_role.task_role.arn
        ]
      },
      {
        Sid    = "WaitStable"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:ListTasks",
          "ecs:DescribeTasks"
        ]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "ecs:cluster" = aws_ecs_cluster.yclaw.arn
          }
        }
      },
      {
        Sid    = "HealthCheckFix"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:ModifyTargetGroup",
          "elasticloadbalancing:DescribeTargetHealth"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# ─── Output ──────────────────────────────────────────────────────────────────

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions_deploy.arn
  description = "Set this as GitHub secret AWS_ROLE_ARN"
}
