FROM node:22-bookworm-slim

# --- tini: proper PID 1 init process ---
# Forwards signals (SIGTERM) to child processes, reaps zombie processes.
# Without this, ECS SIGTERM doesn't reach tmux/ao, and zombie processes accumulate.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    gosu \
    git \
    curl \
    tmux \
    jq \
    gettext-base \
    openssh-client \
    ca-certificates \
    expect \
    unzip \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (required by ao for PR creation, issue management)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*

# Python 3 — required by UI UX Pro Max design system generator (search.py)
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

# Coding harnesses
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @mariozechner/pi-coding-agent
RUN npm install -g @composio/ao@0.2.1

# Claude Code plugins — installed at build time for --bare mode
# 1. Add official Anthropic marketplace (superpowers lives here)
# 2. Add anthropics/claude-code repo marketplace (frontend-design lives here)
# 3. Install both plugins to user scope
RUN claude plugins marketplace add anthropics/claude-plugins-official \
    && claude plugins marketplace add anthropics/claude-code \
        --sparse .claude-plugin plugins \
    && claude plugins install superpowers@claude-plugins-official \
    && claude plugins install frontend-design@claude-code-plugins

# UI UX Pro Max — third-party design intelligence skill
# Installs to ~/.claude/skills/ via the uipro CLI
RUN npm install -g uipro-cli \
    && mkdir -p /root/.claude/skills \
    && cd /root && uipro init --ai claude

# Codex CLI: pre-PR code review gate (multi-model ensemble)
RUN npm install -g @openai/codex@0.118.0

# Infrastructure tools (Architect->AO infra provisioning)
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip" \
    && unzip /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip

# Terraform (IaC for idempotent infra provisioning)
RUN curl -fsSL https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip -o /tmp/terraform.zip \
    && unzip /tmp/terraform.zip -d /usr/local/bin/ \
    && rm /tmp/terraform.zip

# MongoDB: use Atlas REST API via curl (mongosh requires native build deps that bloat the image)

# RTK: Rust-based terminal output filter (github.com/rtk-ai/rtk)
# Reduces verbose command output (npm install, test suites, lint) flooding
# Claude's context window by 60-90%. Baked in as a static musl binary — no
# runtime deps. Raw output is retained by the CloudWatch log driver; RTK only
# filters what Claude sees. Set RTK_ENABLED=0 at container runtime to bypass.
ARG RTK_VERSION=0.37.1
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
      amd64) RTK_TARGET="x86_64-unknown-linux-musl" ;; \
      arm64) RTK_TARGET="aarch64-unknown-linux-gnu" ;; \
      *) echo "[rtk] Unsupported arch ${ARCH} — skipping RTK install"; exit 0 ;; \
    esac; \
    curl -fsSL \
      "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${RTK_TARGET}.tar.gz" \
      -o /tmp/rtk.tar.gz \
    && tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin/ rtk \
    && chmod +x /usr/local/bin/rtk \
    && rm /tmp/rtk.tar.gz

# RTK-wrapped bash: Claude Code uses SHELL env var to select the tool shell.
# Filters tool output through RTK before returning it as a tool result to Claude.
COPY rtk-bash /usr/local/bin/rtk-bash
RUN chmod +x /usr/local/bin/rtk-bash

# Non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash -u 999 ao

# Create workspace and persistent home directories
RUN mkdir -p /data/worktrees /data/ao-state /data/ao-home /data/logs /app \
    && chown -R ao:ao /data /app /home/ao

# Make Claude Code plugins/skills accessible to ao user
RUN mkdir -p /home/ao/.claude \
    && cp -r /root/.claude/plugins /home/ao/.claude/plugins 2>/dev/null || true \
    && cp -r /root/.claude/skills /home/ao/.claude/skills 2>/dev/null || true \
    && cp /root/.claude/settings.json /home/ao/.claude/settings.json 2>/dev/null || true \
    && chown -R ao:ao /home/ao/.claude

WORKDIR /app

# Copy application files
COPY package.json /app/package.json
RUN cd /app && npm install && chown -R ao:ao /app

COPY entrypoint.sh /app/entrypoint.sh
COPY *.mjs agent-orchestrator.yaml /app/
COPY prompts/ /app/prompts/
COPY adapters/ /app/adapters/
COPY register-plugins.sh /app/register-plugins.sh
RUN chmod +x /app/entrypoint.sh /app/register-plugins.sh && chown -R ao:ao /app

# Register custom AO plugins — creates npm package shims in ao's node_modules
# so the built-in plugin registry discovers them via the BUILTIN_PLUGINS list.
RUN /app/register-plugins.sh

EXPOSE 3001 8420

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
