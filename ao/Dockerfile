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

# Coding harnesses
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @mariozechner/pi-coding-agent
RUN npm install -g @composio/ao@0.2.1

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

# Non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash -u 999 ao

# Create workspace and persistent home directories
RUN mkdir -p /data/worktrees /data/ao-state /data/ao-home /data/logs /app \
    && chown -R ao:ao /data /app /home/ao

WORKDIR /app

# Copy application files
COPY package.json /app/package.json
RUN cd /app && npm install && chown -R ao:ao /app

COPY entrypoint.sh /app/entrypoint.sh
COPY ao-bridge-server.mjs queue-store.mjs spawn-followup.mjs token-manager.mjs review-gate.mjs agent-orchestrator.yaml /app/
COPY prompts/ /app/prompts/
COPY runtime-process.mjs /app/runtime-process.mjs
COPY adapters/ /app/adapters/
COPY register-plugins.sh /app/register-plugins.sh
RUN chmod +x /app/entrypoint.sh /app/register-plugins.sh && chown -R ao:ao /app

# Register custom AO plugins — creates npm package shims in ao's node_modules
# so the built-in plugin registry discovers them via the BUILTIN_PLUGINS list.
RUN /app/register-plugins.sh

EXPOSE 3001 8420

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
