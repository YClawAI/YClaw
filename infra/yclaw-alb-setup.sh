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
# This creates a DEDICATED YCLAW ALB — separate from Gaze for blast radius isolation.

set -euo pipefail

REGION="us-east-1"
VPC_ID="vpc-073bfb3fea4bf6c6e"
ECS_SG="sg-0acd17c5db21318b8"

# Public subnets (for ALB)
PUBLIC_SUBNETS="subnet-0dfd5229751fb1535,subnet-00afaacdd2e258cb8,subnet-07e8b090cc8c0ac76"

# Private subnets (ECS tasks)
PRIVATE_SUBNETS="subnet-048fa741545cd5571,subnet-09fdbcba9b85fee5c,subnet-095e4d44d6ab976c6"

# ============================================================================
# Step 1: ACM Certificate
# ============================================================================
echo "--- Step 1: Request ACM wildcard certificate ---"

# Request cert for *.yclaw.ai + yclaw.ai (bare domain)
aws acm request-certificate \
  --domain-name "yclaw.ai" \
  --subject-alternative-names "*.yclaw.ai" \
  --validation-method DNS \
  --region "$REGION" \
  --tags Key=Project,Value=yclaw

echo ">>> After running, note the CertificateArn."
echo ">>> Run: aws acm describe-certificate --certificate-arn <ARN> --query 'Certificate.DomainValidationOptions'"
echo ">>> Add the CNAME records to Route 53 for DNS validation."
echo ">>> Wait for certificate status to become ISSUED before proceeding."
echo ""

# ============================================================================
# Step 2: ALB Security Group
# ============================================================================
echo "--- Step 2: Create ALB Security Group ---"

ALB_SG=$(aws ec2 create-security-group \
  --group-name "yclaw-alb-sg" \
  --description "YCLAW ALB - internet-facing" \
  --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=security-group,Tags=[{Key=Name,Value=yclaw-alb-sg},{Key=Project,Value=yclaw}]' \
  --query 'GroupId' --output text)

echo "Created ALB SG: $ALB_SG"

# Inbound: HTTPS + HTTP from anywhere
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" \
  --ip-permissions \
    IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges='[{CidrIp=0.0.0.0/0,Description="HTTPS from internet"}]' \
    IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges='[{CidrIp=0.0.0.0/0,Description="HTTP redirect to HTTPS"}]'

# Outbound: to ECS SG on ports 3000, 3001
aws ec2 authorize-security-group-egress --group-id "$ALB_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$ECS_SG,Description=Core}]" \
    "IpProtocol=tcp,FromPort=3001,ToPort=3001,UserIdGroupPairs=[{GroupId=$ECS_SG,Description=MC}]"

echo ""

# ============================================================================
# Step 3: Update ECS Security Group
# ============================================================================
echo "--- Step 3: Update ECS Security Group ---"

# Allow inbound from ALB SG on ports 3000, 3001
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,UserIdGroupPairs=[{GroupId=$ALB_SG,Description='ALB to Core'}]" \
    "IpProtocol=tcp,FromPort=3001,ToPort=3001,UserIdGroupPairs=[{GroupId=$ALB_SG,Description='ALB to MC'}]"

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

echo "AO TG: $AO_TG (health tracking only, no public listener rule)"
echo ""

# ============================================================================
# Step 5: Create Internet-Facing ALB
# ============================================================================
echo "--- Step 5: Create ALB ---"

ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "yclaw-lb-production" \
  --scheme internet-facing \
  --type application \
  --subnets $PUBLIC_SUBNETS \
  --security-groups "$ALB_SG" \
  --tags Key=Project,Value=yclaw \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

echo "ALB ARN: $ALB_ARN"

ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)

ALB_ZONE=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)

echo "ALB DNS: $ALB_DNS"
echo "ALB Hosted Zone: $ALB_ZONE"
echo ""

# ============================================================================
# Step 6: Create Listeners
# ============================================================================
echo "--- Step 6: Create Listeners ---"
echo ">>> Replace <ACM_CERT_ARN> with the certificate ARN from Step 1."

# HTTP:80 → redirect to HTTPS
aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP --port 80 \
  --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'

# HTTPS:443 → default fixed 404
# Replace <ACM_CERT_ARN> with your certificate ARN
ACM_CERT_ARN="<ACM_CERT_ARN>"  # TODO: Replace with actual ARN

HTTPS_LISTENER=$(aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates CertificateArn="$ACM_CERT_ARN" \
  --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=Not Found}' \
  --query 'Listeners[0].ListenerArn' --output text)

echo "HTTPS Listener: $HTTPS_LISTENER"
echo ""

# ============================================================================
# Step 7: Listener Rules (host-based routing)
# ============================================================================
echo "--- Step 7: Create Listener Rules ---"

# app.yclaw.ai → Mission Control
aws elbv2 create-rule \
  --listener-arn "$HTTPS_LISTENER" \
  --priority 10 \
  --conditions Field=host-header,Values=app.yclaw.ai \
  --actions Type=forward,TargetGroupArn="$MC_TG"

# api.yclaw.ai → Core
aws elbv2 create-rule \
  --listener-arn "$HTTPS_LISTENER" \
  --priority 20 \
  --conditions Field=host-header,Values=api.yclaw.ai \
  --actions Type=forward,TargetGroupArn="$CORE_TG"

echo "AO stays internal only — no public listener rule."
echo ""

# ============================================================================
# Step 8: Attach ECS Services to Target Groups
# ============================================================================
echo "--- Step 8: Attach ECS Services to Target Groups ---"
echo ">>> These commands update ECS services to register with ALB target groups."
echo ">>> This will trigger a new deployment of each service."

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
echo ">>> Create these records in the yclaw.ai hosted zone."
echo ">>> Replace <HOSTED_ZONE_ID> with your Route 53 hosted zone ID for yclaw.ai."
echo ">>> ALB DNS: $ALB_DNS"
echo ">>> ALB Hosted Zone ID: $ALB_ZONE"

ZONE_ID="<HOSTED_ZONE_ID>"  # TODO: Replace with yclaw.ai hosted zone ID

# app.yclaw.ai → ALB alias
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID" \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "app.yclaw.ai",
          "Type": "A",
          "AliasTarget": {
            "DNSName": "'"$ALB_DNS"'",
            "HostedZoneId": "'"$ALB_ZONE"'",
            "EvaluateTargetHealth": true
          }
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.yclaw.ai",
          "Type": "A",
          "AliasTarget": {
            "DNSName": "'"$ALB_DNS"'",
            "HostedZoneId": "'"$ALB_ZONE"'",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Verification:"
echo "  curl -s https://app.yclaw.ai/api/health  # MC health"
echo "  curl -s https://api.yclaw.ai/health       # Core health"
echo ""

# ============================================================================
# Environment Variable Updates for Task Definitions
# ============================================================================
cat <<'ENVDOC'

=== TASK DEFINITION ENV VAR UPDATES ===

After ALB is created and services are registered, update these env vars
in each ECS task definition via aws ecs register-task-definition:

--- Core (yclaw-production) ---
  No URL changes needed (Core is the API server).
  Optional: AO_BRIDGE_URL=http://<ao-task-private-ip>:8420
  Note: For now use task private IPs. Set up Cloud Map / ECS Service
  Connect as a follow-up for stable internal DNS names.

--- MC (yclaw-mission-control-production) ---
  YCLAW_API_URL=http://<core-task-private-ip>:3000     # server-side (internal)
  NEXT_PUBLIC_YCLAW_API_URL=https://api.yclaw.ai       # browser-side (public)
  NEXTAUTH_URL=https://app.yclaw.ai                    # NextAuth callback base

--- AO (yclaw-ao-production) ---
  AO_CALLBACK_URL=http://<core-task-private-ip>:3000/api/ao/callback

--- Service Discovery Note ---
  <core-task-private-ip> and <ao-task-private-ip> are ECS task private IPs.
  These change on every deployment. For stable names, set up:
  - AWS Cloud Map namespace (e.g., yclaw.local)
  - ECS Service Connect or service discovery
  This is a follow-up task, not part of this go-live.

  Workaround until then: use the ALB for MC→Core (YCLAW_API_URL=https://api.yclaw.ai)
  and for AO→Core (AO_CALLBACK_URL=https://api.yclaw.ai/api/ao/callback).
  This adds a round-trip through the ALB but avoids IP instability.

ENVDOC
