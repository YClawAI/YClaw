# ─── GitHub Actions OIDC ──────────────────────────────────────────────────────
#
# STATUS: Deployed and active. GitHub Actions CI/CD uses OIDC federation.
# Role ARN: arn:aws:iam::<AWS_ACCOUNT_ID>:role/yclaw-github-actions-deploy
# GitHub secret AWS_ROLE_ARN is set.
#
# Allows GitHub Actions to assume an IAM role via OIDC federation — no static
# AWS credentials (access keys) needed. The trust policy is scoped to:
#   - Only the YClawAI/YClaw repo (case-sensitive)
#   - All branches (wildcard)
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
  name = "yclaw-github-actions-deploy"

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
            "token.actions.githubusercontent.com:sub" = "repo:YClawAI/YClaw:*"
          }
        }
      }
    ]
  })
}

# ─── Deploy Policy ────────────────────────────────────────────────────────────
#
# Single consolidated policy matching the live AWS state. Covers:
#   - ECR push to all yclaw-* repos (wildcard)
#   - ECS service updates (tag-conditioned)
#   - Task definition registration
#   - IAM PassRole for task execution/task roles
#   - ELBv2 health check management (for MC deploy step)

resource "aws_iam_role_policy" "github_deploy" {
  name = "yclaw-deploy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = "ecr:GetAuthorizationToken"
        Resource = "*"
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
          "ecr:DescribeRepositories",
          "ecr:DescribeImages"
        ]
        Resource = [
          "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/yclaw-*"
        ]
      },
      {
        Sid    = "ECSTagged"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:UpdateService"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "yclaw"
          }
        }
      },
      {
        Sid    = "ECSUnconditioned"
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DescribeTaskDefinition"
        ]
        Resource = "*"
      },
      {
        Sid    = "PassRole"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/yclaw-*"
        ]
      },
      {
        Sid    = "ELBHealthCheck"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetGroupAttributes",
          "elasticloadbalancing:ModifyTargetGroup",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:DescribeTargetHealth"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─── Output ──────────────────────────────────────────────────────────────────

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions_deploy.arn
  description = "Set this as GitHub secret AWS_ROLE_ARN"
}
