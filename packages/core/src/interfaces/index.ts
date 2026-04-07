/**
 * YCLAW Infrastructure Interfaces
 *
 * Every infrastructure component is behind an interface. The core runtime
 * imports ONLY from these interfaces. Concrete implementations live in
 * packages/core/src/adapters/.
 *
 * Pattern follows existing ActionExecutor and SecretBackend conventions.
 */

// ─── State Store ────────────────────────────────────────────────────────────

export type {
  IStateStore,
  ICollection,
  FilterQuery,
  ComparisonOperators,
  UpdateQuery,
  FindOptions,
  SortSpec,
  UpdateResult,
  DeleteResult,
  IndexSpec,
} from './IStateStore.js';

// ─── Event Bus ──────────────────────────────────────────────────────────────

export type {
  IEventBus,
  EventHandler,
  QueueItem,
} from './IEventBus.js';

// ─── Channel ────────────────────────────────────────────────────────────────

export type {
  IChannel,
  ChannelTarget,
  ChannelMessage,
  ChannelConfig,
  MessageRef,
  ThreadRef,
  MessageResult,
  FileUpload,
  FileResult,
  InboundMessage,
  InboundMessageHandler,
} from './IChannel.js';

// ─── Secret Provider ────────────────────────────────────────────────────────

export type { ISecretProvider } from './ISecretProvider.js';

// ─── Object Store ───────────────────────────────────────────────────────────

export type {
  IObjectStore,
  ObjectMetadata,
  PutOptions,
  ListResult,
} from './IObjectStore.js';

// ─── Memory Store ───────────────────────────────────────────────────────────

export type {
  IMemoryStore,
  MemoryItem,
  MemoryTriple,
  MemoryEpisode,
  MemorySearchOptions,
  MemorySearchResult,
} from './IMemoryStore.js';
