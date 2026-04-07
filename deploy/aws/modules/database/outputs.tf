output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "rds_connection_string" {
  value     = "postgresql://yclaw:${random_password.rds.result}@${aws_db_instance.postgres.endpoint}/yclaw_memory"
  sensitive = true
}

output "rds_password" {
  value     = random_password.rds.result
  sensitive = true
}

output "documentdb_endpoint" {
  value = local.use_documentdb ? aws_docdb_cluster.main[0].endpoint : ""
}

output "documentdb_connection_string" {
  value     = local.use_documentdb ? "mongodb://yclaw:${random_password.docdb[0].result}@${aws_docdb_cluster.main[0].endpoint}:27017/yclaw_agents?tls=true&retryWrites=false" : ""
  sensitive = true
}

output "documentdb_password" {
  value     = local.use_documentdb ? random_password.docdb[0].result : ""
  sensitive = true
}
