#!/bin/bash
set -euo pipefail

# Build and push AgentHub Docker image from the monorepo
# Run from repo root: ./scripts/agenthub-build-push.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/yclaw-agenthub"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build -t yclaw-agenthub -f "${REPO_ROOT}/infra/agenthub/Dockerfile" "${REPO_ROOT}/infra/agenthub"
docker tag yclaw-agenthub:latest "${REPO}:latest"
docker push "${REPO}:latest"

echo "Pushed ${REPO}:latest"

# Force ECS to pull the new image
CLUSTER="yclaw-cluster-production"
SERVICE="yclaw-agenthub"
echo "Forcing new deployment of ${SERVICE}..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --no-cli-pager

echo "Deployment triggered. Monitor: aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION"
