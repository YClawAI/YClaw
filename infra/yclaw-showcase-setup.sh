#!/usr/bin/env bash
# YCLAW Showcase — AWS Infrastructure Setup
# Run manually after the showcase Docker image is built and pushed.
#
# Prerequisites:
#   - Public ALB (yclaw-lb-production) already created via yclaw-alb-setup.sh
#   - ACM wildcard cert (*.yclaw.ai) already issued
#   - ECS cluster: yclaw-cluster-production

set -euo pipefail

REGION="us-east-1"
ACCOUNT="<AWS_ACCOUNT_ID>"
VPC_ID="<VPC_ID>"
ECS_CLUSTER="yclaw-cluster-production"
ECS_SG="<ECS_SECURITY_GROUP_ID>"
PRIVATE_SUBNETS="<PRIVATE_SUBNET_1> <PRIVATE_SUBNET_2> <PRIVATE_SUBNET_3>"

# ============================================================================
# Step 1: ECR Repository
# ============================================================================
echo "--- Step 1: Create ECR Repository ---"

aws ecr create-repository \
  --repository-name yclaw-showcase \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  --tags Key=Project,Value=yclaw \
  --region "$REGION"

# Lifecycle policy: keep last 10 images
aws ecr put-lifecycle-policy \
  --repository-name yclaw-showcase \
  --lifecycle-policy-text '{
    "rules": [{
      "rulePriority": 1,
      "description": "Keep last 10 images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": { "type": "expire" }
    }]
  }' \
  --region "$REGION"

echo ""

# ============================================================================
# Step 2: CloudWatch Log Group
# ============================================================================
echo "--- Step 2: Create Log Group ---"

aws logs create-log-group \
  --log-group-name /ecs/yclaw-showcase \
  --tags Project=yclaw \
  --region "$REGION"

aws logs put-retention-policy \
  --log-group-name /ecs/yclaw-showcase \
  --retention-in-days 30 \
  --region "$REGION"

echo ""

# ============================================================================
# Step 3: Register Task Definition
# ============================================================================
echo "--- Step 3: Register Task Definition ---"

cat > /tmp/yclaw-taskdef-showcase.json << TASKDEF
{
  "family": "yclaw-showcase-production",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::${ACCOUNT}:role/yclaw-ecs-task-execution-role",
  "taskRoleArn": "arn:aws:iam::${ACCOUNT}:role/yclaw-ecs-task-role",
  "containerDefinitions": [
    {
      "name": "showcase",
      "image": "public.ecr.aws/amazonlinux/amazonlinux:latest",
      "essential": true,
      "command": ["sleep", "3600"],
      "portMappings": [
        { "containerPort": 3002, "hostPort": 3002, "protocol": "tcp" }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3002" },
        { "name": "YCLAW_PUBLIC_API_URL", "value": "https://agents.yclaw.ai" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/yclaw-showcase",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "showcase"
        }
      }
    }
  ],
  "tags": [
    { "key": "Project", "value": "yclaw" }
  ]
}
TASKDEF

aws ecs register-task-definition \
  --cli-input-json file:///tmp/yclaw-taskdef-showcase.json \
  --region "$REGION"

echo "NOTE: Task def uses placeholder image. First deploy via CI will replace it."
echo ""

# ============================================================================
# Step 4: Target Group
# ============================================================================
echo "--- Step 4: Create Target Group ---"

SHOWCASE_TG=$(aws elbv2 create-target-group \
  --name "yclaw-showcase-tg" \
  --protocol HTTP --port 3002 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path "/api/health" \
  --health-check-interval-seconds 15 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --tags Key=Project,Value=yclaw \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

echo "Showcase TG: $SHOWCASE_TG"
echo ""

# ============================================================================
# Step 5: Add Listener Rule on Public ALB
# ============================================================================
echo "--- Step 5: Add live.yclaw.ai → Showcase Listener Rule ---"
echo ">>> Find your public ALB HTTPS listener ARN first:"
echo ">>> aws elbv2 describe-listeners --load-balancer-arn <PUB_ALB_ARN> --query 'Listeners[?Port==\`443\`].ListenerArn' --output text"

PUB_HTTPS_LISTENER="<PUB_HTTPS_LISTENER_ARN>"  # TODO: Replace

aws elbv2 create-rule \
  --listener-arn "$PUB_HTTPS_LISTENER" \
  --priority 5 \
  --conditions Field=host-header,Values=live.yclaw.ai \
  --actions "Type=forward,TargetGroupArn=$SHOWCASE_TG"

echo ""

# ============================================================================
# Step 6: Update ECS SG for port 3002
# ============================================================================
echo "--- Step 6: Update ECS SG for Showcase port ---"

PUB_ALB_SG="<PUB_ALB_SG>"  # TODO: Replace with yclaw-alb-sg ID

# ALB SG outbound → ECS on 3002
aws ec2 authorize-security-group-egress --group-id "$PUB_ALB_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3002,ToPort=3002,UserIdGroupPairs=[{GroupId=$ECS_SG,Description=Showcase}]"

# ECS SG inbound from ALB on 3002
aws ec2 authorize-security-group-ingress --group-id "$ECS_SG" \
  --ip-permissions \
    "IpProtocol=tcp,FromPort=3002,ToPort=3002,UserIdGroupPairs=[{GroupId=$PUB_ALB_SG,Description='Public ALB to Showcase'}]"

echo ""

# ============================================================================
# Step 7: Create ECS Service
# ============================================================================
echo "--- Step 7: Create ECS Service ---"

aws ecs create-service \
  --cluster "$ECS_CLUSTER" \
  --service-name yclaw-showcase-production \
  --task-definition yclaw-showcase-production \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$SHOWCASE_TG,containerName=showcase,containerPort=3002" \
  --tags key=Project,value=yclaw \
  --region "$REGION"

echo ""

# ============================================================================
# Step 8: DNS Record
# ============================================================================
echo "--- Step 8: DNS Record ---"
echo ">>> Add to Route 53:"
echo ">>> live.yclaw.ai → ALIAS to yclaw-lb-production ALB DNS"
echo ">>> (Already covered by *.yclaw.ai wildcard cert)"

echo ""
echo "=== SHOWCASE INFRASTRUCTURE SETUP COMPLETE ==="
echo ""
echo "Verification:"
echo "  curl -s https://live.yclaw.ai/api/health"
echo ""
echo "NOTE: Zero secrets in task definition. Showcase only reads from Core public API."
