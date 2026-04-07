# Secrets module — AWS Secrets Manager for application credentials
#
# Each secret is stored individually so ECS task definitions can reference
# them by ARN in the `secrets` block (not plaintext `environment`).

resource "aws_secretsmanager_secret" "entries" {
  for_each = var.secret_values

  name                    = "${var.project_name}/${each.key}"
  description             = "YCLAW secret: ${each.key}"
  recovery_window_in_days = 0 # Immediate deletion for force_destroy support

  tags = { Name = "${var.project_name}-${each.key}" }
}

resource "aws_secretsmanager_secret_version" "entries" {
  for_each = var.secret_values

  secret_id     = aws_secretsmanager_secret.entries[each.key].id
  secret_string = each.value
}
