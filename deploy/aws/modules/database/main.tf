# Database module — RDS PostgreSQL (always) + optional DocumentDB
#
# database_type = "external": no DocumentDB, user provides MONGODB_URI
# database_type = "documentdb": AWS-managed MongoDB-compatible cluster
#
# RDS PostgreSQL is always provisioned for the memory system.

locals {
  use_documentdb     = var.database_type == "documentdb"
  rds_instance       = var.rds_instance_class != "" ? var.rds_instance_class : (var.cost_tier == "production" ? "db.t4g.small" : "db.t4g.micro")
  rds_multi_az       = var.cost_tier == "production"
  docdb_instance     = var.documentdb_instance_class != "" ? var.documentdb_instance_class : (var.cost_tier == "production" ? "db.t4g.medium" : "db.t4g.medium")
  docdb_count        = var.cost_tier == "production" ? 2 : 1
}

# ─── Subnet Groups ───────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.project_name}-db-subnet-group" }
}

resource "aws_docdb_subnet_group" "main" {
  count      = local.use_documentdb ? 1 : 0
  name       = "${var.project_name}-docdb"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.project_name}-docdb-subnet-group" }
}

# ─── Passwords ────────────────────────────────────────────────────────────────

resource "random_password" "rds" {
  length  = 32
  special = false
}

resource "random_password" "docdb" {
  count   = local.use_documentdb ? 1 : 0
  length  = 32
  special = false
}

# ─── RDS PostgreSQL (memory system) ──────────────────────────────────────────

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-memory"
  engine         = "postgres"
  engine_version = "16"
  instance_class = local.rds_instance

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  db_name  = "yclaw_memory"
  username = "yclaw"
  password = random_password.rds.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]

  multi_az            = local.rds_multi_az
  publicly_accessible = false
  skip_final_snapshot = var.cost_tier != "production"
  final_snapshot_identifier = var.cost_tier == "production" ? "${var.project_name}-memory-final" : null
  deletion_protection       = var.cost_tier == "production"

  backup_retention_period = var.cost_tier == "production" ? 7 : 1

  tags = { Name = "${var.project_name}-postgres" }
}

# ─── DocumentDB (optional MongoDB-compatible) ────────────────────────────────

resource "aws_docdb_cluster" "main" {
  count              = local.use_documentdb ? 1 : 0
  cluster_identifier = "${var.project_name}-docdb"
  engine             = "docdb"

  master_username = "yclaw"
  master_password = random_password.docdb[0].result

  db_subnet_group_name   = aws_docdb_subnet_group.main[0].name
  vpc_security_group_ids = [var.security_group_id]

  storage_encrypted   = true
  skip_final_snapshot = var.cost_tier != "production"
  final_snapshot_identifier = var.cost_tier == "production" ? "${var.project_name}-docdb-final" : null
  deletion_protection       = var.cost_tier == "production"

  backup_retention_period = var.cost_tier == "production" ? 7 : 1

  tags = { Name = "${var.project_name}-docdb" }
}

resource "aws_docdb_cluster_instance" "main" {
  count              = local.use_documentdb ? local.docdb_count : 0
  identifier         = "${var.project_name}-docdb-${count.index}"
  cluster_identifier = aws_docdb_cluster.main[0].id
  instance_class     = local.docdb_instance

  tags = { Name = "${var.project_name}-docdb-${count.index}" }
}
