import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// ─── Shared mock state (prefixed with "mock" for vi.mock hoisting) ──────────

let mockRegisteredHandlers: Record<string, Function> = {};

const mockTelegram = {
  getMe: vi.fn().mockResolvedValue({ username: 'TestBot', id: 999 }),
  getChatMember: vi.fn().mockResolvedValue({ status: 'member' }),
};

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({ userIds: [], updatedAt: '2026-01-01T00:00:00.000Z' })),
  writeFileSync: vi.fn(),
}));

vi.mock('../src/config/loader.js', () => ({
  getMemoryDir: vi.fn(() => '/tmp/test-memory'),
}));

vi.mock('../src/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('telegraf', () => {
  // Use a regular class so `new Telegraf()` works
  class MockTelegraf {
    on: any;
    telegram: any;
    launch: any;
    stop: any;
    webhookCallback: any;
    constructor() {
      this.on = vi.fn((event: string, handler: Function) => {
        mockRegisteredHandlers[event] = handler;
      });
      this.telegram = mockTelegram;
      this.launch = vi.fn();
      this.stop = vi.fn();
      this.webhookCallback = vi.fn(() => vi.fn());
    }
  }
  return { Telegraf: MockTelegraf };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const envBackup: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    envBackup[key] = process.env[key];
    process.env[key] = value;
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function makeTextCtx(overrides: Record<string, unknown> = {}) {
  const message = {
    message_id: 1,
    chat: { id: 12345, type: 'group' as const },
    from: { id: 100, username: 'testuser', first_name: 'Test', is_bot: false },
    text: 'Hello world',
    date: Math.floor(Date.now() / 1000),
    reply_to_message: undefined as any,
    ...overrides,
  };
  return {
    message,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

async function createHandler() {
  // Dynamic import so env vars are picked up fresh after vi.resetModules()
  const mod = await import('../src/triggers/telegram-webhook.js');
  const mockEventBus = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    connect: vi.fn(),
  };
  const handler = new mod.TelegramWebhookHandler(mockEventBus as any);
  return { handler, eventBus: mockEventBus };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TelegramWebhookHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisteredHandlers = {};
    // Reset fs mocks to defaults
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ userIds: [], updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  // ─── parseIdList (tested indirectly through constructor) ────────────────

  describe('parseIdList via TELEGRAM_ADMIN_IDS', () => {
    it('parses comma-separated IDs', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100,200,300',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'secret123',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];
      expect(textHandler).toBeDefined();

      // Admin 100 sends /approve 500 — should work because 100 is in ADMIN_IDS
      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve 500',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Approved 500.');
    });

    it('handles empty TELEGRAM_ADMIN_IDS', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { handler } = await createHandler();
      expect(handler).toBeDefined();
    });

    it('skips non-numeric values in ID list', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100,abc,,200,NaN',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'code',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      // Admin 200 should be recognized (non-numeric values skipped)
      const ctx = makeTextCtx({
        from: { id: 200, username: 'admin2', first_name: 'Admin2', is_bot: false },
        text: '/approve 600',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Approved 600.');
    });
  });

  // ─── TelegramAllowlist (tested via seeding + pairing) ──────────────────

  describe('TelegramAllowlist', () => {
    it('loads user IDs from file on construction', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ userIds: [111, 222], updatedAt: '2026-01-01' }),
      );

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      // User 111 is in the file — should be allowed through
      const ctx = makeTextCtx({
        from: { id: 111, username: 'loaded', first_name: 'Loaded', is_bot: false },
        text: 'Hello from allowed user',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalledWith(
        'telegram',
        'message',
        expect.objectContaining({ text: 'Hello from allowed user' }),
      );
    });

    it('seeds from TELEGRAM_ALLOWED_SENDER_IDS env var', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ALLOWED_SENDER_IDS: '333,444',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      // User 333 is seeded from env — should be allowed
      const ctx = makeTextCtx({
        from: { id: 333, username: 'seeded', first_name: 'Seeded', is_bot: false },
        text: 'Hello from seeded user',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('persists to file when seeding from env var adds new IDs', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ALLOWED_SENDER_IDS: '555',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      await createHandler();

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('allowed_senders.json'),
        expect.stringContaining('555'),
        'utf-8',
      );
    });

    it('creates directory and file if they do not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      await createHandler();

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('telegram'),
        { recursive: true },
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('allowed_senders.json'),
        expect.any(String),
        'utf-8',
      );
    });

    it('add() persists the new user and returns true', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'pair123',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 777, username: 'newuser', first_name: 'New', is_bot: false },
        text: '/pair pair123',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Paired successfully.');
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('allowed_senders.json'),
        expect.stringContaining('777'),
        'utf-8',
      );
    });

    it('already-paired user sending /pair is treated as normal message', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ userIds: [777], updatedAt: '2026-01-01' }),
      );

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'pair123',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      // User 777 is already paired — /pair text passes through as normal message
      const ctx = makeTextCtx({
        from: { id: 777, username: 'existing', first_name: 'Existing', is_bot: false },
        text: '/pair pair123',
      });
      await textHandler(ctx);

      // Not blocked — processed as a normal message
      expect(eventBus.publish).toHaveBeenCalled();
    });
  });

  // ─── Chat restriction ──────────────────────────────────────────────────

  describe('chat restriction', () => {
    it('ignores messages from unauthorized chat IDs', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        chat: { id: 99999, type: 'group' },
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('allows messages from the authorized chat ID', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        chat: { id: 12345, type: 'group' },
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('allows all chats when TELEGRAM_CHAT_ID is not set', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });
      delete process.env.TELEGRAM_CHAT_ID;

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        chat: { id: 99999, type: 'group' },
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });
  });

  // ─── Pairing gate ──────────────────────────────────────────────────────

  describe('pairing gate', () => {
    it('blocks unpaired senders when pairing is required', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 999, username: 'stranger', first_name: 'Stranger', is_bot: false },
        text: 'Hello I am not paired',
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Pairing required'),
      );
    });

    it('allows paired senders through', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ userIds: [100], updatedAt: '2026-01-01' }),
      );

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'paired', first_name: 'Paired', is_bot: false },
        text: 'Hello I am paired',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('does not block when pairing is not required', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 999, username: 'anyone', first_name: 'Anyone', is_bot: false },
        text: 'Hello no pairing needed',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });
  });

  // ─── isPairingRequired ─────────────────────────────────────────────────

  describe('isPairingRequired', () => {
    it('returns true when TELEGRAM_PAIRING_REQUIRED=true', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 888, username: 'test', first_name: 'Test', is_bot: false },
        text: 'test',
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('returns false when TELEGRAM_PAIRING_REQUIRED=false', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 888, username: 'test', first_name: 'Test', is_bot: false },
        text: 'test',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('defaults to true in production when env var not set', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        NODE_ENV: 'production',
      });
      delete process.env.TELEGRAM_PAIRING_REQUIRED;

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 888, username: 'test', first_name: 'Test', is_bot: false },
        text: 'test',
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('defaults to false in non-production when env var not set', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        NODE_ENV: 'development',
      });
      delete process.env.TELEGRAM_PAIRING_REQUIRED;

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 888, username: 'test', first_name: 'Test', is_bot: false },
        text: 'test',
      });
      await textHandler(ctx);

      expect(eventBus.publish).toHaveBeenCalled();
    });
  });

  // ─── /pair command ─────────────────────────────────────────────────────

  describe('/pair command', () => {
    it('pairs sender with correct code', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'secret42',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 555, username: 'newbie', first_name: 'Newbie', is_bot: false },
        text: '/pair secret42',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Paired successfully.');
    });

    it('rejects wrong pairing code', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'secret42',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 555, username: 'newbie', first_name: 'Newbie', is_bot: false },
        text: '/pair wrongcode',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Invalid pairing code.');
    });

    it('rejects /pair with no code provided', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
        TELEGRAM_PAIRING_CODE: 'secret42',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 555, username: 'newbie', first_name: 'Newbie', is_bot: false },
        text: '/pair',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Invalid pairing code.');
    });

    it('falls back to admin-only when TELEGRAM_PAIRING_CODE not set', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });
      delete process.env.TELEGRAM_PAIRING_CODE;

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 555, username: 'newbie', first_name: 'Newbie', is_bot: false },
        text: '/pair anything',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'Pairing is admin-only. Ask an admin to /approve you.',
      );
    });
  });

  // ─── /approve command ──────────────────────────────────────────────────

  describe('/approve command', () => {
    it('admin approves a user by ID', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve 555',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Approved 555.');
    });

    it('admin approves by replying to a message', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve',
        reply_to_message: { from: { id: 666 } },
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Approved 666.');
    });

    it('shows usage when /approve has no target', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'Usage: /approve <userId> (or reply to a user message).',
      );
    });

    it('non-admin /approve is blocked (treated as unpaired message)', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      mockTelegram.getChatMember.mockResolvedValue({ status: 'member' });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 999, username: 'notadmin', first_name: 'NotAdmin', is_bot: false },
        text: '/approve 555',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Pairing required'),
      );
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('reports already-paired for duplicate approval', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ userIds: [555], updatedAt: '2026-01-01' }),
      );

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve 555',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('555 is already paired.');
    });
  });

  // ─── Admin fast-path ───────────────────────────────────────────────────

  describe('admin fast-path via TELEGRAM_ADMIN_IDS', () => {
    it('checks TELEGRAM_ADMIN_IDS before calling getChatMember API', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '100',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'admin', first_name: 'Admin', is_bot: false },
        text: '/approve 555',
      });
      await textHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Approved 555.');
    });

    it('falls back to getChatMember for non-ADMIN_IDS admins', async () => {
      mockTelegram.getChatMember.mockResolvedValue({ status: 'administrator' });

      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_ADMIN_IDS: '',
        TELEGRAM_PAIRING_REQUIRED: 'true',
      });

      await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 200, username: 'chatadmin', first_name: 'ChatAdmin', is_bot: false },
        text: '/approve 555',
      });
      await textHandler(ctx);

      expect(mockTelegram.getChatMember).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith('Approved 555.');
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('skips messages from bots', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { id: 100, username: 'otherbot', first_name: 'Bot', is_bot: true },
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('skips messages without sender ID', async () => {
      setEnv({
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: '12345',
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });

      const { eventBus } = await createHandler();
      const textHandler = mockRegisteredHandlers['text'];

      const ctx = makeTextCtx({
        from: { username: 'ghost', first_name: 'Ghost', is_bot: false },
      });
      await textHandler(ctx);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('does not initialize bot when TELEGRAM_BOT_TOKEN is missing', async () => {
      setEnv({
        TELEGRAM_PAIRING_REQUIRED: 'false',
      });
      delete process.env.TELEGRAM_BOT_TOKEN;

      await createHandler();
      expect(mockRegisteredHandlers['text']).toBeUndefined();
    });
  });
});
