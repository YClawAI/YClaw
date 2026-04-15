/**
 * InfrastructureFactory — Creates and wires infrastructure adapters from config.
 *
 * Reads yclaw.config.yaml (or falls back to env vars) and instantiates
 * the correct adapter combination. Maps naturally to the existing
 * ServiceContext pattern in bootstrap/services.ts.
 *
 * Usage:
 * ```typescript
 * const config = await loadConfig();  // or YclawConfigSchema.parse({})
 * const infra = await InfrastructureFactory.create(config);
 * // infra.stateStore, infra.eventBus, infra.channels, etc.
 * ```
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { YclawConfigSchema, type YclawConfig } from './config-schema.js';
import type { Infrastructure } from './types.js';
import type { IStateStore } from '../interfaces/IStateStore.js';
import type { IEventBus } from '../interfaces/IEventBus.js';
import type { IChannel } from '../interfaces/IChannel.js';
import type { ISecretProvider } from '../interfaces/ISecretProvider.js';
import type { IObjectStore } from '../interfaces/IObjectStore.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('infrastructure-factory');

export class InfrastructureFactory {
  /**
   * Create the full infrastructure from a validated config.
   * Connects all adapters and returns them ready to use.
   */
  static async create(config: YclawConfig): Promise<Infrastructure> {
    logger.info('Creating infrastructure from config', {
      state: config.storage.state.type,
      events: config.storage.events.type,
      objects: config.storage.objects.type,
      secrets: config.secrets.provider,
      channels: Object.entries(config.channels)
        .filter(([, v]) => v && 'enabled' in v && v.enabled)
        .map(([k]) => k),
    });

    // Track connected resources for cleanup on partial failure (#14).
    // Use Promise.allSettled to capture which resources connected before failure.
    const connected: Array<{ disconnect(): Promise<void> }> = [];

    try {
      // Create secrets provider first so other factories can resolve
      // credentials through it instead of reading env vars directly (#3).
      const secrets = await this.createSecretProvider(config);

      const results = await Promise.allSettled([
        this.createStateStore(config, secrets),
        this.createEventBus(config, secrets),
        this.createObjectStore(config),
      ]);

      // Collect successfully created resources for cleanup tracking
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value
          && typeof (r.value as { disconnect?: unknown }).disconnect === 'function') {
          connected.push(r.value as { disconnect(): Promise<void> });
        }
      }

      // Check for any failures
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        const firstErr = (failures[0] as PromiseRejectedResult).reason;
        throw firstErr instanceof Error
          ? firstErr
          : new Error(String(firstErr));
      }

      const stateStore = (results[0] as PromiseFulfilledResult<IStateStore>).value;
      const eventBus = (results[1] as PromiseFulfilledResult<IEventBus>).value;
      const objectStore = (results[2] as PromiseFulfilledResult<IObjectStore>).value;
      const channels = await this.createChannels(config, eventBus);
      for (const ch of channels.values()) connected.push(ch);

      return { stateStore, eventBus, channels, secrets, objectStore };
    } catch (err) {
      // Clean up any already-connected resources on failure
      logger.error('Infrastructure creation failed — cleaning up connected resources');
      for (const resource of connected) {
        try { await resource.disconnect(); } catch { /* best-effort */ }
      }
      throw err;
    }
  }

  /**
   * Load config from yclaw.config.yaml, falling back to defaults
   * (which read from env vars).
   */
  static async loadConfig(configPath?: string): Promise<YclawConfig> {
    const searchPath = configPath || resolve(process.cwd(), 'yclaw.config.yaml');

    try {
      const raw = await readFile(searchPath, 'utf-8');
      const parsed = parseYaml(raw);
      const config = YclawConfigSchema.parse(this.applyEnvChannelDefaults(parsed));
      logger.info('Loaded config from file', { path: searchPath });
      return config;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No yclaw.config.yaml found — using env var defaults');
        return YclawConfigSchema.parse(this.applyEnvChannelDefaults({}));
      }
      throw new Error(`Failed to load yclaw.config.yaml: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Auto-enable channel adapters from environment variables. Users can
   * opt in to Slack and Discord by setting their bot tokens without
   * writing a `yclaw.config.yaml`. An explicit `enabled: false` in the
   * raw config file always wins so operators can force a channel off.
   */
  private static applyEnvChannelDefaults(config: unknown): Record<string, unknown> {
    const source = (config && typeof config === 'object')
      ? config as Record<string, unknown>
      : {};
    const rawChannels = (source.channels && typeof source.channels === 'object')
      ? source.channels as Record<string, unknown>
      : {};
    const channels: Record<string, unknown> = { ...rawChannels };

    const maybeEnable = (
      name: 'slack' | 'discord',
      envVar: string,
    ): void => {
      if (!process.env[envVar]?.trim()) return;
      const existing = (channels[name] && typeof channels[name] === 'object')
        ? channels[name] as Record<string, unknown>
        : undefined;
      // Respect explicit opt-out (`enabled: false`) from the raw config.
      if (existing?.enabled === false) return;
      channels[name] = {
        ...(existing ?? {}),
        enabled: true,
      };
    };

    maybeEnable('slack', 'SLACK_BOT_TOKEN');
    maybeEnable('discord', 'DISCORD_BOT_TOKEN');

    return { ...source, channels };
  }

  // ─── Factory Methods ──────────────────────────────────────────────────────

  private static async createStateStore(
    config: YclawConfig,
    secrets: ISecretProvider,
  ): Promise<IStateStore> {
    const stateConfig = config.storage.state;

    switch (stateConfig.type) {
      case 'mongodb': {
        const { MongoStateStore, NullStateStore } = await import('../adapters/state/MongoStateStore.js');
        // Resolve URI through secrets provider (#3)
        const uri = stateConfig.uri || await secrets.get('MONGODB_URI');
        if (!uri) {
          logger.warn('MONGODB_URI not set — state store running in degraded mode');
          return new NullStateStore();
        }
        const dbName = stateConfig.database
          || await secrets.get('MONGODB_DB')
          || 'yclaw_agents';
        const store = new MongoStateStore(uri, dbName);
        await store.connect();
        return store;
      }
      default:
        throw new Error(`Unsupported state store type: ${(stateConfig as { type: string }).type}`);
    }
  }

  private static async createEventBus(
    config: YclawConfig,
    secrets: ISecretProvider,
  ): Promise<IEventBus> {
    const eventsConfig = config.storage.events;

    switch (eventsConfig.type) {
      case 'redis': {
        const { RedisEventBus } = await import('../adapters/events/RedisEventBus.js');
        // Resolve URL through secrets provider (#3)
        const url = eventsConfig.url || await secrets.get('REDIS_URL');
        const bus = new RedisEventBus(url ?? undefined);
        await bus.connect();
        return bus;
      }
      default:
        throw new Error(`Unsupported event bus type: ${(eventsConfig as { type: string }).type}`);
    }
  }

  private static async createSecretProvider(config: YclawConfig): Promise<ISecretProvider> {
    switch (config.secrets.provider) {
      case 'env': {
        const { EnvSecretProvider } = await import('../adapters/secrets/EnvSecretProvider.js');
        return new EnvSecretProvider();
      }
      case 'aws-secrets-manager': {
        const { AwsSecretsProvider } = await import('../adapters/secrets/AwsSecretsProvider.js');
        return new AwsSecretsProvider(config.secrets.prefix, config.secrets.region);
      }
      default:
        throw new Error(`Unsupported secrets provider: ${(config.secrets as { provider: string }).provider}`);
    }
  }

  private static async createObjectStore(config: YclawConfig): Promise<IObjectStore> {
    const objConfig = config.storage.objects;

    switch (objConfig.type) {
      case 'local': {
        const { LocalFileStore } = await import('../adapters/storage/LocalFileStore.js');
        return new LocalFileStore(objConfig.path);
      }
      case 's3': {
        const { S3ObjectStore } = await import('../adapters/storage/S3ObjectStore.js');
        return new S3ObjectStore(objConfig.bucket, objConfig.prefix, objConfig.region);
      }
      default:
        throw new Error(`Unsupported object store type: ${(objConfig as { type: string }).type}`);
    }
  }

  private static async createChannels(
    config: YclawConfig,
    eventBus: IEventBus,
  ): Promise<Map<string, IChannel>> {
    const channels = new Map<string, IChannel>();

    // Extract raw Redis from the event bus for adapters that need it (M4: Slack dedup)
    let redis: unknown = null;
    if ('getRawRedis' in eventBus) {
      redis = (eventBus as { getRawRedis(): unknown }).getRawRedis();
    }

    for (const [name, channelConfig] of Object.entries(config.channels)) {
      if (!channelConfig || !('enabled' in channelConfig) || !channelConfig.enabled) continue;

      try {
        const adapter = await this.createChannelAdapter(name);
        if (adapter) {
          // Pass Redis to adapters that need it (e.g., Slack for dedup)
          const connectConfig = {
            enabled: true,
            ...(channelConfig.config ?? {}),
            ...(redis ? { redis } : {}),
          };
          await adapter.connect(connectConfig);
          // Validate health after connect — skip misconfigured channels (#4)
          const isHealthy = await adapter.healthy();
          if (isHealthy) {
            channels.set(name, adapter);
            logger.info('Channel adapter connected and healthy', { channel: name });
          } else {
            logger.warn(`Channel "${name}" connected but unhealthy — skipping registration`);
            await adapter.disconnect();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to initialize channel "${name}": ${msg}`);
      }
    }

    return channels;
  }

  private static async createChannelAdapter(name: string): Promise<IChannel | null> {
    switch (name) {
      case 'slack': {
        const { SlackChannelAdapter } = await import('../adapters/channels/SlackChannelAdapter.js');
        return new SlackChannelAdapter();
      }
      case 'telegram': {
        const { TelegramChannelAdapter } = await import('../adapters/channels/TelegramChannelAdapter.js');
        return new TelegramChannelAdapter();
      }
      case 'twitter': {
        const { TwitterChannelAdapter } = await import('../adapters/channels/TwitterChannelAdapter.js');
        return new TwitterChannelAdapter();
      }
      case 'discord': {
        const { DiscordChannelAdapter } = await import('../adapters/channels/DiscordChannelAdapter.js');
        return new DiscordChannelAdapter();
      }
      default:
        logger.warn(`Unknown channel adapter: ${name}`);
        return null;
    }
  }
}
