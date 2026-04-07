/**
 * Contract tests for IChannel interface.
 *
 * Validates the interface shape is consistent across adapters.
 * Uses adapter constructors (without connecting) to verify they
 * implement the interface correctly.
 */

import { describe, it, expect } from 'vitest';
import { SlackChannelAdapter } from '../src/adapters/channels/SlackChannelAdapter.js';
import { TelegramChannelAdapter } from '../src/adapters/channels/TelegramChannelAdapter.js';
import { TwitterChannelAdapter } from '../src/adapters/channels/TwitterChannelAdapter.js';
import { DiscordChannelAdapter } from '../src/adapters/channels/DiscordChannelAdapter.js';
import type { IChannel } from '../src/interfaces/IChannel.js';

function assertChannelInterface(adapter: IChannel) {
  // Name property
  expect(typeof adapter.name).toBe('string');
  expect(adapter.name.length).toBeGreaterThan(0);

  // Lifecycle methods
  expect(typeof adapter.connect).toBe('function');
  expect(typeof adapter.disconnect).toBe('function');
  expect(typeof adapter.healthy).toBe('function');

  // Core messaging
  expect(typeof adapter.send).toBe('function');
  expect(typeof adapter.listen).toBe('function');

  // Capability discovery
  expect(typeof adapter.supportsInboundListening).toBe('function');
  expect(typeof adapter.supportsReactions).toBe('function');
  expect(typeof adapter.supportsThreads).toBe('function');
  expect(typeof adapter.supportsFileUpload).toBe('function');
  expect(typeof adapter.supportsIdentityOverride).toBe('function');

  // Capability returns must be boolean
  expect(typeof adapter.supportsInboundListening()).toBe('boolean');
  expect(typeof adapter.supportsReactions()).toBe('boolean');
  expect(typeof adapter.supportsThreads()).toBe('boolean');
  expect(typeof adapter.supportsFileUpload()).toBe('boolean');
  expect(typeof adapter.supportsIdentityOverride()).toBe('boolean');
}

describe('IChannel contract', () => {
  it('SlackChannelAdapter implements IChannel', () => {
    assertChannelInterface(new SlackChannelAdapter());
  });

  it('TelegramChannelAdapter implements IChannel', () => {
    assertChannelInterface(new TelegramChannelAdapter());
  });

  it('TwitterChannelAdapter implements IChannel', () => {
    assertChannelInterface(new TwitterChannelAdapter());
  });

  it('DiscordChannelAdapter implements IChannel', () => {
    assertChannelInterface(new DiscordChannelAdapter());
  });

  // Capabilities must reflect what is actually implemented (#9)
  describe('Slack capabilities', () => {
    const adapter = new SlackChannelAdapter();
    it('does not support reactions (not implemented)', () => expect(adapter.supportsReactions()).toBe(false));
    it('supports threads', () => expect(adapter.supportsThreads()).toBe(true));
    it('does not support file upload (not implemented)', () => expect(adapter.supportsFileUpload()).toBe(false));
    it('supports identity override', () => expect(adapter.supportsIdentityOverride()).toBe(true));
    it('does not support inbound listening (webhook)', () => expect(adapter.supportsInboundListening()).toBe(false));
  });

  describe('Telegram capabilities', () => {
    const adapter = new TelegramChannelAdapter();
    it('does not support inbound listening (webhook)', () => expect(adapter.supportsInboundListening()).toBe(false));
    it('does not support reactions', () => expect(adapter.supportsReactions()).toBe(false));
    it('does not support threads (not implemented)', () => expect(adapter.supportsThreads()).toBe(false));
    it('does not support file upload (not implemented)', () => expect(adapter.supportsFileUpload()).toBe(false));
    it('does not support identity override', () => expect(adapter.supportsIdentityOverride()).toBe(false));
  });

  describe('Twitter capabilities (none implemented)', () => {
    const adapter = new TwitterChannelAdapter();
    it('does not support inbound listening', () => expect(adapter.supportsInboundListening()).toBe(false));
    it('does not support reactions', () => expect(adapter.supportsReactions()).toBe(false));
    it('does not support threads', () => expect(adapter.supportsThreads()).toBe(false));
    it('does not support file upload', () => expect(adapter.supportsFileUpload()).toBe(false));
    it('does not support identity override', () => expect(adapter.supportsIdentityOverride()).toBe(false));
  });

  describe('Discord capabilities', () => {
    const adapter = new DiscordChannelAdapter();
    it('supports inbound listening', () => expect(adapter.supportsInboundListening()).toBe(true));
    it('supports reactions', () => expect(adapter.supportsReactions()).toBe(true));
    it('supports threads', () => expect(adapter.supportsThreads()).toBe(true));
    it('supports file upload', () => expect(adapter.supportsFileUpload()).toBe(true));
    it('does not support identity override', () => expect(adapter.supportsIdentityOverride()).toBe(false));
  });

  describe('Unconnected adapters return unhealthy/error', () => {
    it('Slack returns false for healthy()', async () => {
      const adapter = new SlackChannelAdapter();
      expect(await adapter.healthy()).toBe(false);
    });

    it('Telegram returns false for healthy()', async () => {
      const adapter = new TelegramChannelAdapter();
      expect(await adapter.healthy()).toBe(false);
    });

    it('Twitter returns false for healthy()', async () => {
      const adapter = new TwitterChannelAdapter();
      expect(await adapter.healthy()).toBe(false);
    });

    it('Discord returns false for healthy()', async () => {
      const adapter = new DiscordChannelAdapter();
      expect(await adapter.healthy()).toBe(false);
    });

    it('Slack send returns error when not connected', async () => {
      const adapter = new SlackChannelAdapter();
      const result = await adapter.send(
        { channelId: 'test' },
        { text: 'hello' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('Discord send returns error when not connected', async () => {
      const adapter = new DiscordChannelAdapter();
      const result = await adapter.send(
        { channelId: 'test' },
        { text: 'hello' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });
});
