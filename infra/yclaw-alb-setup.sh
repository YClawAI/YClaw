#!/usr/bin/env bash
# YCLAW Production ALB + Networking Setup
# Run these commands manually (or in order) from a shell with AWS CLI configured.
#
# Prerequisites:
#   - AWS CLI v2 configured for account 862974744285, us-east-1
#   - VPC: vpc-073bfb3fea4bf6c6e (shared with Gaze)
#   - ECS SG: sg-0acd17c5db21318b8
#   - ECS cluster: yclaw-cluster-production (3 services running)
#
# Architecture (same pattern as Gaze):
#   - PUBLIC ALB  (yclaw-lb-production)       → Core API at agents.yclaw.ai
#   - INTERNAL ALB (yclaw-internal-production) → MC UI via Tailscale only
#   - AO stays internal only (no ALB listener, TG for health tracking)

set -euo pipefail

REGION="us-east-1"
VPC_ID="vpc-073bfb3fea4bf6c6e"
ECS_SG="sg-0acd17c5db21318b8"

# Public subnets (for public ALB)
PUBLIC_SUBNETS="subnet-0dfd5229751fb1535 subnet-00afaacdd2e258cb8 subnet-07e8b090cc8c0ac76"

# Private subnets (for internal ALB + ECS tasks)
PRIVATE_SUBNETS="subnet-048fa741545cd5571 subnet-09fdbcba9b85fee5c subnet-095e4d44d6ab976c6"

ACM_CERT_ARN="<ACM_CERT_ARN>"  # TODO: Replace after Step 1
ZONE_ID="<HOSTED_ZONE_ID>"     # TODO: Replace with yclaw.ai Route 53 hosted zone ID

# ============================================================================
# Step 1: ACM Certificate
# ============================================================================
echo "--- Step 1: Request ACM wildcard certificate ---"

aws acm request-certificate \
  --domain-name "yclaw.ai" \
  --subject-alternative-names "*.yclaw.ai" \
  --validation-method DNS \
  --region "$REGION" \
  --tags Key=Project,Value=yclaw

echo ">>> Note the CertificateArn, then:"
echo ">>> aws acm describe-certificate --certificate-arn <ARN> --query 'Certificate.DomainValidationOptions'"
echo ">>> Add the CNAME records to Route 53 for DNS validation."
echo ">>> Wait for status ISSUED before proceeding."
echo ""

# ============================================================================
# Step 2: Security Groups
# ============================================================================
echo "--- Step 2a: Create Public ALB Security Group ---"

PUB_ALB_SG=$(aws ec2 create-security-group \
  --group-name "yclaw-alb-sg" \
  --description "YCLAW public ALB - internet-facing, Core API only" \
  --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=security-group,Tags=[{Key=Name,Value=yclaw-alb-sg},{Key=Project,Value=yclaw}]' \
  --query 'GroupId' --output text)

echo "Public ALB SG: $PUB_ALB_SG"

# Inbound: HTTPS + HTTP from anywhere
aws ec2 authorize-security-group-ingress --group-id "$PUB_ALB_SG" \
  --ip-permissions \
    IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges='[{CidrIp=0.0.0.0/0,Description="HTTPS from internet"}]' \
    IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges='[{CidrIp=0.0.0.0/0,Description="HTTP redirect to HTTPS"}]'

# Outbound: to ECS SG on port 3000 only (Core API)
aws ec2 authorize-security-group-egress --group-id "$PUB_ALB_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$ECS_SG,Description=Core}]"

echo ""
echo "--- Step 2b: Create Internal ALB Security Group ---"

INT_ALB_SG=$(aws ec2 create-security-group \
  --group-name "yclaw-internal-alb-sg" \
  --description "YCLAW internal ALB - MC UI via Tailscale" \
  --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=security-group,Tags=[{Key=Name,Value=yclaw-internal-alb-sg},{Key=Project,Value=yclaw}]' \
  --query 'GroupId' --output text)

echo "Internal ALB SG: $INT_ALB_SG"

# Inbound: HTTPS + HTTP from VPC CIDR only (Tailscale access via EC2 bridge)
aws ec2 authorize-security-group-ingress --group-id "$INT_ALB_SG" \
  --ip-permissions \
    IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges='[{CidrIp=10.0.0.0/16,Description="HTTPS from VPC (Tailscale)"}]' \
    IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges='[{CidrIp=10.0.0.0/16,Description="HTTP redirect from VPC"}]'

# Outbound: to ECS SG on port 3001 only (MC)
aws ec2 authorize-security-group-egress --group-id "$INT_ALB_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3001,ToPort=3001,UserIdGroupPairs=[{GroupId=$ECS_SG,Description=MC}]"

echo ""

# ============================================================================
# Step 3: Update ECS Security Group
# ============================================================================
echo "--- Step 3: Update ECS Security Group ---"

# Allow inbound from public ALB SG on port 3000 (Core)
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$PUB_ALB_SG,Description='Public ALB to Core'}]"

# Allow inbound from internal ALB SG on port 3001 (MC)
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3001,ToPort=3001,UserIdGroupPairs=[{GroupId=$INT_ALB_SG,Description='Internal ALB to MC'}]"

# Allow inbound from self (inter-service comms: Core<->AO, MC->Core)
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$ECS_SG,Description='Self: Core'}]" \
    "IpProtocol=tcp,FromPort=3001,ToPort=3001,UserIdGroupPairs=[{GroupId=$ECS_SG,Description='Self: MC'}]" \
    "IpProtocol=tcp,FromPort=8420,ToPort=8420,UserIdGroupPairs=[{GroupId=$ECS_SG,Description='Self: AO bridge'}]"

echo ""

# ============================================================================
# Step 4: Create Target Groups
# ============================================================================
echo "--- Step 4: Create Target Groups ---"

CORE_TG=$(aws elbv2 create-target-group \
  --name "yclaw-core-tg" \
  --protocol HTTP --port 3000 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path "/health" \
  --health-check-interval-seconds 15 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --tags Key=Project,Value=yclaw \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

echo "Core TG: $CORE_TG"

MC_TG=$(aws elbv2 create-target-group \
  --name "yclaw-mc-tg" \
  --protocol HTTP --port 3001 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path "/api/health" \
  --health-check-interval-seconds 15 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --tags Key=Project,Value=yclaw \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

echo "MC TG: $MC_TG"

AO_TG=$(aws elbv2 create-target-group \
  --name "yclaw-ao-tg" \
  --protocol HTTP --port 8420 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path "/health" \
  --health-check-interval-seconds 15 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --tags Key=Project,Value=yclaw \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

echo "AO TG: $AO_TG (health tracking only, no listener rule)"
echo ""

# ============================================================================
# Step 5: Create Public ALB (internet-facing, Core API)
# ============================================================================
echo "--- Step 5a: Create Public ALB ---"

PUB_ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "yclaw-lb-production" \
  --scheme internet-facing \
  --type application \
  --subnets $PUBLIC_SUBNETS \
  --security-groups "$PUB_ALB_SG" \
  --tags Key=Project,Value=yclaw \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

PUB_ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$PUB_ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)

PUB_ALB_ZONE=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$PUB_ALB_ARN" \
  --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)

echo "Public ALB ARN:  $PUB_ALB_ARN"
echo "Public ALB DNS:  $PUB_ALB_DNS"
echo "Public ALB Zone: $PUB_ALB_ZONE"

echo ""
echo "--- Step 5b: Create Internal ALB ---"

INT_ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "yclaw-internal-production" \
  --scheme internal \
  --type application \
  --subnets $PRIVATE_SUBNETS \
  --security-groups "$INT_ALB_SG" \
  --tags Key=Project,Value=yclaw \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

INT_ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$INT_ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)

echo "Internal ALB ARN: $INT_ALB_ARN"
echo "Internal ALB DNS: $INT_ALB_DNS"
echo ""

# ============================================================================
# Step 6: Create Listeners
# ============================================================================
echo "--- Step 6: Create Listeners ---"

# --- Public ALB listeners ---

# HTTP:80 → redirect to HTTPS
aws elbv2 create-listener \
  --load-balancer-arn "$PUB_ALB_ARN" \
  --protocol HTTP --port 80 \
  --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'

# HTTPS:443 → default fixed 404 (only path-matched routes reach Core)
PUB_HTTPS_LISTENER=$(aws elbv2 create-listener \
  --load-balancer-arn "$PUB_ALB_ARN" \
  --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn="$ACM_CERT_ARN" \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=Not Found}' \
  --query 'Listeners[0].ListenerArn' --output text)

echo "Public HTTPS Listener: $PUB_HTTPS_LISTENER"

# --- Internal ALB listeners ---

# HTTP:80 → redirect to HTTPS
aws elbv2 create-listener \
  --load-balancer-arn "$INT_ALB_ARN" \
  --protocol HTTP --port 80 \
  --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'

# HTTPS:443 → default forward to MC
aws elbv2 create-listener \
  --load-balancer-arn "$INT_ALB_ARN" \
  --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn="$ACM_CERT_ARN" \
  --default-actions "Type=forward,TargetGroupArn=$MC_TG"

echo "Internal HTTPS Listener: default → MC TG"
echo ""

# ============================================================================
# Step 7: Public ALB Listener Rules (path-based routing on agents.yclaw.ai)
# ============================================================================
echo "--- Step 7: Public ALB Listener Rules ---"

# /api/*, /health, /github/webhook → Core TG
aws elbv2 create-rule \
  --listener-arn "$PUB_HTTPS_LISTENER" \
  --priority 10 \
  --conditions '[{"Field":"path-pattern","Values":["/api/*","/health","/health/*","/github/webhook"]}]' \
  --actions "Type=forward,TargetGroupArn=$CORE_TG"

echo "Path rules: /api/*, /health, /github/webhook → Core"

# live.yclaw.ai → Showcase TG (when showcase service is ready)
# NOTE: yclaw-showcase-tg must be created first via infra/yclaw-showcase-setup.sh
SHOWCASE_TG=$(aws elbv2 describe-target-groups \
  --names "yclaw-showcase-tg" \
  --region "$REGION" \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)

if [[ -z "$SHOWCASE_TG" || "$SHOWCASE_TG" == "None" ]]; then
  echo "ERROR: Target group yclaw-showcase-tg not found. Run infra/yclaw-showcase-setup.sh first."
  exit 1
fi

aws elbv2 create-rule \
  --listener-arn "$PUB_HTTPS_LISTENER" \
  --priority 5 \
  --conditions Field=host-header,Values=live.yclaw.ai \
  --actions "Type=forward,TargetGroupArn=$SHOWCASE_TG"

echo "Host rule: live.yclaw.ai → Showcase"
echo "Default: 404 (MC is NOT on the public ALB)"
echo ""

# ============================================================================
# Step 8: Attach ECS Services to Target Groups
# ============================================================================
echo "--- Step 8: Attach ECS Services to Target Groups ---"

aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-production \
  --load-balancers "targetGroupArn=$CORE_TG,containerName=yclaw-agents,containerPort=3000" \
  --force-new-deployment \
  --no-cli-pager

aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-mc-production \
  --load-balancers "targetGroupArn=$MC_TG,containerName=mission-control,containerPort=3001" \
  --force-new-deployment \
  --no-cli-pager

aws ecs update-service \
  --cluster yclaw-cluster-production \
  --service yclaw-ao-production \
  --load-balancers "targetGroupArn=$AO_TG,containerName=ao,containerPort=8420" \
  --force-new-deployment \
  --no-cli-pager

echo ""

# ============================================================================
# Step 9: DNS Records (Route 53)
# ============================================================================
echo "--- Step 9: DNS Records ---"

# agents.yclaw.ai → public ALB (Core API)
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "agents.yclaw.ai",
          "Type": "A",
          "AliasTarget": {
            "DNSName": "'"$PUB_ALB_DNS"'",
            "HostedZoneId": "'"$PUB_ALB_ZONE"'",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'

echo "agents.yclaw.ai → $PUB_ALB_DNS"

# live.yclaw.ai → same public ALB (host-based routing handles it)
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "live.yclaw.ai",
          "Type": "A",
          "AliasTarget": {
            "DNSName": "'"$PUB_ALB_DNS"'",
            "HostedZoneId": "'"$PUB_ALB_ZONE"'",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'

echo "live.yclaw.ai → $PUB_ALB_DNS"
echo ""
echo "Internal ALB DNS (for MC via Tailscale): $INT_ALB_DNS"
echo "Optional: create private Route 53 record mc-internal.yclaw.ai → internal ALB"
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Verification:"
echo "  curl -s https://agents.yclaw.ai/health         # Core health (public)"
echo "  curl -s https://$INT_ALB_DNS/api/health         # MC health (Tailscale)"
echo ""

# ============================================================================
# Environment Variable Updates for Task Definitions
# ============================================================================
cat <<'ENVDOC'

=== TASK DEFINITION ENV VAR UPDATES ===

After ALBs are created and services are registered, update these env vars
in each ECS task definition via aws ecs register-task-definition:

--- Core (yclaw-production) ---
  No URL changes needed (Core is the API server).
  Optional: AO_BRIDGE_URL=http://<ao-task-private-ip>:8420
  Note: For now use task private IPs. Set up Cloud Map / ECS Service
  Connect as a follow-up for stable internal DNS names.

--- MC (yclaw-mission-control-production) ---
  YCLAW_API_URL=http://<core-task-private-ip>:3000               # server-side (internal)
  NEXT_PUBLIC_YCLAW_API_URL=https://agents.yclaw.ai              # browser-side (public, /api/* path)
  NEXTAUTH_URL=https://<internal-alb-dns>                        # NextAuth callback base (Tailscale)

--- AO (yclaw-ao-production) ---
  AO_CALLBACK_URL=http://<core-task-private-ip>:3000/api/ao/callback

--- Service Discovery Note ---
  <core-task-private-ip> and <ao-task-private-ip> are ECS task private IPs.
  These change on every deployment. For stable names, set up:
  - AWS Cloud Map namespace (e.g., yclaw.local)
  - ECS Service Connect or service discovery
  This is a follow-up task, not part of this go-live.

  Workaround until then: use the public ALB for internal calls too:
  - YCLAW_API_URL=https://agents.yclaw.ai (adds ALB round-trip but stable)
  - AO_CALLBACK_URL=https://agents.yclaw.ai/api/ao/callback

--- Showcase (yclaw-showcase-production) ---
  YCLAW_PUBLIC_API_URL=https://agents.yclaw.ai    # Public Core API
  NODE_ENV=production
  PORT=3002
  (No secrets. Zero secrets in task definition.)

=== REDIS CLOUD CONNECTIVITY ===

Issue: Core gets "connect ETIMEDOUT" on Redis Cloud.

1. NAT Gateway IP Allowlist
   ECS tasks in private subnets egress through NAT gateway.
   NAT public IP: 100.28.108.39
   ACTION: Add 100.28.108.39 to Redis Cloud database access list at:
   https://app.redislabs.com → Database → Configuration → Security → Access Control

2. TLS Requirement
   Redis Cloud databases often require TLS. If connections still fail after
   allowlist is updated, the REDIS_URL secret may need to change from:
     redis://:password@host:port
   to:
     rediss://:password@host:port  (note double 's')

   ioredis auto-detects TLS from the 'rediss://' URL scheme — no code change
   needed, just update the secret value in AWS Secrets Manager:
     aws secretsmanager put-secret-value \
       --secret-id yclaw/production/secrets \
       --secret-string '{"REDIS_URL":"rediss://:PASSWORD@HOST:PORT"}'

=== SERVICE DISCOVERY (FOLLOW-UP) ===

Current state: inter-service URLs use ECS task private IPs which change
on every deployment. The ALB workaround adds latency.

Recommended follow-up:
  - Create AWS Cloud Map namespace: yclaw.local
  - Enable ECS Service Connect on all 3 services
  - Core → core.yclaw.local:3000
  - MC → mc.yclaw.local:3001
  - AO → ao.yclaw.local:8420
  This gives stable DNS names that resolve to current task IPs.

ENVDOC
