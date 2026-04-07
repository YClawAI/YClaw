# ─── MongoDB Atlas VPC Peering (AWS side) ────────────────────────────────────
#
# PREREQUISITE: Atlas cluster must be M10+ (dedicated tier). Shared-tier clusters
# (M0/M2/M5) do NOT support VPC Peering or Private Endpoints.
#
# Current state: MongoDB is secured via NAT Gateway IP whitelist (set your NAT EIP/32)
# in the Atlas IP Access List. This is the shared-tier alternative.
#
# When ready to upgrade to M10+, use the automated setup script:
#   ./scripts/setup-atlas-peering.sh
#
# Or manual steps:
#   1. Upgrade cluster to M10+ in Atlas Console
#   2. In Atlas: Network Access → Peering → Add Peering Connection
#      - Cloud Provider: AWS
#      - AWS Account ID: <AWS_ACCOUNT_ID>
#      - VPC ID: <VPC_ID>
#      - VPC CIDR: 10.0.0.0/16
#      - Region: us-east-1
#   3. Atlas will show: Atlas VPC CIDR (e.g., 192.168.248.0/21)
#      and the peering connection will appear in AWS as "pending-acceptance"
#   4. Set the variables below and run: terraform apply -var-file=production.tfvars
#   5. In Atlas: Add 10.0.0.0/16 to IP Access List, remove NAT Gateway IP
#   6. Verify: ECS task can still connect to MongoDB
#
# See .ai/PRODUCTION-SECURITY-RUNBOOK.md for the full production upgrade checklist.

variable "atlas_vpc_cidr" {
  description = "MongoDB Atlas VPC CIDR block (shown in Atlas peering UI, e.g. 192.168.248.0/21)"
  type        = string
  default     = ""
}

variable "atlas_peering_connection_id" {
  description = "VPC Peering Connection ID (pcx-...) from AWS console after Atlas initiates peering"
  type        = string
  default     = ""
}

# ─── Accept the Peering Connection ───────────────────────────────────────────

resource "aws_vpc_peering_connection_accepter" "atlas" {
  count = var.atlas_peering_connection_id != "" ? 1 : 0

  vpc_peering_connection_id = var.atlas_peering_connection_id
  auto_accept               = true

  tags = {
    Name = "yclaw-mongodb-atlas-${var.environment}"
    Side = "Accepter"
  }
}

# ─── Route Atlas CIDR through the peering connection ─────────────────────────
#
# Only the private subnet route table needs this (ECS tasks run in private subnets).

resource "aws_route" "atlas_private" {
  count = var.atlas_peering_connection_id != "" ? 1 : 0

  route_table_id            = "rtb-05461291bad941357" # Private subnet route table
  destination_cidr_block    = var.atlas_vpc_cidr
  vpc_peering_connection_id = var.atlas_peering_connection_id
}

# ─── Allow MongoDB traffic from Atlas VPC ────────────────────────────────────

resource "aws_security_group_rule" "ecs_to_atlas" {
  count = var.atlas_vpc_cidr != "" ? 1 : 0

  type              = "egress"
  from_port         = 27017
  to_port           = 27017
  protocol          = "tcp"
  cidr_blocks       = [var.atlas_vpc_cidr]
  security_group_id = aws_security_group.agents.id
  description       = "MongoDB Atlas via VPC peering"
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "atlas_peering_status" {
  value = length(aws_vpc_peering_connection_accepter.atlas) > 0 ? aws_vpc_peering_connection_accepter.atlas[0].accept_status : "not configured (set atlas_peering_connection_id)"
}
