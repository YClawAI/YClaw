# Contributing Integration Recipes

This guide covers how to add new integration recipes to yclaw. Recipes define how the system connects to external services — from simple API key paste (Tier 1) to full code generation (Tier 3).

## Quick Start: Add a Tier 1 Integration in 15 Minutes

1. Create `packages/core/src/integrations/recipes/YOUR_SERVICE.recipe.yaml`
2. Define credential fields and a verify endpoint
3. Run `npm run recipe:validate` to check your recipe
4. Open a PR

### Minimal Tier 1 Recipe

```yaml
integration: acme-api
name: Acme API
tier: 1
credential_fields:
  - key: api_key
    label: API Key
    type: password
    placeholder: acme_...
    help_url: https://acme.com/settings/api-keys
verify:
  method: GET
  url: https://api.acme.com/v1/me
  auth_style: bearer
steps:
  - id: credentials
    actor: human
    label: Enter API key
  - id: store
    actor: system
    label: Store credentials
  - id: verify
    actor: system
    label: Verify connection
```

## Tier Classification

| Tier | When to Use | Actors Involved | Examples |
|------|-------------|-----------------|----------|
| **1 — Simple** | Paste an API key, auto-verify with a GET | `human` + `system` | Any API key entry |
| **2 — Guided** | OAuth or guided PAT flow, multi-step setup | `openclaw` + `system` | Slack, Figma, GitHub |
| **3 — Full Wiring** | Self-wiring pipeline, webhook handlers, event routing | `openclaw` + `fleet` + `system` | OpenClaw → Strategist → Builder → Deployer |

**Rule of thumb:** If the user just needs to paste a key → Tier 1. If they need guidance creating tokens/apps → Tier 2. If code changes are needed → Tier 3.

## Recipe Schema Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `integration` | string | Yes | Unique ID (lowercase, hyphens OK). Must match filename. |
| `name` | string | Yes | Display name |
| `description` | string | No | Shown in the connect wizard |
| `tier` | 1\|2\|3 | Yes | Complexity classification |
| `credential_fields` | array | Yes | At least one credential field |
| `verify` | object | No | How to verify the connection works |
| `steps` | array | Yes | Ordered list of setup steps |

### Credential Fields

```yaml
credential_fields:
  - key: api_key          # Internal key (used in storage)
    label: API Key        # Display label
    type: password        # text | password | oauth
    placeholder: sk-...   # Input placeholder
    help_url: https://... # Link to get a key
    help_text: "..."      # Inline help text
    optional: true        # If true, can be left blank
```

### Verify Block

```yaml
verify:
  method: GET             # GET | POST | HEAD
  url: https://api.example.com/v1/me
  auth_style: bearer      # bearer | x-api-key | custom-header | query-param
  auth_header: X-Custom   # Only for custom-header auth_style
  headers:                # Extra headers
    Content-Type: application/json
  body: '{"query":"..."}'  # POST body (e.g., GraphQL)
  expect_status: 200      # Expected HTTP status (default: any 2xx)
```

### Steps

```yaml
steps:
  - id: guide             # Unique step ID
    actor: openclaw       # human | system | openclaw | fleet
    label: Guide setup    # Display label
    type: code_task       # Optional: 'code_task' for fleet steps
    instructions: |       # Instructions for openclaw actor
      Walk the user through creating an API token...
    builder_task:         # Only for fleet + code_task steps
      description: |
        Create a webhook handler...
      files_to_create:
        - src/webhooks/acme-webhook.ts
      files_to_modify:
        - src/webhooks/index.ts
```

### Step Actor Types

| Actor | Who/What | Used For |
|-------|----------|----------|
| `human` | The user | Manual credential entry |
| `system` | The platform | Storing, verifying, smoke testing |
| `openclaw` | OpenClaw AI assistant | Guiding users through setup |
| `fleet` | Builder/Deployer agents | Code generation, deployment |

## Validation

### CLI Commands

```bash
# Validate all recipes
npm run recipe:validate

# Validate a specific file
npm run recipe:validate -- path/to/my.recipe.yaml

# List all available recipes with tier info
npm run recipe:list

# Dry-run test a recipe flow
npm run recipe:test -- acme-api --dry-run
```

### What the Validator Checks

1. **Schema compliance** — all required fields present and correctly typed
2. **Tier consistency** — declared tier matches step actors (openclaw → Tier 2+, fleet/code_task → Tier 3)
3. **Step ID uniqueness** — no duplicate step IDs
4. **Cross-file uniqueness** — no two recipes share an integration ID
5. **Verify block consistency** — header placeholders reference defined credential fields
6. **Filename matching** — filename should match `{integration}.recipe.yaml`

## Testing Locally

1. Add your recipe YAML file
2. Run `npm run recipe:validate` — must pass
3. Run `npm run build` in packages/core — recipes are copied to dist/
4. Start Mission Control locally — your integration appears in Settings
5. Click "Connect" and walk through the flow

## PR Template

When submitting a new integration recipe:

```markdown
## New Integration: {Name}

**Tier:** {1|2|3}
**Provider:** {link to provider docs}
**Verify endpoint:** {the API endpoint used to verify credentials}

### Checklist
- [ ] `npm run recipe:validate` passes
- [ ] `npm run build` passes
- [ ] Filename matches integration ID: `{id}.recipe.yaml`
- [ ] Credential field help_url points to the right page
- [ ] Verify endpoint returns 2xx with valid credentials
- [ ] Tier classification matches step complexity
```

## Secret Backend

Credentials are stored using the pluggable `SecretBackend` interface. Configure via the `SECRET_BACKEND` environment variable:

| Backend | `SECRET_BACKEND` value | Encryption | Use Case |
|---------|------------------------|------------|----------|
| MongoDB | `mongodb` (default) | AES-256-GCM | Production — encrypted at rest |
| Encrypted File | `file` | AES-256-GCM | Self-hosted deployments (`data/secrets/`) |
| Environment Variables | `env` | None (plaintext) | Local development only (`.env.integrations`) |

```bash
SECRET_BACKEND=mongodb   # MongoDB (default, AES-256-GCM encrypted at rest)
SECRET_BACKEND=file      # Encrypted JSON files in data/secrets/
SECRET_BACKEND=env       # Environment variables in .env.integrations
```

All backends except `env` require `INTEGRATION_SECRET_KEY` (64-char hex string) for encryption. The `env` backend stores in plaintext and should only be used for local development.

## Makefile Targets

```bash
make self-wire-github     # Connect GitHub via self-wiring pipeline
make self-wire-openai     # Connect OpenAI
make self-wire-anthropic  # Connect Anthropic
make self-wire-slack      # Connect Slack
```
