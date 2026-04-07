output "secret_arns" {
  value       = { for k, v in aws_secretsmanager_secret.entries : k => v.arn }
  description = "Map of secret name → ARN for ECS task definition secrets references"
}

output "all_secret_arns" {
  value       = [for s in aws_secretsmanager_secret.entries : s.arn]
  description = "List of all secret ARNs for IAM policy"
}
