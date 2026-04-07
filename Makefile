# YClaw Agents — Self-Wire Convenience Targets
# Usage: make self-wire-github

MC_URL ?= http://localhost:3001

.PHONY: self-wire-github self-wire-slack self-wire-openai self-wire-anthropic recipe-validate recipe-list help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Recipe Management ────────────────────────────────────────────────────────

recipe-validate: ## Validate all integration recipes
	npm run recipe:validate --workspace=packages/core

recipe-list: ## List all available integration recipes
	npm run recipe:list --workspace=packages/core

recipe-test: ## Dry-run test a recipe (usage: make recipe-test ID=github)
	npm run recipe:test --workspace=packages/core -- $(ID) --dry-run

# ── Self-Wire Helper ─────────────────────────────────────────────────────────
# Credentials are read via stdin and passed through a temp file (not CLI args)
# to avoid exposing them to process inspection.

define wire_integration
	@echo ""; \
	sid=$$(curl -sf -X POST $(MC_URL)/api/connections \
	  -H "Content-Type: application/json" \
	  -d '{"integration": "$(1)"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])") || \
	  { echo "Failed to create session. Is Mission Control running at $(MC_URL)?"; exit 1; }; \
	curl -sf -X POST $(MC_URL)/api/connections/$$sid/start > /dev/null 2>&1 || true; \
	tmpfile=$$(mktemp); \
	trap "rm -f $$tmpfile" EXIT; \
	echo "$$CRED_JSON" > "$$tmpfile"; \
	curl -sf -X POST $(MC_URL)/api/connections/$$sid/credentials \
	  -H "Content-Type: application/json" \
	  -d @"$$tmpfile" > /dev/null || \
	  { echo "Failed to store credentials."; rm -f "$$tmpfile"; exit 1; }; \
	rm -f "$$tmpfile"; \
	result=$$(curl -sf -X POST $(MC_URL)/api/connections/$$sid/verify); \
	status=$$(echo "$$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null); \
	ok=$$(echo "$$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','false'))" 2>/dev/null); \
	if [ "$$ok" != "True" ] && [ "$$ok" != "true" ]; then \
	  err=$$(echo "$$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','unknown'))" 2>/dev/null); \
	  echo "Verification failed: $$err"; exit 1; \
	fi; \
	if [ "$$status" = "connected" ]; then \
	  echo "$(2) connected!"; \
	elif [ "$$status" = "verifying" ]; then \
	  echo "$(2) credentials verified. Remaining steps (e.g., repo discovery) are pending."; \
	  echo "Visit $(MC_URL)/settings to monitor progress."; \
	else \
	  echo "$(2) status: $$status"; \
	fi
endef

# ── Self-Wire Integrations ──────────────────────────────────────────────────

self-wire-openai: ## Connect OpenAI (prompts for API key)
	@echo "=== OpenAI Self-Wire ==="
	@echo "Get an API key at: https://platform.openai.com/api-keys"
	@read -sp "OpenAI API Key: " token && echo "" && \
	CRED_JSON="{\"fields\":{\"api_key\":\"$$token\"}}" && \
	export CRED_JSON && \
	$(call wire_integration,openai,OpenAI)

self-wire-anthropic: ## Connect Anthropic (prompts for API key)
	@echo "=== Anthropic Self-Wire ==="
	@echo "Get an API key at: https://console.anthropic.com/settings/keys"
	@read -sp "Anthropic API Key: " token && echo "" && \
	CRED_JSON="{\"fields\":{\"api_key\":\"$$token\"}}" && \
	export CRED_JSON && \
	$(call wire_integration,anthropic,Anthropic)

self-wire-github: ## Connect GitHub (prompts for PAT)
	@echo "=== GitHub Self-Wire ==="
	@echo "Create a fine-grained PAT at: https://github.com/settings/tokens?type=beta"
	@echo "Required scopes: repo (read/write), workflow, admin:org (read)"
	@read -sp "GitHub Personal Access Token: " token && echo "" && \
	CRED_JSON="{\"fields\":{\"token\":\"$$token\"}}" && \
	export CRED_JSON && \
	$(call wire_integration,github,GitHub)

self-wire-slack: ## Connect Slack (prompts for bot token + app token)
	@echo "=== Slack Self-Wire ==="
	@echo "Create a Slack app at: https://api.slack.com/apps"
	@echo "Required scopes: chat:write, channels:read, users:read"
	@read -sp "Slack Bot Token (xoxb-...): " bot && echo "" && \
	read -sp "Slack App-Level Token (xapp-...): " app && echo "" && \
	CRED_JSON="{\"fields\":{\"bot_token\":\"$$bot\",\"app_token\":\"$$app\"}}" && \
	export CRED_JSON && \
	$(call wire_integration,slack,Slack)
