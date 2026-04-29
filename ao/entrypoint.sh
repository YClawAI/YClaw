#!/bin/bash
# YClaw Agent Orchestrator entrypoint — MINIMAL DEBUG VERSION
# Stripped to bare essentials to isolate the silent exit.
set -e

echo "[ao-entrypoint] Starting YClaw AO (debug mode)..."

# Fix permissions
chown -R ao:ao /data 2>/dev/null || true
chmod -R u+rwX /data 2>/dev/null || true
mkdir -p /data/ao-home /data/worktrees /data/ao-state
chown -R ao:ao /data/ao-home /data/worktrees /data/ao-state 2>/dev/null || true

# Git config
git config --global --add safe.directory '*'
git config --global user.name "YClaw AO"
git config --global user.email "ao@yclaw.ai"

# GitHub auth (from Secrets Manager env vars, already injected)
if [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_PRIVATE_KEY" ] && [ -n "$GITHUB_APP_INSTALLATION_ID" ]; then
  echo "[ao-entrypoint] Setting up GitHub App auth..."
  INITIAL_TOKEN=$(node /app/token-manager.mjs get-token 2>/dev/null || echo "")
  if [ -n "$INITIAL_TOKEN" ]; then
    echo "$INITIAL_TOKEN" | gh auth login --with-token 2>/dev/null
    export GH_TOKEN="$INITIAL_TOKEN"
    export GITHUB_TOKEN="$INITIAL_TOKEN"
    echo "[ao-entrypoint] GitHub auth: OK"
  else
    echo "[ao-entrypoint] WARN: token-manager failed"
  fi
fi

# Clone repos once (skip if already cloned)
for repo in YClawAI/YClaw YClawAI/yclaw-site; do
  slug=$(echo "$repo" | sed 's#/#__#g')
  if [ ! -d "/data/worktrees/$slug/.git" ]; then
    echo "[ao-entrypoint] Cloning $repo..."
    git clone --depth 50 "https://github.com/${repo}.git" "/data/worktrees/$slug" 2>&1 || echo "[ao-entrypoint] WARN: clone failed for $repo"
  fi
done
chown -R ao:ao /data/worktrees 2>/dev/null || true

# Export secrets for the AO process
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
export OPENAI_API_KEY="${OPENAI_API_KEY}"
export REDIS_URL="${REDIS_URL:-}"
export CI="true"
export AO_CONFIG_PATH=/app/agent-orchestrator.yaml
export AO_CALLBACK_URL="${AO_CALLBACK_URL:-https://agents.yclaw.ai/api/ao/callback}"

# Overlay runtime files from cloned repo (critical: includes modules not in Docker image)
AO_SRC="/data/worktrees/YClawAI__YClaw/ao"
if [ -d "$AO_SRC" ]; then
  for f in ao-bridge-server.mjs queue-store.mjs token-manager.mjs runtime-process.mjs project-store.mjs agent-orchestrator.yaml log-store.mjs spawn-followup.mjs review-gate.mjs; do
    if [ -f "$AO_SRC/$f" ]; then
      cp "$AO_SRC/$f" "/app/$f" && echo "[ao-entrypoint] Overlaid $f"
    else
      echo "[ao-entrypoint] WARN: $f not found in repo"
    fi
  done
else
  echo "[ao-entrypoint] WARN: AO source dir not found — using baked image files"
fi

# Start bridge server
echo "[ao-entrypoint] Starting AO bridge server on :8420..."
export HOME=/data/ao-home
export AO_HOME=/data/ao-home
mkdir -p /data/ao-home/.claude
chown -R ao:ao /data/ao-home 2>/dev/null || true

# Run bridge as ao user but keep entrypoint alive as root
gosu ao node /app/ao-bridge-server.mjs &
BRIDGE_PID=$!
sleep 2

if kill -0 $BRIDGE_PID 2>/dev/null; then
  echo "[ao-entrypoint] Bridge server RUNNING (PID $BRIDGE_PID)"
else
  echo "[ao-entrypoint] FATAL: Bridge failed to start"
  exit 1
fi

# Keep container alive while bridge runs
echo "[ao-entrypoint] Container stable. Waiting..."
wait $BRIDGE_PID
echo "[ao-entrypoint] Bridge exited. Shutting down."
exit 1
