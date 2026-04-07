#!/bin/bash
set -euo pipefail

# Register agents with AgentHub (idempotent — merges new keys with existing SM secret).
# Compatible with macOS bash 3.x (no associative arrays).

AGENTHUB_URL="${1:?Usage: register-agents.sh <agenthub-url>}"
ADMIN_KEY="${AGENTHUB_ADMIN_KEY:?Set AGENTHUB_ADMIN_KEY}"
REGION="${AWS_REGION:-us-east-1}"
SECRET_ID="yclaw/agenthub-agent-keys"

AGENTS=(
  strategist builder worker-1 worker-2 worker-3 reviewer deployer
  architect designer ember scout sentinel forge guide keeper treasurer
)

echo "Registering ${#AGENTS[@]} agents..."

# Fetch existing keys from Secrets Manager.
# Only treat "ResourceNotFoundException" (new setup) as empty — abort on any other error.
SM_ERR=""
EXISTING_KEYS=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --region "$REGION" \
  --query SecretString \
  --output text 2>/tmp/sm_err.txt) || SM_ERR=$(cat /tmp/sm_err.txt)
rm -f /tmp/sm_err.txt

if [ -n "$SM_ERR" ]; then
  if echo "$SM_ERR" | grep -q "ResourceNotFoundException"; then
    echo "No existing secret found — starting fresh."
    EXISTING_KEYS='{}'
  else
    echo "FATAL: Failed to read existing secret from Secrets Manager:" >&2
    echo "$SM_ERR" >&2
    echo "Aborting to prevent overwriting existing keys." >&2
    exit 1
  fi
fi

# Validate existing keys are valid JSON
if ! echo "$EXISTING_KEYS" | jq empty 2>/dev/null; then
  echo "FATAL: Existing secret is not valid JSON — aborting." >&2
  exit 1
fi

# Start with existing keys
MERGED="$EXISTING_KEYS"

new_count=0
skip_count=0
fail_count=0

for agent in "${AGENTS[@]}"; do
  # Check if we already have a key for this agent
  existing_key=$(echo "$MERGED" | jq -r --arg id "$agent" '.[$id] // empty')
  if [ -n "$existing_key" ]; then
    echo "  ${agent}: already has key (skipped)"
    skip_count=$((skip_count + 1))
    continue
  fi

  result=$(curl -s -X POST "${AGENTHUB_URL}/api/admin/agents" \
    -H "Authorization: Bearer ${ADMIN_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${agent}\"}")

  api_key=$(echo "$result" | jq -r '.api_key // empty')

  if [ -n "$api_key" ]; then
    echo "  ${agent}: registered"
    MERGED=$(echo "$MERGED" | jq --arg id "$agent" --arg key "$api_key" '. + {($id): $key}')
    new_count=$((new_count + 1))
  else
    error=$(echo "$result" | jq -r '.error // "unknown error"')
    if [ "$error" = "agent already exists" ]; then
      echo "  ${agent}: exists in AgentHub but key not in SM (key was lost — re-create manually)"
      fail_count=$((fail_count + 1))
    else
      echo "  ${agent}: ${error}"
      fail_count=$((fail_count + 1))
    fi
  fi
done

echo ""
echo "Summary: ${new_count} new, ${skip_count} skipped, ${fail_count} failed"

if [ "$new_count" -gt 0 ]; then
  echo ""
  echo "Merged keys:"
  echo "$MERGED" | jq .

  if [ "${STORE_KEYS:-false}" = "true" ]; then
    aws secretsmanager put-secret-value \
      --secret-id "$SECRET_ID" \
      --secret-string "$MERGED" \
      --region "$REGION"
    echo "Updated ${SECRET_ID} in Secrets Manager"
  else
    echo ""
    echo "Run with STORE_KEYS=true to update Secrets Manager"
  fi
else
  echo "No new keys to store."
fi

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
