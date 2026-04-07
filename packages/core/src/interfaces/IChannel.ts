/**
 * IChannel — Abstract interface for communication channel adapters.
 *
 * Replaces hardcoded Slack/Telegram/Twitter integrations. Each channel
 * adapter implements this interface to provide a unified messaging API.
 *
 * Design follows the existing ActionExecutor pattern:
 * - name property identifies the adapter
 * - healthCheck for operational readiness
 * - Capability discovery via supports*() methods
 *
 * The existing ActionExecutor interface is preserved for backward compatibility.
 * Channel adapters implement BOTH IChannel (for the infrastructure layer) and
 * ActionExecutor (for the action registry). Over time, consumers migrate to
 * IChannel; ActionExecutor remains for agent tool invocations.
 */

// ─── Message Types ──────────────────────────────────────────────────────────

/** Target for outbound messages — identifies where to send. */
export interface ChannelTarget {
  /** Channel/room/chat ID (platform-specific). Optional when userId is provided for DMs. */
  channelId?: string;
  /** Optional user ID for DMs. When provided without channelId, sends a direct message. */
  userId?: string;
  /** Optional thread/topic ID for threaded messages. */
  threadId?: string;
}

/** Reference to an existing message — used for replies, reactions, etc. */
export interface MessageRef {
  /** Platform-specific message ID. */
  messageId: string;
  /** Channel the message lives in. */
  channelId: string;
}

/** Thread reference — returned when creating a new thread. */
export interface ThreadRef {
  threadId: string;
  channelId: string;
}

/** File attachment for upload. */
export interface FileUpload {
  /** File content as Buffer. */
  content: Buffer;
  /** File name with extension. */
  filename: string;
  /** MIME type (e.g., 'image/png'). */
  contentType?: string;
}

/** Outbound message payload. */
export interface ChannelMessage {
  /** Message text content (may contain platform-specific formatting). */
  text: string;
  /** Optional file attachments. */
  attachments?: FileUpload[];
  /** Reply to a specific message. */
  replyTo?: MessageRef;
  /** Send in a specific thread. */
  threadId?: string;
  /** Send silently (no notification) if the platform supports it. */
  silent?: boolean;
  /** Optional identity override (display name, avatar). */
  identity?: {
    displayName?: string;
    avatarUrl?: string;
    avatarEmoji?: string;
  };
}

/** Result of sending a message. */
export interface MessageResult {
  success: boolean;
  /** Platform-specific message ID of the sent message. */
  messageId?: string;
  /** Thread ID if the message started or is in a thread. */
  threadId?: string;
  error?: string;
}

/** Result of a file upload. */
export interface FileResult {
  success: boolean;
  url?: string;
  error?: string;
}

/** Inbound message from a channel — normalized across platforms. */
export interface InboundMessage {
  /** Platform-specific message ID. */
  messageId: string;
  /** Channel the message was sent in. */
  channelId: string;
  /** User who sent the message (platform-specific ID). */
  userId: string;
  /** Display name of the sender. */
  displayName?: string;
  /** Message text content. */
  text: string;
  /** Thread ID if the message is in a thread. */
  threadId?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Raw platform-specific payload for advanced processing. */
  raw?: unknown;
}

/** Handler for inbound messages from a channel. */
export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;

// ─── Channel Config ─────────────────────────────────────────────────────────

/** Base channel configuration — extended by each adapter. */
export interface ChannelConfig {
  /** Enable/disable this channel. */
  enabled: boolean;
  /** Adapter-specific configuration (tokens, webhook URLs, etc.). */
  [key: string]: unknown;
}

// ─── IChannel ───────────────────────────────────────────────────────────────

/**
 * Communication channel adapter interface.
 *
 * Every channel (Slack, Telegram, Twitter, Discord, etc.) implements
 * this interface. The infrastructure layer instantiates and manages
 * channel lifecycle; agent tools use them through the action registry.
 */
export interface IChannel {
  /** Channel identifier (e.g., 'slack', 'telegram', 'discord', 'twitter'). */
  readonly name: string;

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /** Initialize the channel connection with provided config. */
  connect(config: ChannelConfig): Promise<void>;

  /** Disconnect and clean up resources. */
  disconnect(): Promise<void>;

  /** Returns true if the channel is connected and operational. */
  healthy(): Promise<boolean>;

  // ─── Core Messaging ─────────────────────────────────────────────────────

  /** Send a message to a target. */
  send(target: ChannelTarget, message: ChannelMessage): Promise<MessageResult>;

  /**
   * Register a handler for inbound messages. The handler is called for
   * every message received on this channel. Multiple handlers are supported.
   *
   * Only available if supportsInboundListening() returns true. Channels
   * where inbound messages are handled externally (e.g., via webhook
   * handlers) return false and this method is a no-op.
   */
  listen(handler: InboundMessageHandler): Promise<void>;

  // ─── Optional Capabilities ──────────────────────────────────────────────

  /**
   * Whether this channel supports registering inbound message handlers
   * via listen(). Channels where inbound is handled by external webhook
   * handlers (Slack, Telegram) return false.
   */
  supportsInboundListening(): boolean;

  /** Whether this channel supports emoji reactions on messages. */
  supportsReactions(): boolean;
  /** Add a reaction to a message. Only available if supportsReactions() is true. */
  react?(target: MessageRef, emoji: string): Promise<void>;

  /** Whether this channel supports threaded conversations. */
  supportsThreads(): boolean;
  /** Create a new thread from a message. Only available if supportsThreads() is true. */
  createThread?(target: MessageRef, name: string): Promise<ThreadRef>;

  /** Whether this channel supports file uploads. */
  supportsFileUpload(): boolean;
  /** Upload a file to a target. Only available if supportsFileUpload() is true. */
  uploadFile?(target: ChannelTarget, file: FileUpload): Promise<FileResult>;

  /** Whether this channel supports identity override (post as different name/avatar). */
  supportsIdentityOverride(): boolean;
}
