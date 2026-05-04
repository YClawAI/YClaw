#!/bin/bash
# YClaw Agent Orchestrator entrypoint
set -e

echo "[ao-entrypoint] Starting YClaw AO..."

# Fix permissions
chown -R ao:ao /data 2>/dev/null || true
chmod -R u+rwX /data 2>/dev/null || true
mkdir -p /data/ao-home /data/worktrees /data/ao-state
chown -R ao:ao /data/ao-home /data/worktrees /data/ao-state 2>/dev/null || true

# Git config
git config --global --add safe.directory '*'
git config --global user.name "YClaw AO"
git config --global user.email "ao@yclaw.ai"

# GitHub auth
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

# Clone bootstrap repos. YCLAW_REPOS accepts comma or whitespace separated
# owner/repo slugs so installs can add external projects without editing AO.
BOOTSTRAP_REPOS="${YCLAW_REPOS:-YClawAI/YClaw}"
BOOTSTRAP_REPOS="${BOOTSTRAP_REPOS//,/ }"
for repo in $BOOTSTRAP_REPOS; do
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "[ao-entrypoint] WARN: skipping invalid repo slug: $repo"
    continue
  fi
  slug=$(echo "$repo" | sed 's#/#__#g')
  if [ ! -d "/data/worktrees/$slug/.git" ]; then
    echo "[ao-entrypoint] Cloning $repo..."
    git clone --depth 50 "https://github.com/${repo}.git" "/data/worktrees/$slug" 2>&1 || echo "[ao-entrypoint] WARN: clone failed for $repo"
  fi
done
chown -R ao:ao /data/worktrees 2>/dev/null || true

# Overlay runtime files from repo (catches modules not yet in Docker image)
AO_SRC="/data/worktrees/YClawAI__YClaw/ao"
if [ -d "$AO_SRC" ]; then
  echo "[ao-entrypoint] Overlaying runtime files from repo..."
  cp "$AO_SRC"/*.mjs /app/ 2>/dev/null && echo "[ao-entrypoint]   -> .mjs modules"
  cp "$AO_SRC"/agent-orchestrator.yaml /app/ 2>/dev/null && echo "[ao-entrypoint]   -> agent-orchestrator.yaml"
fi

# Export secrets
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
export OPENAI_API_KEY="${OPENAI_API_KEY}"
export REDIS_URL="${REDIS_URL:-}"
export CI="true"
export AO_CONFIG_PATH=/app/agent-orchestrator.yaml
export AO_CALLBACK_URL="${AO_CALLBACK_URL:-https://agents.yclaw.ai/api/ao/callback}"

# Set up AO home
export HOME=/data/ao-home
export AO_HOME=/data/ao-home
mkdir -p /data/ao-home/.claude
chown -R ao:ao /data/ao-home 2>/dev/null || true

# Accept Claude TOS if needed
if [ -n "$CLAUDE_ACCEPT_TOS" ]; then
  echo "[ao-entrypoint] Accepting Claude TOS..."
  gosu ao claude --version 2>/dev/null || true
fi

# Start bridge server
echo "[ao-entrypoint] Starting AO bridge server on :8420..."
gosu ao node /app/ao-bridge-server.mjs &
AO_BRIDGE_PID=$!
sleep 2

if ! kill -0 $AO_BRIDGE_PID 2>/dev/null; then
  echo "[ao-entrypoint] FATAL: Bridge failed to start"
  exit 1
fi
echo "[ao-entrypoint] Bridge server RUNNING (PID $AO_BRIDGE_PID)"

# Start AO daemon
AO_PROJ="${YCLAW_AO_PROJECT:-${AO_PROJECT:-yclaw}}"
echo "[ao-entrypoint] Starting AO daemon (project: $AO_PROJ)..."
gosu ao ao start "$AO_PROJ" &
AO_PID=$!
sleep 1

if kill -0 $AO_PID 2>/dev/null; then
  echo "[ao-entrypoint] AO daemon RUNNING (PID $AO_PID)"
else
  echo "[ao-entrypoint] WARN: AO daemon exited immediately (no pending tasks)"
fi

# Keep alive: restart AO daemon if it exits, container dies only if bridge dies
while true; do
  wait -n $AO_BRIDGE_PID $AO_PID 2>/dev/null || true

  if ! kill -0 $AO_BRIDGE_PID 2>/dev/null; then
    echo "[ao-entrypoint] Bridge server died. Shutting down..."
    exit 1
  fi

  if ! kill -0 $AO_PID 2>/dev/null; then
    echo "[ao-entrypoint] AO daemon exited. Restarting in 5s..."
    sleep 5
    gosu ao ao start "$AO_PROJ" &
    AO_PID=$!
    echo "[ao-entrypoint] AO daemon restarted (PID $AO_PID)"
  fi
done
