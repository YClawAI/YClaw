#!/bin/bash
# ─── MongoDB Atlas VPC Peering Setup ──────────────────────────────────────────
#
# PREREQUISITE: Atlas cluster must be M10+ (dedicated tier). Shared-tier clusters
# (M0/M2/M5) do NOT support VPC Peering. If on shared tier, use NAT Gateway IP
# whitelisting instead (see .ai/PRODUCTION-SECURITY-RUNBOOK.md).
#
# This script automates VPC peering between MongoDB Atlas and the yclaw VPC.
# It uses the Atlas Admin API to create the peering connection, then applies
# Terraform to accept the peering and add routes on the AWS side.
#
# Prerequisites:
#   - Atlas cluster on M10+ dedicated tier
#   - Atlas API key with Project Owner role
#   - Generate at: Atlas Console → Organization → Access Manager → API Keys
#
# Usage:
#   export ATLAS_PUBLIC_KEY="oiuixyuo"
#   export ATLAS_PRIVATE_KEY="772ab0f3-0e49-4d7b-990b-b24300900307"
#   export ATLAS_PROJECT_ID="698ef5785832f6a035da8b5a"
#   ./scripts/setup-atlas-peering.sh
#
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID}"
AWS_VPC_ID="${AWS_VPC_ID:?Set AWS_VPC_ID}"
AWS_VPC_CIDR="${AWS_VPC_CIDR:?Set AWS_VPC_CIDR}"
AWS_REGION="us-east-1"
ATLAS_API_BASE="https://cloud.mongodb.com/api/atlas/v2"

# ─── Validate environment ───────────────────────────────────────────────────
for var in ATLAS_PUBLIC_KEY ATLAS_PRIVATE_KEY ATLAS_PROJECT_ID; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set."
    echo ""
    echo "To find your Atlas Project ID:"
    echo "  Atlas Console → Project Settings → Project ID"
    echo ""
    echo "To create an API key:"
    echo "  Atlas Console → Organization → Access Manager → API Keys → Create"
    echo "  Permissions needed: Project Owner"
    echo ""
    echo "Usage:"
    echo "  export ATLAS_PUBLIC_KEY=\"abcdef12\""
    echo "  export ATLAS_PRIVATE_KEY=\"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\""
    echo "  export ATLAS_PROJECT_ID=\"60a1b2c3d4e5f6g7h8i9j0k1\""
    echo "  $0"
    exit 1
  fi
done

echo "=== MongoDB Atlas VPC Peering Setup ==="
echo ""
echo "AWS Account:  $AWS_ACCOUNT_ID"
echo "AWS VPC:      $AWS_VPC_ID ($AWS_VPC_CIDR)"
echo "AWS Region:   $AWS_REGION"
echo "Atlas Project: $ATLAS_PROJECT_ID"
echo ""

# ─── Step 1: Check existing peering connections ─────────────────────────────
echo "Step 1: Checking for existing peering connections..."
EXISTING=$(curl -s --digest -u "${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}" \
  "${ATLAS_API_BASE}/groups/${ATLAS_PROJECT_ID}/peers" \
  -H "Accept: application/vnd.atlas.2023-02-01+json")

EXISTING_COUNT=$(echo "$EXISTING" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([p for p in d.get('results',[]) if p.get('vpcId')=='$AWS_VPC_ID' and p.get('statusName') not in ['FAILED','DELETED']]))" 2>/dev/null || echo "0")

if [ "$EXISTING_COUNT" != "0" ]; then
  echo "  Found existing peering connection(s) for this VPC:"
  echo "$EXISTING" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('results', []):
    if p.get('vpcId') == '$AWS_VPC_ID' and p.get('statusName') not in ['FAILED','DELETED']:
        print(f\"  - Connection ID: {p.get('connectionId', 'N/A')}\")
        print(f\"    Status: {p['statusName']}\")
        print(f\"    Atlas CIDR: {p.get('atlasCidrBlock', 'N/A')}\")
        print(f\"    AWS Peering ID: {p.get('connectionId', 'N/A')}\")
" 2>/dev/null
  echo ""
  echo "  Skipping creation. If you want to recreate, delete the existing one first."
  echo ""
else
  # ─── Step 2: Get the Atlas container (VPC) for this region ─────────────────
  echo "Step 2: Finding Atlas network container for $AWS_REGION..."
  CONTAINERS=$(curl -s --digest -u "${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}" \
    "${ATLAS_API_BASE}/groups/${ATLAS_PROJECT_ID}/containers?providerName=AWS" \
    -H "Accept: application/vnd.atlas.2023-02-01+json")

  CONTAINER_ID=$(echo "$CONTAINERS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('results', []):
    if c.get('regionName') == 'US_EAST_1':
        print(c['id'])
        break
" 2>/dev/null || echo "")

  if [ -z "$CONTAINER_ID" ]; then
    echo "  No container found for US_EAST_1. Atlas will create one with the peering request."
  else
    echo "  Found container: $CONTAINER_ID"
  fi

  # ─── Step 3: Create the peering connection ─────────────────────────────────
  echo "Step 3: Creating VPC peering connection..."
  PEERING_RESULT=$(curl -s --digest -u "${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}" \
    -X POST "${ATLAS_API_BASE}/groups/${ATLAS_PROJECT_ID}/peers" \
    -H "Content-Type: application/vnd.atlas.2023-02-01+json" \
    -H "Accept: application/vnd.atlas.2023-02-01+json" \
    -d "{
      \"providerName\": \"AWS\",
      \"accepterRegionName\": \"us-east-1\",
      \"awsAccountId\": \"${AWS_ACCOUNT_ID}\",
      \"routeTableCidrBlock\": \"${AWS_VPC_CIDR}\",
      \"vpcId\": \"${AWS_VPC_ID}\"
    }")

  echo "$PEERING_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d or 'errorCode' in d:
    print(f\"  ERROR: {d.get('detail', d.get('error', 'Unknown error'))}\")
    sys.exit(1)
print(f\"  Peering ID: {d.get('id', 'N/A')}\")
print(f\"  Status: {d.get('statusName', 'N/A')}\")
print(f\"  Atlas CIDR: {d.get('atlasCidrBlock', 'N/A')}\")
print(f\"  AWS Connection ID: {d.get('connectionId', 'pending...')}\")
" 2>/dev/null || {
    echo "  Failed to parse response. Raw:"
    echo "$PEERING_RESULT"
  }
fi

echo ""

# ─── Step 4: Wait for AWS peering connection to appear ───────────────────────
echo "Step 4: Waiting for VPC peering connection in AWS..."
echo "  (Atlas takes 1-3 minutes to create the connection)"

for i in $(seq 1 20); do
  PEERING_CONN=$(aws ec2 describe-vpc-peering-connections \
    --filters "Name=accepter-vpc-info.vpc-id,Values=$AWS_VPC_ID" \
              "Name=status-code,Values=pending-acceptance,active" \
    --query 'VpcPeeringConnections[0]' \
    --output json 2>/dev/null || echo "null")

  if [ "$PEERING_CONN" != "null" ]; then
    PCX_ID=$(echo "$PEERING_CONN" | python3 -c "import sys,json; print(json.load(sys.stdin)['VpcPeeringConnectionId'])")
    ATLAS_CIDR=$(echo "$PEERING_CONN" | python3 -c "import sys,json; print(json.load(sys.stdin)['RequesterVpcInfo']['CidrBlock'])")
    STATUS=$(echo "$PEERING_CONN" | python3 -c "import sys,json; print(json.load(sys.stdin)['Status']['Code'])")
    echo "  Found: $PCX_ID (status: $STATUS)"
    echo "  Atlas VPC CIDR: $ATLAS_CIDR"
    break
  fi

  echo "  Waiting... ($i/20)"
  sleep 10
done

if [ -z "${PCX_ID:-}" ]; then
  echo "  Timed out waiting for peering connection."
  echo "  Check Atlas console and AWS VPC → Peering Connections manually."
  echo ""
  echo "  Once you have the connection ID (pcx-...) and Atlas CIDR, run:"
  echo "    cd terraform"
  echo "    terraform apply -var-file=production.tfvars \\"
  echo "      -var 'atlas_peering_connection_id=pcx-xxx' \\"
  echo "      -var 'atlas_vpc_cidr=192.168.x.x/21'"
  exit 1
fi

# ─── Step 5: Apply Terraform to accept peering and add routes ────────────────
echo ""
echo "Step 5: Applying Terraform to accept peering and add routes..."
cd "$(dirname "$0")/../terraform"

terraform apply -var-file=production.tfvars \
  -var "atlas_peering_connection_id=${PCX_ID}" \
  -var "atlas_vpc_cidr=${ATLAS_CIDR}" \
  -target=aws_vpc_peering_connection_accepter.atlas \
  -target=aws_route.atlas_private \
  -target=aws_security_group_rule.ecs_to_atlas \
  -auto-approve

echo ""

# ─── Step 6: Update Atlas IP Access List ─────────────────────────────────────
echo "Step 6: Adding VPC CIDR to Atlas IP Access List..."
curl -s --digest -u "${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}" \
  -X POST "${ATLAS_API_BASE}/groups/${ATLAS_PROJECT_ID}/accessList" \
  -H "Content-Type: application/vnd.atlas.2023-02-01+json" \
  -H "Accept: application/vnd.atlas.2023-02-01+json" \
  -d "[{\"cidrBlock\": \"${AWS_VPC_CIDR}\", \"comment\": \"YClaw Agents VPC (peering)\"}]" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print(f\"  ERROR: {d.get('detail', d.get('error', 'Unknown'))}\")
else:
    print(f\"  Added {d.get('totalCount', '?')} entry to IP Access List\")
" 2>/dev/null || echo "  (check Atlas console to verify)"

echo ""
echo "=== VPC Peering Setup Complete ==="
echo ""
echo "IMPORTANT: Final manual steps in Atlas Console:"
echo "  1. Go to: Network Access → IP Access List"
echo "  2. Verify your VPC CIDR is listed"
echo "  3. DELETE the 0.0.0.0/0 entry (Allow Access from Anywhere)"
echo "  4. Test: Force a new ECS deployment to verify connectivity"
echo "     aws ecs update-service --cluster yclaw-cluster-production \\"
echo "       --service yclaw-production --force-new-deployment"
echo ""
echo "Peering Connection: $PCX_ID"
echo "Atlas VPC CIDR: $ATLAS_CIDR"
echo "Status: Active"
