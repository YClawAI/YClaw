/**
 * YCLAW Infrastructure Adapters
 *
 * Default implementations for all infrastructure interfaces.
 * Each adapter wraps existing production code — refactored, not rewritten.
 */

// ─── State Store ────────────────────────────────────────────────────────────

export { MongoStateStore, NullStateStore } from './state/MongoStateStore.js';

// ─── Event Bus ──────────────────────────────────────────────────────────────

export { RedisEventBus } from './events/RedisEventBus.js';

// ─── Channel Adapters ───────────────────────────────────────────────────────

export { SlackChannelAdapter } from './channels/SlackChannelAdapter.js';
export { TelegramChannelAdapter } from './channels/TelegramChannelAdapter.js';
export { TwitterChannelAdapter } from './channels/TwitterChannelAdapter.js';
export { DiscordChannelAdapter } from './channels/DiscordChannelAdapter.js';

// ─── Secret Providers ───────────────────────────────────────────────────────

export { EnvSecretProvider } from './secrets/EnvSecretProvider.js';
export { AwsSecretsProvider } from './secrets/AwsSecretsProvider.js';

// ─── Object Stores ──────────────────────────────────────────────────────────

export { LocalFileStore } from './storage/LocalFileStore.js';
export { S3ObjectStore } from './storage/S3ObjectStore.js';
