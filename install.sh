#!/usr/bin/env bash
set -Eeuo pipefail

YCLAW_REPO="${YCLAW_REPO:-https://github.com/YClawAI/YClaw.git}"
YCLAW_BRANCH="${YCLAW_BRANCH:-main}"
YCLAW_DIR="${YCLAW_DIR:-$HOME/yclaw}"
YCLAW_PRESET="${YCLAW_PRESET:-local-demo}"

NON_INTERACTIVE=0
YES=0
NO_DEPLOY=0
FORCE_INIT=0

usage() {
  cat <<'USAGE'
YCLAW one-line installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/YClawAI/YClaw/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/YClawAI/YClaw/main/install.sh | bash -s -- --preset local-demo --non-interactive

Options:
  --dir <path>            Install directory (default: ~/yclaw)
  --repo <url>            Git repository URL
  --branch <name>         Git branch (default: main)
  --preset <name>         local-demo, small-team, or aws-production
  --non-interactive       Run yclaw init without prompts
  --yes                   Deploy automatically after doctor passes
  --no-deploy             Stop after doctor passes
  --force                 Pass --force to yclaw init
  -h, --help              Show help
USAGE
}

log() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      YCLAW_DIR="${2:-}"
      shift 2
      ;;
    --repo)
      YCLAW_REPO="${2:-}"
      shift 2
      ;;
    --branch)
      YCLAW_BRANCH="${2:-}"
      shift 2
      ;;
    --preset)
      YCLAW_PRESET="${2:-}"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --yes|-y)
      YES=1
      shift
      ;;
    --no-deploy)
      NO_DEPLOY=1
      shift
      ;;
    --force)
      FORCE_INIT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required. Install it, then rerun this installer."
}

node_major() {
  node -p "Number(process.versions.node.split('.')[0])"
}

run_tty() {
  if [[ -r /dev/tty ]]; then
    "$@" </dev/tty
  else
    "$@"
  fi
}

prompt_yes_no() {
  local prompt="$1"
  local answer=""
  if [[ ! -r /dev/tty ]]; then
    return 1
  fi
  printf '%s [y/N] ' "$prompt" >/dev/tty
  IFS= read -r answer </dev/tty || true
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

ensure_prerequisites() {
  log "Checking prerequisites"
  require_cmd git
  require_cmd node
  require_cmd npm

  local major
  major="$(node_major)"
  [[ "$major" -ge 20 ]] || die "Node.js 20+ is required. Current major version: $major"

  if command -v docker >/dev/null 2>&1; then
    docker compose version >/dev/null 2>&1 || warn "Docker Compose v2 was not detected. yclaw doctor will fail for Docker installs until this is fixed."
  else
    warn "Docker was not detected. yclaw doctor will fail for Docker Compose installs until Docker is installed and running."
  fi
}

ensure_checkout() {
  log "Preparing YCLAW checkout at $YCLAW_DIR"
  if [[ -d "$YCLAW_DIR/.git" ]]; then
    cd "$YCLAW_DIR"
    if [[ -n "$(git status --porcelain)" ]]; then
      die "$YCLAW_DIR has local changes. Commit/stash them or choose another --dir."
    fi
    git fetch origin
    git checkout "$YCLAW_BRANCH"
    git pull --ff-only origin "$YCLAW_BRANCH"
  elif [[ -e "$YCLAW_DIR" ]]; then
    die "$YCLAW_DIR already exists and is not a git checkout. Choose another --dir."
  else
    mkdir -p "$(dirname "$YCLAW_DIR")"
    git clone --branch "$YCLAW_BRANCH" "$YCLAW_REPO" "$YCLAW_DIR"
    cd "$YCLAW_DIR"
  fi
}

build_cli() {
  log "Installing dependencies"
  npm ci

  log "Building installer CLI"
  npm run build --workspace=packages/cli
}

run_init() {
  log "Generating YCLAW configuration"
  local args=()
  [[ "$NON_INTERACTIVE" -eq 1 ]] && args+=(--non-interactive)
  [[ "$FORCE_INIT" -eq 1 ]] && args+=(--force)

  if [[ "$NON_INTERACTIVE" -eq 0 && ! -r /dev/tty ]]; then
    die "Interactive init needs a terminal. Rerun with --non-interactive or run this installer from a real shell."
  fi

  run_tty npx --no-install yclaw init --preset "$YCLAW_PRESET" "${args[@]}"
}

print_env_guidance() {
  cat <<'GUIDANCE'

Before deployment, .env must contain real values for:
  - one LLM key: ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY
  - GITHUB_OWNER and GITHUB_REPO for the default managed repo
  - YCLAW_REPOS for every repo AO should manage initially
  - GitHub App credentials: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID
    or GITHUB_TOKEN for local-only testing
  - GITHUB_WEBHOOK_SECRET, also configured on the GitHub App webhook

The installer will run doctor now. doctor must pass before deployment.
GUIDANCE
}

run_doctor() {
  log "Running health preflight"
  npx --no-install yclaw doctor
}

deploy() {
  log "Deploying YCLAW"
  npx --no-install yclaw deploy --detach --bootstrap-output-file ./yclaw-root-bootstrap.json </dev/null
  npx --no-install yclaw status || true
}

main() {
  ensure_prerequisites
  ensure_checkout
  build_cli
  run_init
  print_env_guidance

  if ! run_doctor; then
    cat <<EOF

YCLAW was initialized but not deployed because doctor failed.

Fix .env, then run:
  cd "$YCLAW_DIR"
  npx --no-install yclaw doctor
  npx --no-install yclaw deploy --detach --bootstrap-output-file ./yclaw-root-bootstrap.json
EOF
    exit 1
  fi

  if [[ "$NO_DEPLOY" -eq 1 ]]; then
    log "doctor passed. Deployment skipped because --no-deploy was set."
    exit 0
  fi

  if [[ "$YES" -eq 1 ]] || prompt_yes_no "doctor passed. Deploy now?"; then
    deploy
  else
    cat <<EOF

doctor passed. Deploy when ready:
  cd "$YCLAW_DIR"
  npx --no-install yclaw deploy --detach --bootstrap-output-file ./yclaw-root-bootstrap.json
EOF
  fi
}

main "$@"
