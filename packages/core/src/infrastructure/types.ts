/**
 * Infrastructure — the wired-up set of adapters that the runtime uses.
 *
 * Created by InfrastructureFactory from the YCLAW config.
 * Passed to all services during bootstrap.
 */

import type { IStateStore } from '../interfaces/IStateStore.js';
import type { IEventBus } from '../interfaces/IEventBus.js';
import type { IChannel } from '../interfaces/IChannel.js';
import type { ISecretProvider } from '../interfaces/ISecretProvider.js';
import type { IObjectStore } from '../interfaces/IObjectStore.js';

export interface Infrastructure {
  /** Primary document/state store (default: MongoDB). */
  stateStore: IStateStore;

  /** Event transport + ephemeral KV store (default: Redis). */
  eventBus: IEventBus;

  /** Communication channel adapters, keyed by name. */
  channels: Map<string, IChannel>;

  /** Secrets provider for infrastructure config (default: env vars). */
  secrets: ISecretProvider;

  /** Object/file storage (default: local filesystem). */
  objectStore: IObjectStore;
}
