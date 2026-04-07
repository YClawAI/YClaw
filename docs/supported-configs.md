# Supported Configurations

This document lists every configuration option available in `yclaw.config.yaml`, the backing adapter implementations, and their current status. Only options with actual adapter code in the repository are marked **Stable**. Options mentioned in code comments or schema placeholders are listed in the [Future](#future) section.

Configuration is defined by the Zod schemas in:

- `packages/core/src/infrastructure/config-schema.ts` -- core runtime (storage, secrets, channels)
- `packages/cli/src/schema/cli-config-schema.ts` -- CLI extensions (deployment, llm, networking, observability)

---

## Configuration Matrix

### Storage

| Component | Config Key | Type Value | Adapter | Default | Status |
|-----------|-----------|------------|---------|---------|--------|
| State Store | `storage.state.type` | `mongodb` | `MongoStateStore` | Yes | **Stable** |
| Event Bus | `storage.events.type` | `redis` | `RedisEventBus` | Yes | **Stable** |
| Memory | `storage.memory.type` | `postgresql` | `MemoryManager` (packages/memory) | Yes | **Stable** |
| Object Storage | `storage.objects.type` | `local` | `LocalFileStore` | Yes | **Stable** |
| Object Storage | `storage.objects.type` | `s3` | `S3ObjectStore` | No | **Stable** |

### Secrets

| Component | Config Key | Provider Value | Adapter | Default | Status |
|-----------|-----------|----------------|---------|---------|--------|
| Secrets | `secrets.provider` | `env` | `EnvSecretProvider` | Yes | **Stable** |
| Secrets | `secrets.provider` | `aws-secrets-manager` | `AwsSecretsProvider` | No | **Stable** |

### Channels

| Component | Config Key | Adapter | Status |
|-----------|-----------|---------|--------|
| Discord | `channels.discord` | `DiscordChannelAdapter` | **Stable** |
| Slack | `channels.slack` | `SlackChannelAdapter` | **Stable** |
| Telegram | `channels.telegram` | `TelegramChannelAdapter` | **Stable** |
| Twitter/X | `channels.twitter` | `TwitterChannelAdapter` | **Stable** |

All channel configs share the same shape: `{ enabled: boolean, config?: Record<string, unknown> }`. The `config` object passes adapter-specific settings (tokens, webhook URLs) through to `connect()`.

### LLM Providers

| Provider | Config Key | Adapter | Default | Status |
|----------|-----------|---------|---------|--------|
| Anthropic | `llm.defaultProvider: 'anthropic'` | `AnthropicProvider` | Yes | **Stable** |
| OpenAI | `llm.defaultProvider: 'openai'` | Routed via LiteLLM proxy | No | **Stable** |
| OpenRouter | `llm.defaultProvider: 'openrouter'` | `OpenRouterProvider` | No | **Stable** |

LLM provider configuration lives in the CLI config schema (`llm.defaultProvider`, `llm.defaultModel`). When a LiteLLM proxy URL is set (`LITELLM_PROXY_URL`), all providers route through it for unified cost tracking, with automatic fallback to the direct provider.

### Deployment

| Target | Config Key | Implementation | Status |
|--------|-----------|----------------|--------|
| Docker Compose | `deployment.target: 'docker-compose'` | `deploy/docker-compose/` | **Stable** |
| AWS Terraform | `deployment.target: 'terraform'` | `deploy/aws/` | **Stable** |
| Manual | `deployment.target: 'manual'` | No automation | **Stable** |

### Networking

| Setting | Config Key | Default | Status |
|---------|-----------|---------|--------|
| API Port | `networking.apiPort` | `3000` | **Stable** |

### Observability

| Setting | Config Key | Default | Status |
|---------|-----------|---------|--------|
| Log Level | `observability.logLevel` | `info` | **Stable** |

---

## Defaults

When no `yclaw.config.yaml` is present, the system uses these defaults (all resolved from environment variables):

```yaml
storage:
  state:
    type: mongodb          # URI from MONGODB_URI env var
  events:
    type: redis            # URL from REDIS_URL env var
  memory:
    type: postgresql       # URL from MEMORY_DATABASE_URL env var
  objects:
    type: local            # Path from YCLAW_OBJECT_STORE_PATH env var

secrets:
  provider: env            # Reads from process.env

channels: {}               # No channels enabled by default

llm:
  defaultProvider: anthropic
  defaultModel: claude-sonnet-4-20250514

networking:
  apiPort: 3000

observability:
  logLevel: info
```

---

## Future

The following items appear in code comments and schema placeholders but do not have adapter implementations yet.

### State Store

| Type | Source |
|------|--------|
| `postgresql` | Comment in `StateStoreConfigSchema` |
| `sqlite` | Comment in `StateStoreConfigSchema` |
| `dynamodb` | Comment in `StateStoreConfigSchema` |

### Event Bus

| Type | Source |
|------|--------|
| `nats` | Comment in `EventBusConfigSchema` |
| `sqs` | Comment in `EventBusConfigSchema` |
| `rabbitmq` | Comment in `EventBusConfigSchema` |

### Memory Store

| Type | Source |
|------|--------|
| `sqlite` | Comment in `MemoryStoreConfigSchema` and `IMemoryStore` doc comment |
| `dynamodb` | `IMemoryStore` doc comment (serverless use case) |

### Object Storage

| Type | Source |
|------|--------|
| `gcs` | Comment in `ObjectStoreConfigSchema` and `IObjectStore` doc comment |
| `azure-blob` | Comment in `ObjectStoreConfigSchema` and `IObjectStore` doc comment |

### Secrets

| Provider | Source |
|----------|--------|
| `gcp-sm` | Comment in `SecretsConfigSchema` and `ISecretProvider` doc comment |
| `vault` | Comment in `SecretsConfigSchema` and `ISecretProvider` doc comment |
| `doppler` | Comment in `SecretsConfigSchema` and `ISecretProvider` doc comment |

### LLM Providers

| Provider | Source |
|----------|--------|
| `ollama` | Referenced in `provider.ts` switch but throws "not yet implemented" |

### Deployment

| Target | Source |
|--------|--------|
| `kubernetes` | Not referenced in code; natural extension of existing patterns |
