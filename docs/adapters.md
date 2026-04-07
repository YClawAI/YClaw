# Adapter Architecture

Every infrastructure component in YClaw sits behind an interface. The runtime never talks directly to MongoDB, Redis, S3, or Discord -- it talks to `IStateStore`, `IEventBus`, `IObjectStore`, and `IChannel`. To add support for a new database, message broker, or communication platform, implement the corresponding interface and register it in the `InfrastructureFactory`.

All interfaces live in `packages/core/src/interfaces/`. All concrete adapters live in `packages/core/src/adapters/`.

---

## Interfaces

### IStateStore

**File:** `packages/core/src/interfaces/IStateStore.ts`

Primary document/state storage. Abstracts a collection-oriented store with typed CRUD operations and a provider-agnostic query language (comparison operators like `$lt`, `$in`, `$exists` that any backend can translate).

Key methods:

- `connect()` / `disconnect()` / `healthy()` -- lifecycle management
- `collection<T>(name)` -- returns a typed `ICollection<T>` handle
- `ICollection.findOne(filter)` / `find(filter, options)` -- query documents
- `ICollection.insertOne(doc)` / `updateOne(filter, update)` / `deleteMany(filter)` -- mutations
- `ICollection.createIndex(spec)` -- index creation for query optimization

Current adapter: `MongoStateStore` (`adapters/state/MongoStateStore.ts`).

### IEventBus

**File:** `packages/core/src/interfaces/IEventBus.ts`

Event transport layer combining three capabilities: pub/sub messaging, sorted-set queues (for escalation timers and scheduled work), and ephemeral key-value storage (for locks, dedup, and rate limiting).

Key methods:

- `connect()` / `disconnect()` / `healthy()` -- lifecycle management
- `publish(source, type, payload, correlationId?)` -- publish events
- `subscribe(pattern, handler)` / `unsubscribe(pattern, handler?)` -- pattern-based subscriptions (e.g., `forge:*`)
- `zadd(key, score, member)` / `zrangebyscore(key, min, max)` -- sorted set operations for priority queues
- `set(key, value, ttl?)` / `setnx(key, value, ttl?)` -- KV with optional TTL for distributed locks
- `hset(key, field, value)` / `hget(key, field)` -- hash operations

Current adapter: `RedisEventBus` (`adapters/events/RedisEventBus.ts`).

### IChannel

**File:** `packages/core/src/interfaces/IChannel.ts`

Communication channel abstraction for outbound messaging, inbound listening, reactions, threads, and file uploads. Each platform adapter declares which optional capabilities it supports via `supports*()` methods so callers can check before calling.

Key methods:

- `connect(config)` / `disconnect()` / `healthy()` -- lifecycle management
- `send(target, message)` -- send a message to a channel/user/thread
- `listen(handler)` -- register an inbound message handler (if `supportsInboundListening()` is true)
- `supportsReactions()` / `react?(target, emoji)` -- emoji reactions
- `supportsThreads()` / `createThread?(target, name)` -- threaded conversations
- `supportsFileUpload()` / `uploadFile?(target, file)` -- file attachments
- `supportsIdentityOverride()` -- post as a custom name/avatar

Current adapters: `SlackChannelAdapter`, `TelegramChannelAdapter`, `TwitterChannelAdapter`, `DiscordChannelAdapter` (all in `adapters/channels/`).

### ISecretProvider

**File:** `packages/core/src/interfaces/ISecretProvider.ts`

Read-only secrets provider for infrastructure bootstrap (database URLs, API keys, channel tokens). Separate from the agent-level `SecretBackend` which handles full CRUD for integration credentials.

Key methods:

- `get(key)` -- returns the secret value or null
- `getRequired(key)` -- returns the value or throws
- `has(key)` -- check existence
- `list()` -- list available keys (if the provider supports it)

Current adapters: `EnvSecretProvider`, `AwsSecretsProvider` (both in `adapters/secrets/`).

### IObjectStore

**File:** `packages/core/src/interfaces/IObjectStore.ts`

File and blob storage for agent-generated assets, vault files, and binary content that does not belong in the state store.

Key methods:

- `put(key, data, options?)` -- store an object
- `get(key)` -- retrieve by key (returns `Buffer | null`)
- `head(key)` -- get metadata without downloading
- `delete(key)` -- remove an object
- `list(prefix?, maxKeys?)` -- list objects by prefix
- `getSignedUrl(key, expiresInSeconds?)` -- pre-signed URL for direct access (returns null if unsupported)

Current adapters: `LocalFileStore`, `S3ObjectStore` (both in `adapters/storage/`).

### IMemoryStore

**File:** `packages/core/src/interfaces/IMemoryStore.ts`

Agent memory subsystem supporting three memory types: items (semantic memories with strength scores), knowledge triples (subject-predicate-object), and episodes (sequences of related events). Also provides per-agent working memory (transient, session-scoped).

Key methods:

- `connect()` / `disconnect()` / `healthy()` -- lifecycle management
- `store(item)` / `recall(id)` / `search(options)` -- memory items with semantic search
- `reinforce(id, strengthDelta)` / `forget(id)` -- memory strength management
- `storeTriple(triple)` / `queryTriples(query)` -- knowledge graph operations
- `recordEpisode(episode)` / `getRecentEpisodes(agentId, limit?)` -- episodic memory
- `getWorkingMemory(agentId)` / `setWorkingMemory(agentId, data)` -- transient session state

Current adapter: `MemoryManager` in `packages/memory/` (PostgreSQL-backed).

---

## How Adapters Are Registered

The `InfrastructureFactory` (`packages/core/src/infrastructure/InfrastructureFactory.ts`) reads `yclaw.config.yaml` (or falls back to environment variable defaults) and instantiates the correct adapter for each component.

The flow:

1. `InfrastructureFactory.loadConfig()` parses `yclaw.config.yaml` against the Zod schema in `config-schema.ts`. If no file exists, defaults are used (MongoDB, Redis, local filesystem, env secrets).
2. `InfrastructureFactory.create(config)` creates adapters in a specific order:
   - **Secrets provider first** -- so other factories can resolve credentials through it instead of reading env vars directly.
   - **State store, event bus, and object store in parallel** -- via `Promise.allSettled` for maximum startup speed.
   - **Channels last** -- iterates `config.channels`, dynamically imports the matching adapter, calls `connect()`, validates health, and only registers healthy adapters.
3. If any adapter fails to connect, all already-connected resources are cleaned up (disconnect called) before the error propagates.

The factory uses a `switch` statement per component type to select the adapter class via dynamic `import()`. Adding a new adapter means adding a new case to the relevant switch and a new entry to the Zod config schema.

---

## Example: Building a "Matrix" Channel Adapter

Here is a walkthrough of what it takes to add a hypothetical Matrix protocol adapter.

### 1. Create the adapter file

Create `packages/core/src/adapters/channels/MatrixChannelAdapter.ts`:

```typescript
import type {
  IChannel,
  ChannelConfig,
  ChannelTarget,
  ChannelMessage,
  MessageResult,
  MessageRef,
  ThreadRef,
  FileUpload,
  FileResult,
  InboundMessageHandler,
} from '../../interfaces/IChannel.js';

export class MatrixChannelAdapter implements IChannel {
  readonly name = 'matrix';
  private client: any = null;
  private connected = false;
  private readonly handlers: InboundMessageHandler[] = [];

  // ── Lifecycle ──────────────────────────────────────────────

  async connect(config: ChannelConfig): Promise<void> {
    const homeserverUrl = config.homeserverUrl as string;
    const accessToken = config.accessToken as string;
    // Initialize the Matrix SDK client, log in, start syncing.
    // Set this.connected = true when the sync loop is running.
  }

  async disconnect(): Promise<void> {
    // Stop the sync loop, release resources.
    this.connected = false;
  }

  async healthy(): Promise<boolean> {
    // Return true only when the sync loop is active and
    // the homeserver is reachable.
    return this.connected;
  }

  // ── Core Messaging ─────────────────────────────────────────

  async send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult> {
    // Map ChannelTarget.channelId to a Matrix room ID.
    // Map ChannelMessage.text to an m.room.message event.
    // Handle message.replyTo by setting m.relates_to.
    // Return { success: true, messageId: eventId }.
  }

  async listen(handler: InboundMessageHandler): Promise<void> {
    this.handlers.push(handler);
    // The sync loop (started in connect()) calls handlers
    // for each incoming m.room.message event.
  }

  // ── Capability Declarations ────────────────────────────────

  supportsInboundListening(): boolean { return true; }
  supportsReactions(): boolean { return true; }
  supportsThreads(): boolean { return true; }
  supportsFileUpload(): boolean { return true; }
  supportsIdentityOverride(): boolean { return false; }

  // ── Optional Capabilities ──────────────────────────────────

  async react(target: MessageRef, emoji: string): Promise<void> {
    // Send an m.reaction event in the target room.
  }

  async createThread(target: MessageRef, name: string): Promise<ThreadRef> {
    // Create a thread rooted at the target message using
    // MSC3440 threading (m.thread relation).
  }

  async uploadFile(target: ChannelTarget, file: FileUpload): Promise<FileResult> {
    // Upload to the Matrix content repository (mxc:// URI),
    // then send an m.room.message with msgtype m.file/m.image.
  }
}
```

Key points from the Discord reference implementation:

- **Dynamic imports** for optional peer dependencies: use `new Function('specifier', 'return import(specifier)')` to bypass TypeScript module resolution for SDKs that may not be installed.
- **Bot loop prevention**: skip messages from the bot's own user ID in the inbound listener.
- **Error containment**: every method catches exceptions and returns a `{ success: false, error }` result rather than throwing. Logging goes through `createLogger()`.
- **Capability methods return `boolean`**: the caller checks `supportsReactions()` before calling `react()`. If the platform does not support a feature, return `false` and omit the method implementation.

### 2. Register in InfrastructureFactory

Add a case to `createChannelAdapter()` in `packages/core/src/infrastructure/InfrastructureFactory.ts`:

```typescript
case 'matrix': {
  const { MatrixChannelAdapter } = await import('../adapters/channels/MatrixChannelAdapter.js');
  return new MatrixChannelAdapter();
}
```

### 3. Add config schema support

In `packages/core/src/infrastructure/config-schema.ts`, add `'matrix'` to the `ChannelsConfigSchema`:

```typescript
export const ChannelsConfigSchema = z.object({
  slack: ChannelConfigSchema.optional(),
  telegram: ChannelConfigSchema.optional(),
  twitter: ChannelConfigSchema.optional(),
  discord: ChannelConfigSchema.optional(),
  matrix: ChannelConfigSchema.optional(),   // <-- add this
}).catchall(ChannelConfigSchema);
```

### 4. Enable in yclaw.config.yaml

```yaml
channels:
  matrix:
    enabled: true
    config:
      homeserverUrl: "https://matrix.example.com"
      accessToken: "${MATRIX_ACCESS_TOKEN}"
```

The factory will dynamically import `MatrixChannelAdapter`, call `connect()`, verify `healthy()`, and register it. If `healthy()` returns false, the adapter is disconnected and skipped with a warning log.

---

## Testing

Adapters should pass the same behavioral tests regardless of backing technology. The principle: test the interface contract, not the implementation.

For each adapter category, write tests that exercise the interface methods through the public API. For example, an `IStateStore` conformance test would:

1. Call `connect()` and verify `healthy()` returns true.
2. Insert a document via `collection<T>(name).insertOne(doc)`.
3. Query it back with `findOne()` and verify the fields match.
4. Update with `updateOne()` and verify the mutation.
5. Delete with `deleteOne()` and verify `countDocuments()` decreases.
6. Call `disconnect()` and verify `healthy()` returns false.

The same test suite runs against `MongoStateStore` (with a real or containerized MongoDB) and any future adapter (PostgreSQL, SQLite). If it passes, the adapter is conformant.

For channel adapters, mock the underlying platform SDK and verify:
- `connect()` establishes the connection and `healthy()` returns true.
- `send()` translates `ChannelMessage` to the correct platform API call.
- `listen()` invokes registered handlers when inbound messages arrive.
- Capability methods (`supportsReactions()`, etc.) return accurate values.
- `disconnect()` tears down cleanly.

Tests live in `packages/core/tests/` following the naming convention `{adapter-name}.test.ts`.

---

## Contributing

To submit a new adapter:

1. Implement the relevant interface in `packages/core/src/adapters/{category}/`.
2. Follow the existing directory structure: `state/`, `events/`, `channels/`, `secrets/`, `storage/`.
3. Register the adapter in `InfrastructureFactory` with a new switch case.
4. Add the config option to the Zod schema in `config-schema.ts`.
5. Write conformance tests in `packages/core/tests/`.
6. Submit as a PR. The adapter should work with the existing config and bootstrap flow without modifying other adapters.
