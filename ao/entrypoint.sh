#!/bin/bash
# YClaw Agent Orchestrator entrypoint
# Root-level setup runs first, then drops to 'ao' user via gosu.
set -e

echo "[ao-entrypoint] Starting YClaw Agent Orchestrator..."

repo_slug() {
  echo "$1" | sed 's#/#__#g'
}

# Never allow git to block startup on an interactive credential prompt.
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never

# --- EBS volume permissions from previous deployments ---
chown -R ao:ao /data 2>/dev/null || true
chmod -R u+rwX /data 2>/dev/null || true

# --- Persistent home on EBS ---
export AO_HOME=/data/ao-home
mkdir -p /data/worktrees /data/repos "$AO_HOME/.claude" "$AO_HOME/.config/gh" "$AO_HOME/.pi" "$AO_HOME/.ao-monitor"
chown -R ao:ao "$AO_HOME"

# --- Mark ALL directories as safe for git ---
git config --global --add safe.directory '*'

# --- SIGTERM handler: graceful shutdown ---
BRIDGE_PID=""
cleanup() {
  echo "[ao-entrypoint] SIGTERM received — shutting down gracefully..."

  if [ -n "$BRIDGE_PID" ]; then
    echo "[ao-entrypoint] Stopping ao-bridge (PID $BRIDGE_PID)..."
    kill "$BRIDGE_PID" 2>/dev/null || true
  fi

  echo "[ao-entrypoint] Stopping ao..."
  gosu ao ao stop 2>/dev/null || ao stop 2>/dev/null || true

  echo "[ao-entrypoint] Shutdown complete."
  exit 0
}
trap cleanup SIGTERM SIGINT

# --- Git Config ---
# Configure these for your organization
git config --global user.name "YClaw Agent Orchestrator"
git config --global user.email "agents@example.com"
git config --global init.defaultBranch main

# --- Legacy token cache cleanup ---
rm -f /tmp/github-app-token.json 2>/dev/null || true

# --- GitHub App Authentication ---
if [ -n "$GITHUB_APP_PRIVATE_KEY" ] && [ -n "$GITHUB_APP_ID" ] && [ -n "$GITHUB_APP_INSTALLATION_ID" ]; then
  echo "[ao-entrypoint] Configuring GitHub App dynamic credential helper..."

  cat > /app/git-credential-helper.sh << 'CRED_EOF'
#!/bin/bash
OPERATION="$1"
if [ "$OPERATION" != "get" ]; then
  exit 0
fi
TOKEN=$(node /app/token-manager.mjs get-token 2>/dev/null)
if [ -n "$TOKEN" ]; then
  echo "protocol=https"
  echo "host=github.com"
  echo "username=x-access-token"
  echo "password=${TOKEN}"
  echo ""
fi
CRED_EOF
  chmod +x /app/git-credential-helper.sh
  git config --global credential.helper "/app/git-credential-helper.sh"

  INITIAL_TOKEN=$(node /app/token-manager.mjs get-token)
  echo "$INITIAL_TOKEN" | gh auth login --with-token
  export GH_TOKEN="$INITIAL_TOKEN"

  echo "[ao-entrypoint] GitHub App auth configured (dynamic credential helper)"
else
  echo "[ao-entrypoint] WARNING: Missing one or more GitHub App env vars"
  if [ -n "$GITHUB_TOKEN" ]; then
    export GH_TOKEN="$GITHUB_TOKEN"
    echo "$GITHUB_TOKEN" | gh auth login --with-token
    git config --global credential.helper '!f() { test "$1" = get || exit 0; echo "password=$GITHUB_TOKEN"; }; f'
  fi
fi

# --- Worktree cleanup (recover from previous crash/restart) ---
echo "[ao-entrypoint] Cleaning up stale worktrees from previous runs..."
for repo_dir in /data/worktrees/*/; do
  if [ -d "$repo_dir/.git" ]; then
    if [ -f "$repo_dir/.git/shallow" ]; then
      cd "$repo_dir" && git fetch --unshallow || true
      cd /app
    fi
    cd "$repo_dir"
    git worktree prune 2>/dev/null || true
    find . -name "*.lock" -delete 2>/dev/null || true
    cd /app
  fi
done
rm -rf /data/ao-state/*/sessions/* 2>/dev/null || true

# Clean AO's own worktree path (separate from /data/worktrees)
for repo_dir in /data/ao-home/.worktrees/*/; do
  if [ -d "$repo_dir" ]; then
    for wt in "$repo_dir"*/; do
      [ -d "$wt" ] && rm -rf "$wt" && echo "[ao-entrypoint] Removed stale AO worktree: $wt"
    done
  fi
done
# Prune from repos that AO clones into
for repo_dir in /data/repos/*/; do
  [ -d "$repo_dir/.git" ] && cd "$repo_dir" && git worktree prune 2>/dev/null || true
done
cd /app
echo "[ao-entrypoint] Worktree cleanup complete."

# --- AO config path (so spawned processes find config from any cwd) ---
export AO_CONFIG_PATH=/app/agent-orchestrator.yaml
echo "[ao-entrypoint] AO config path: $AO_CONFIG_PATH"

# --- Update ao config with runtime values ---
export AO_AUTH_TOKEN="${AO_AUTH_TOKEN:-}"
envsubst '${AO_AUTH_TOKEN}' < /app/agent-orchestrator.yaml > /tmp/ao-config-rendered.yaml
cp /tmp/ao-config-rendered.yaml /app/agent-orchestrator.yaml
rm -f /tmp/ao-config-rendered.yaml

# --- Clone project repos into workspace (first run only) ---
# Configure YCLAW_REPOS as a space-separated list of repos to clone, e.g.:
#   YCLAW_REPOS="your-org/project-a your-org/project-b"
# If not set, the entrypoint skips repo cloning (configure in agent-orchestrator.yaml instead).
if [ -n "$YCLAW_REPOS" ]; then
  for repo in $YCLAW_REPOS; do
    repo_name=$(echo "$repo" | cut -d'/' -f2)
    repo_slug_name=$(repo_slug "$repo")
    repo_url="https://github.com/${repo}.git"
    if [ -d "/data/worktrees/${repo_slug_name}" ]; then
      if ! git -C "/data/worktrees/${repo_slug_name}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "[ao-entrypoint] WARNING: /data/worktrees/${repo_slug_name} exists but is not a valid git repo — removing corrupt clone"
        rm -rf "/data/worktrees/${repo_slug_name}"
      fi
    fi
    if [ ! -d "/data/worktrees/${repo_slug_name}/.git" ]; then
      echo "[ao-entrypoint] Cloning ${repo} (shallow)..."
      if ! git clone --depth 50 "$repo_url" "/data/worktrees/${repo_slug_name}"; then
        echo "[ao-entrypoint] FATAL: git clone failed for ${repo}" >&2
        exit 1
      fi
    else
      echo "[ao-entrypoint] ${repo_name} already cloned, syncing to remote default branch..."
      cd "/data/worktrees/${repo_slug_name}"
      ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")
      if printf '%s\n' "$ORIGIN_URL" | grep -Eq '^git@github\.com:|^ssh://git@github\.com/'; then
        echo "[ao-entrypoint] Rewriting ${repo_name} origin from SSH to HTTPS..."
        git remote set-url origin "$repo_url"
      fi
      DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep "HEAD branch" | awk '{print $NF}' || echo "")
      if [ -z "$DEFAULT_BRANCH" ]; then
        DEFAULT_BRANCH=$(git config init.defaultBranch || echo "main")
      fi

      if ! git fetch origin "$DEFAULT_BRANCH" --prune; then
        echo "[ao-entrypoint] FATAL: 'git fetch origin ${DEFAULT_BRANCH} --prune' failed for ${repo_name} — aborting startup to prevent running against a stale mirror." >&2
        exit 1
      fi
      if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        echo "[ao-entrypoint] ${repo_name} mirror had local changes — resetting to origin/${DEFAULT_BRANCH}"
      fi
      if ! git checkout "$DEFAULT_BRANCH" 2>/dev/null && ! git checkout -b "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH" 2>/dev/null; then
        echo "[ao-entrypoint] FATAL: could not checkout branch '${DEFAULT_BRANCH}' in ${repo_name} — aborting startup." >&2
        exit 1
      fi
      if ! git reset --hard "origin/$DEFAULT_BRANCH"; then
        echo "[ao-entrypoint] FATAL: 'git reset --hard origin/${DEFAULT_BRANCH}' failed for ${repo_name} — aborting startup." >&2
        exit 1
      fi
      if ! git clean -ffd; then
        echo "[ao-entrypoint] FATAL: 'git clean -ffd' failed for ${repo_name} — aborting startup." >&2
        exit 1
      fi
      cd /app
    fi
  done
fi

# --- Validate static repo path contracts before booting AO ---
VALIDATION_WARNINGS=0
if [ -n "$YCLAW_REPOS" ]; then
  for repo in $YCLAW_REPOS; do
    expected="/data/worktrees/$(repo_slug "$repo")"
    yaml_path=$(grep -A5 "repo: ${repo}" /app/agent-orchestrator.yaml | grep 'path:' | awk '{print $2}' | head -1)
    if [ -n "$yaml_path" ] && [ "$yaml_path" != "$expected" ]; then
      echo "[ao-entrypoint] WARN: project ${repo} expected path ${expected}, YAML has ${yaml_path}" >&2
      VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
      continue
    fi
    if [ ! -d "$expected" ]; then
      mkdir -p "$expected"
      echo "[ao-entrypoint] WARN: auto-reconciled missing repo directory ${expected} for ${repo}" >&2
      VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
    fi
    if [ ! -d "$expected/.git" ]; then
      echo "[ao-entrypoint] WARN: mirror not yet present at ${expected} for ${repo} — will be cloned on first request" >&2
      VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
    fi
  done
fi
if [ "$VALIDATION_WARNINGS" -gt 0 ]; then
  echo "[ao-entrypoint] Repo path contract validation: ${VALIDATION_WARNINGS} warning(s), continuing startup."
else
  echo "[ao-entrypoint] Static repo path contract validation passed."
fi

# --- Overlay AO runtime files from the freshly-pulled repo ---
# The Docker image bakes ao/*.mjs at build time. If the repo has newer
# versions (e.g. hotfixes pushed without an image rebuild), copy them
# into /app so the bridge runs the latest code.
# Configure YCLAW_AO_OVERLAY_REPO to enable this feature.
if [ -n "$YCLAW_AO_OVERLAY_REPO" ]; then
  AO_SRC="/data/worktrees/$(repo_slug "$YCLAW_AO_OVERLAY_REPO")/ao"
  if [ -d "$AO_SRC" ]; then
    for f in ao-bridge-server.mjs queue-store.mjs token-manager.mjs runtime-process.mjs agent-orchestrator.yaml; do
      if [ -f "$AO_SRC/$f" ]; then
        cp "$AO_SRC/$f" "/app/$f"
      fi
    done
    echo "[ao-entrypoint] Overlaid AO runtime files from repo."
  fi
fi

# --- Fix ownership after root-context clone/sync/overlay ---
chown -R ao:ao /data/worktrees 2>/dev/null || true

# --- Drop privileges: run all services as non-root 'ao' user ---
echo "[ao-entrypoint] Dropping privileges to 'ao' user..."

# Copy root's git config and gh auth to ao persistent home
cp /root/.gitconfig "$AO_HOME/.gitconfig" 2>/dev/null || true
chown ao:ao "$AO_HOME/.gitconfig" 2>/dev/null || true

if [ -d /root/.config/gh ]; then
  cp -r /root/.config/gh/* "$AO_HOME/.config/gh/" 2>/dev/null || true
  chown -R ao:ao "$AO_HOME/.config/gh"
fi

# Preserve build-time Claude Code plugins/skills on first boot (each checked independently)
mkdir -p "$AO_HOME/.claude"
if [ ! -d "$AO_HOME/.claude/plugins" ] && [ -d "/home/ao/.claude/plugins" ]; then
  echo "[ao-entrypoint] Copying build-time Claude Code plugins to persistent home..."
  cp -a /home/ao/.claude/plugins "$AO_HOME/.claude/plugins"
fi
if [ ! -d "$AO_HOME/.claude/skills" ] && [ -d "/home/ao/.claude/skills" ]; then
  echo "[ao-entrypoint] Copying build-time Claude Code skills to persistent home..."
  cp -a /home/ao/.claude/skills "$AO_HOME/.claude/skills"
fi
if [ ! -f "$AO_HOME/.claude/settings.json" ] && [ -f "/home/ao/.claude/settings.json" ]; then
  cp /home/ao/.claude/settings.json "$AO_HOME/.claude/settings.json"
fi

# Symlink ao user's HOME directories to AO_HOME so Claude Code finds configs
mkdir -p /home/ao/.config
rm -rf /home/ao/.claude /home/ao/.config/gh 2>/dev/null || true
ln -sf "$AO_HOME/.claude" /home/ao/.claude
ln -sf "$AO_HOME/.config/gh" /home/ao/.config/gh
cp "$AO_HOME/.gitconfig" /home/ao/.gitconfig 2>/dev/null || true

chown -R ao:ao /app /home/ao 2>/dev/null || true

exec gosu ao /bin/bash -c '
  export HOME=/data/ao-home
  export PATH="/usr/local/bin:$PATH"
  export AO_CONFIG_PATH=/app/agent-orchestrator.yaml

  echo "[ao-entrypoint] Running as $(whoami), HOME=$HOME"

  # -- 1. Export env vars for subprocess runtime --
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
  export GH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
  export GITHUB_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
  export AO_AUTH_TOKEN="${AO_AUTH_TOKEN:-}"
  export CI="true"
  # REDIS_URL powers the AO queue store (ao-bridge dedup, job queue).
  export REDIS_URL="${REDIS_URL:-}"

  # -- Clean stale AO runtime state from the persistent home volume --
  AO_RUNTIME_DIR="$HOME/.agent-orchestrator"
  echo "[ao-entrypoint] Cleaning stale AO runtime state..."
  rm -f \
    "$AO_RUNTIME_DIR/running.json" \
    "$AO_RUNTIME_DIR/running.lock" \
    "$AO_RUNTIME_DIR"/*/lifecycle-worker.pid 2>/dev/null || true
  echo "[ao-entrypoint] Stale runtime state cleaned."

  # -- AWS credentials for infrastructure provisioning --
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

  # Ensure GH_TOKEN is fresh from the token manager
  FRESH_TOKEN=$(node /app/token-manager.mjs get-token 2>/dev/null || echo "$GH_TOKEN")
  export GH_TOKEN="$FRESH_TOKEN"
  export GITHUB_TOKEN="$FRESH_TOKEN"
  if [ -n "$FRESH_TOKEN" ]; then
    echo "$FRESH_TOKEN" | gh auth login --hostname github.com --with-token >/dev/null 2>&1 || true
    gh auth setup-git >/dev/null 2>&1 || true
  fi

  # -- 2. One-time Claude Code API key acceptance --
  if [ ! -f "$HOME/.claude/.ao-key-accepted" ]; then
    echo "[ao-entrypoint] First run: accepting Claude Code API key..."
    timeout 30 expect -c "
      set timeout 20
      spawn claude --version
      expect {
        -re {(?i)(allow|confirm|accept|yes|y/n|ANTHROPIC_API_KEY)} {
          send \"y\r\"
          exp_continue
        }
        eof
      }
    " 2>/dev/null || true
    timeout 15 claude --help >/dev/null 2>&1 || true
    touch "$HOME/.claude/.ao-key-accepted"
    echo "[ao-entrypoint] API key acceptance completed"
  fi

  # -- 3. Verify harnesses are available --
  echo "[ao-entrypoint] Harness check:"
  claude --version 2>/dev/null && echo "  ok Claude Code" || echo "  missing Claude Code"
  pi --version 2>/dev/null && echo "  ok Pi" || echo "  missing Pi"

  # -- 4. Start bridge server + AO daemon --
  echo "[ao-entrypoint] Starting AO Bridge Server on :8420..."
  node /app/ao-bridge-server.mjs &
  AO_BRIDGE_PID=$!
  sleep 1

  if kill -0 $AO_BRIDGE_PID 2>/dev/null; then
    echo "[ao-entrypoint] AO Bridge started (PID $AO_BRIDGE_PID)"
  else
    echo "[ao-entrypoint] ERROR: AO Bridge failed to start!"
    exit 1
  fi

  echo "[ao-entrypoint] Starting AO daemon..."
  export BROWSER=none
  unset DISPLAY

  # Configure YCLAW_AO_PROJECT to set which project ao starts with.
  # If multiple projects exist in agent-orchestrator.yaml and no project
  # is specified, ao start fails. Fail fast with a clear message.
  AO_PROJECT="${YCLAW_AO_PROJECT:-}"
  if [ -z "$AO_PROJECT" ]; then
    PROJECT_COUNT=$(awk "
      BEGIN { in_projects = 0; count = 0 }
      /^projects:[[:space:]]*$/ { in_projects = 1; next }
      in_projects && /^[^[:space:]]/ { in_projects = 0 }
      in_projects && /^  [^[:space:]#][^:]*:[[:space:]]*$/ { count++ }
      END { print count + 0 }
    " /app/agent-orchestrator.yaml 2>/dev/null || echo "0")
    if [ "$PROJECT_COUNT" -gt 1 ]; then
      echo "[ao-entrypoint] FATAL: Multiple projects configured but YCLAW_AO_PROJECT is not set." >&2
      echo "[ao-entrypoint] Set YCLAW_AO_PROJECT to one of the project names in agent-orchestrator.yaml." >&2
      exit 1
    fi
  fi

  if [ -n "$AO_PROJECT" ]; then
    echo "[ao-entrypoint] Starting AO daemon with project: $AO_PROJECT"
    ao start "$AO_PROJECT" &
  else
    ao start &
  fi
  AO_PID=$!

  # Wait for any child to exit — if ao dies, we exit (ECS restarts us)
  wait -n "$AO_PID" "$AO_BRIDGE_PID"
  echo "[ao-entrypoint] A child process exited. Shutting down..."
  exit 1
'
