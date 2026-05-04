# Secrets module — AWS Secrets Manager for application credentials
#
# Each secret is stored individually so ECS task definitions can reference
# them by ARN in the `secrets` block (not plaintext `environment`).

locals {
  secret_names = toset(nonsensitive(keys(var.secret_values)))
}

resource "aws_secretsmanager_secret" "entries" {
  for_each = local.secret_names

  name                    = "${var.project_name}/${each.value}"
  description             = "YCLAW secret: ${each.value}"
  recovery_window_in_days = 0 # Immediate deletion for force_destroy support

  tags = { Name = "${var.project_name}-${each.value}" }
}

resource "aws_secretsmanager_secret_version" "entries" {
  for_each = local.secret_names

  secret_id     = aws_secretsmanager_secret.entries[each.value].id
  secret_string = var.secret_values[each.value]
}
