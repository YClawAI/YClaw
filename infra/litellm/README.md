# LiteLLM Proxy — Deploy Guide

LiteLLM runs as a private ECS Fargate service in the `yclaw-production` cluster.
It provides a unified OpenAI-compatible endpoint for all LLM providers, enabling
per-model cost tracking via Postgres spend logs.

## Architecture

```
yclaw containers
    → http://litellm:4000/v1/chat/completions
    → LiteLLM proxy (ECS Fargate, private subnet, no public IP)
        → Anthropic  (claude-sonnet-4-6, claude-opus-4-6)
        → OpenAI     (gpt-5.2, text-embedding-3-large)
        → xAI/Grok   (grok-4-1-fast-reasoning via api.x.ai)
        → Gemini     (gemini-3.1-pro-preview)
        → OpenRouter (wildcard pass-through)
    → Postgres (yclaw-memory-production RDS, litellm database)
```

**Cost tracking:** LiteLLM logs every request to Postgres. The Treasurer agent
queries `/global/spend/report` to get aggregate spend by provider and model.

**Fallback:** If the LiteLLM proxy is unreachable, yclaw falls back to direct
provider calls automatically (no data loss, just no cost tracking for that request).

## One-Time Setup

### 1. Create the ECR repository

```bash
aws ecr create-repository \
  --repository-name litellm-proxy \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true
```

### 2. Create the `litellm` Postgres database

Connect to the RDS instance and create the database:

```bash
# Get the DB password from Secrets Manager first
DB_PASS=$(aws secretsmanager get-secret-value \
  --secret-id yclaw/production/secrets \
  --query 'SecretString' --output text | jq -r '.DB_PASSWORD')

psql "postgresql://yclaw_admin:${DB_PASS}@yclaw-memory-production.cv3nsndexxru.us-east-1.rds.amazonaws.com:5432/postgres" \
  -c "CREATE DATABASE litellm;" \
  -c "GRANT ALL PRIVILEGES ON DATABASE litellm TO yclaw_admin;"
```

### 3. Add secrets to Secrets Manager

**Add `LITELLM_MASTER_KEY` to the existing secrets JSON:**

```bash
# Generate a random master key
MASTER_KEY="sk-$(openssl rand -hex 32)"
echo "Save this key: $MASTER_KEY"

# Add to existing secrets JSON (update the secret with the new key)
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id yclaw/production/secrets \
  --query SecretString --output text)

UPDATED=$(echo "$CURRENT" | jq --arg key "$MASTER_KEY" '. + {LITELLM_MASTER_KEY: $key, LITELLM_API_KEY: $key}')

aws secretsmanager put-secret-value \
  --secret-id yclaw/production/secrets \
  --secret-string "$UPDATED"
```

**Create the database URL secret:**

```bash
DB_PASS=$(aws secretsmanager get-secret-value \
  --secret-id yclaw/production/secrets \
  --query 'SecretString' --output text | jq -r '.DB_PASSWORD')

aws secretsmanager create-secret \
  --name yclaw/production/litellm-db-url \
  --region us-east-1 \
  --secret-string "postgresql://yclaw_admin:${DB_PASS}@yclaw-memory-production.cv3nsndexxru.us-east-1.rds.amazonaws.com:5432/litellm"
```

### 4. Grant the task execution role access to the new secret

```bash
# Add secretsmanager:GetSecretValue for the new secret to ecsTaskExecutionRole
# (The role likely already has a policy for yclaw/production/secrets)
aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name LiteLLMDbUrlSecret \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:<AWS_ACCOUNT_ID>:secret:yclaw/production/litellm-db-url*"
    }]
  }'
```

## Deploy

### Build and push the Docker image

```bash
cd infra/litellm

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build (config is baked in — no secrets in the image)
docker build -t litellm-proxy:latest .

# Tag and push
docker tag litellm-proxy:latest \
  <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/litellm-proxy:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/litellm-proxy:latest
```

### Register the ECS task definition

```bash
aws ecs register-task-definition \
  --region us-east-1 \
  --cli-input-json file://task-definition.json
```

### Create the ECS service

Replace `<SUBNET_ID_1>`, `<SUBNET_ID_2>` with the private subnet IDs used by yclaw.

```bash
aws ecs create-service \
  --cluster yclaw-production \
  --service-name litellm-proxy \
  --task-definition litellm-proxy \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={
    subnets=[<SUBNET_ID_1>,<SUBNET_ID_2>],
    securityGroups=[sg-0acd17c5db21318b8],
    assignPublicIp=DISABLED
  }" \
  --service-connect-configuration '{
    "enabled": true,
    "namespace": "yclaw-production",
    "services": [{
      "portName": "litellm",
      "clientAliases": [{"port": 4000, "dnsName": "litellm"}]
    }]
  }'
```

> **Service Connect prerequisite:** The `yclaw-production` cluster must have
> a default Cloud Map namespace configured. If not, either create one via
> `aws servicediscovery create-private-dns-namespace` or use a different internal
> routing approach (e.g., a dedicated security-group rule + fixed IP).

## Enabling LiteLLM routing in yclaw

Add these environment variables to the yclaw ECS task definition:

| Variable | Value | Notes |
|---|---|---|
| `LITELLM_PROXY_URL` | `http://litellm:4000` | Service Connect DNS name |
| `LITELLM_API_KEY` | `<master key>` | From `yclaw/production/secrets:LITELLM_API_KEY` |

When `LITELLM_PROXY_URL` is set, all LLM calls route through LiteLLM. If the proxy
is unreachable (e.g., during cold start), yclaw falls back to direct provider
calls automatically.

## Spend Reporting

LiteLLM exposes spend data at:

- `GET /global/spend/report` — aggregate spend by model, provider, user, and tag
- `GET /spend/logs` — per-request logs (filterable by `start_date`, `end_date`)
- `GET /global/spend/report?group_by=provider` — provider breakdown

Authenticate with: `Authorization: Bearer <LITELLM_MASTER_KEY>`

The Treasurer agent queries `/global/spend/report` via the `litellm_spend` data
source to include LLM costs in weekly/monthly spend reports.

## Updating the Config

When adding new models or changing provider routing:

1. Edit `infra/litellm/litellm_config.yaml`
2. Rebuild and push the Docker image (step above)
3. Force a new ECS deployment:
   ```bash
   aws ecs update-service \
     --cluster yclaw-production \
     --service litellm-proxy \
     --force-new-deployment
   ```

## Known Limitations

- **Anthropic prompt caching** is not forwarded through LiteLLM's OpenAI-compat
  endpoint. Cache metrics will show 0 when routing through the proxy. LiteLLM's
  native Anthropic passthrough mode would be needed to preserve caching.
- **Google Veo** video generation is not supported by LiteLLM — those calls
  continue to route directly to the Gemini API.
- **At-most-once** tracking: if the proxy crashes mid-request, that spend entry
  may not be recorded.
