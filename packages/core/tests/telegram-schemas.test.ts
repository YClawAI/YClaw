import { describe, it, expect } from 'vitest';
import { ACTION_SCHEMAS, ACTION_DEFAULTS } from '../src/actions/schemas.js';

// ─── Telegram Action Schemas ────────────────────────────────────────────────

describe('Telegram action schemas', () => {
  const TELEGRAM_ACTIONS = [
    'telegram:message',
    'telegram:reply',
    'telegram:pin',
    'telegram:delete',
    'telegram:dm',
    'telegram:announce',
    'telegram:ban',
    'telegram:restrict',
    'telegram:set_chat_photo',
    'telegram:set_title',
    'telegram:set_description',
    'telegram:set_permissions',
    'telegram:export_invite',
  ];

  it('has schemas for all 13 telegram actions', () => {
    for (const action of TELEGRAM_ACTIONS) {
      expect(ACTION_SCHEMAS[action], `Missing schema for ${action}`).toBeDefined();
      expect(ACTION_SCHEMAS[action].description).toBeTruthy();
      expect(ACTION_SCHEMAS[action].parameters).toBeDefined();
    }
  });

  it('total telegram schema count is 13', () => {
    const allActions = Object.keys(ACTION_SCHEMAS);
    const telegramCount = allActions.filter(a => a.startsWith('telegram:')).length;
    expect(telegramCount).toBe(13);
  });

  // ─── telegram:message ───────────────────────────────────────────────────

  it('telegram:message requires chatId and text', () => {
    const schema = ACTION_SCHEMAS['telegram:message'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.chatId.type).toBe('string');
    expect(schema.parameters.text.required).toBe(true);
    expect(schema.parameters.text.type).toBe('string');
  });

  it('telegram:message has optional parseMode', () => {
    const schema = ACTION_SCHEMAS['telegram:message'];
    expect(schema.parameters.parseMode.type).toBe('string');
    expect(schema.parameters.parseMode.required).toBeUndefined();
  });

  // ─── telegram:reply ─────────────────────────────────────────────────────

  it('telegram:reply requires chatId, text, and replyToMessageId', () => {
    const schema = ACTION_SCHEMAS['telegram:reply'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.text.required).toBe(true);
    expect(schema.parameters.replyToMessageId.required).toBe(true);
    expect(schema.parameters.replyToMessageId.type).toBe('number');
  });

  it('telegram:reply has optional parseMode', () => {
    const schema = ACTION_SCHEMAS['telegram:reply'];
    expect(schema.parameters.parseMode.required).toBeUndefined();
  });

  // ─── telegram:pin ───────────────────────────────────────────────────────

  it('telegram:pin requires chatId and messageId', () => {
    const schema = ACTION_SCHEMAS['telegram:pin'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.messageId.required).toBe(true);
    expect(schema.parameters.messageId.type).toBe('number');
  });

  it('telegram:pin has optional disableNotification', () => {
    const schema = ACTION_SCHEMAS['telegram:pin'];
    expect(schema.parameters.disableNotification.type).toBe('boolean');
    expect(schema.parameters.disableNotification.required).toBeUndefined();
  });

  // ─── telegram:delete ────────────────────────────────────────────────────

  it('telegram:delete requires chatId and messageId', () => {
    const schema = ACTION_SCHEMAS['telegram:delete'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.messageId.required).toBe(true);
    expect(schema.parameters.messageId.type).toBe('number');
  });

  // ─── telegram:dm ────────────────────────────────────────────────────────

  it('telegram:dm requires userId and text', () => {
    const schema = ACTION_SCHEMAS['telegram:dm'];
    expect(schema.parameters.userId.required).toBe(true);
    expect(schema.parameters.userId.type).toBe('string');
    expect(schema.parameters.text.required).toBe(true);
    expect(schema.parameters.text.type).toBe('string');
  });

  it('telegram:dm has optional parseMode', () => {
    const schema = ACTION_SCHEMAS['telegram:dm'];
    expect(schema.parameters.parseMode.required).toBeUndefined();
  });

  // ─── telegram:announce ──────────────────────────────────────────────────

  it('telegram:announce requires text only', () => {
    const schema = ACTION_SCHEMAS['telegram:announce'];
    expect(schema.parameters.text.required).toBe(true);
    expect(schema.parameters.text.type).toBe('string');
  });

  it('telegram:announce has optional parseMode', () => {
    const schema = ACTION_SCHEMAS['telegram:announce'];
    expect(schema.parameters.parseMode.required).toBeUndefined();
    expect(schema.parameters.parseMode.type).toBe('string');
  });

  it('telegram:announce does not require chatId (uses env var)', () => {
    const schema = ACTION_SCHEMAS['telegram:announce'];
    expect(schema.parameters.chatId).toBeUndefined();
  });

  // ─── telegram:ban ───────────────────────────────────────────────────────

  it('telegram:ban requires chatId and userId', () => {
    const schema = ACTION_SCHEMAS['telegram:ban'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.userId.required).toBe(true);
    expect(schema.parameters.userId.type).toBe('number');
  });

  it('telegram:ban has optional untilDate', () => {
    const schema = ACTION_SCHEMAS['telegram:ban'];
    expect(schema.parameters.untilDate.type).toBe('number');
    expect(schema.parameters.untilDate.required).toBeUndefined();
  });

  // ─── telegram:restrict ──────────────────────────────────────────────────

  it('telegram:restrict requires chatId and userId', () => {
    const schema = ACTION_SCHEMAS['telegram:restrict'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.userId.required).toBe(true);
    expect(schema.parameters.userId.type).toBe('number');
  });

  it('telegram:restrict has optional permissions object', () => {
    const schema = ACTION_SCHEMAS['telegram:restrict'];
    expect(schema.parameters.permissions.type).toBe('object');
    expect(schema.parameters.permissions.required).toBeUndefined();
  });

  it('telegram:restrict has optional untilDate', () => {
    const schema = ACTION_SCHEMAS['telegram:restrict'];
    expect(schema.parameters.untilDate.type).toBe('number');
    expect(schema.parameters.untilDate.required).toBeUndefined();
  });

  // ─── telegram:set_chat_photo ────────────────────────────────────────────

  it('telegram:set_chat_photo requires chatId and photoPath', () => {
    const schema = ACTION_SCHEMAS['telegram:set_chat_photo'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.photoPath.required).toBe(true);
    expect(schema.parameters.photoPath.type).toBe('string');
  });

  // ─── telegram:set_title ─────────────────────────────────────────────────

  it('telegram:set_title requires chatId and title', () => {
    const schema = ACTION_SCHEMAS['telegram:set_title'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.title.required).toBe(true);
    expect(schema.parameters.title.type).toBe('string');
  });

  // ─── telegram:set_description ───────────────────────────────────────────

  it('telegram:set_description requires chatId and description', () => {
    const schema = ACTION_SCHEMAS['telegram:set_description'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.description.required).toBe(true);
    expect(schema.parameters.description.type).toBe('string');
  });

  // ─── telegram:set_permissions ───────────────────────────────────────────

  it('telegram:set_permissions requires chatId and permissions', () => {
    const schema = ACTION_SCHEMAS['telegram:set_permissions'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.permissions.required).toBe(true);
    expect(schema.parameters.permissions.type).toBe('object');
  });

  // ─── telegram:export_invite ─────────────────────────────────────────────

  it('telegram:export_invite requires only chatId', () => {
    const schema = ACTION_SCHEMAS['telegram:export_invite'];
    expect(schema.parameters.chatId.required).toBe(true);
    expect(schema.parameters.chatId.type).toBe('string');
    expect(Object.keys(schema.parameters)).toHaveLength(1);
  });
});

// ─── ACTION_DEFAULTS for Telegram ───────────────────────────────────────────

describe('ACTION_DEFAULTS for Telegram', () => {
  it('telegram:announce defaults parseMode to HTML', () => {
    expect(ACTION_DEFAULTS['telegram:announce']).toBeDefined();
    expect(ACTION_DEFAULTS['telegram:announce'].parseMode).toBe('HTML');
  });

  it('telegram:pin defaults disableNotification to false', () => {
    expect(ACTION_DEFAULTS['telegram:pin']).toBeDefined();
    expect(ACTION_DEFAULTS['telegram:pin'].disableNotification).toBe(false);
  });
});

// ─── chatId Pattern Consistency ─────────────────────────────────────────────

describe('Telegram chatId pattern consistency', () => {
  const ACTIONS_WITH_CHAT_ID = [
    'telegram:message',
    'telegram:reply',
    'telegram:pin',
    'telegram:delete',
    'telegram:ban',
    'telegram:restrict',
    'telegram:set_chat_photo',
    'telegram:set_title',
    'telegram:set_description',
    'telegram:set_permissions',
    'telegram:export_invite',
  ];

  it('all chat-targeted actions have required chatId of type string', () => {
    for (const action of ACTIONS_WITH_CHAT_ID) {
      const schema = ACTION_SCHEMAS[action];
      expect(
        schema.parameters.chatId,
        `${action} missing chatId parameter`,
      ).toBeDefined();
      expect(
        schema.parameters.chatId.type,
        `${action} chatId should be string`,
      ).toBe('string');
      expect(
        schema.parameters.chatId.required,
        `${action} chatId should be required`,
      ).toBe(true);
    }
  });

  it('telegram:dm and telegram:announce do not have chatId', () => {
    expect(ACTION_SCHEMAS['telegram:dm'].parameters.chatId).toBeUndefined();
    expect(ACTION_SCHEMAS['telegram:announce'].parameters.chatId).toBeUndefined();
  });
});

// ─── Schema Structural Integrity (Telegram-specific) ────────────────────────

describe('Telegram schema structural integrity', () => {
  const TELEGRAM_ACTIONS = Object.keys(ACTION_SCHEMAS).filter(
    a => a.startsWith('telegram:'),
  );

  it('every telegram schema has a non-empty description', () => {
    for (const action of TELEGRAM_ACTIONS) {
      expect(
        ACTION_SCHEMAS[action].description.length,
        `${action} has empty description`,
      ).toBeGreaterThan(0);
    }
  });

  it('every telegram parameter has a valid type', () => {
    const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
    for (const action of TELEGRAM_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        expect(
          validTypes,
          `${action}.${paramName} has invalid type "${param.type}"`,
        ).toContain(param.type);
      }
    }
  });

  it('every telegram parameter has a non-empty description', () => {
    for (const action of TELEGRAM_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        expect(
          param.description.length,
          `${action}.${paramName} has empty description`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('no telegram action has array-type parameters without items', () => {
    for (const action of TELEGRAM_ACTIONS) {
      const params = ACTION_SCHEMAS[action].parameters;
      for (const [paramName, param] of Object.entries(params)) {
        if (param.type === 'array') {
          expect(
            param.items,
            `${action}.${paramName} is array type but missing items`,
          ).toBeDefined();
        }
      }
    }
  });
});

// ─── Full Registry Count ────────────────────────────────────────────────────

describe('Full schema registry with telegram', () => {
  it('total schema count includes all executor families', () => {
    const allActions = Object.keys(ACTION_SCHEMAS);
    const githubCount = allActions.filter(a => a.startsWith('github:')).length;
    const slackCount = allActions.filter(a => a.startsWith('slack:')).length;
    const eventCount = allActions.filter(a => a.startsWith('event:')).length;
    const repoCount = allActions.filter(a => a.startsWith('repo:')).length;
    const twitterCount = allActions.filter(a => a.startsWith('twitter:')).length;
    const xCount = allActions.filter(a => a.startsWith('x:')).length;
    const telegramCount = allActions.filter(a => a.startsWith('telegram:')).length;

    expect(githubCount).toBe(13);
    expect(slackCount).toBe(6);
    expect(eventCount).toBe(1);
    expect(repoCount).toBe(3);
    expect(twitterCount).toBe(12);
    expect(xCount).toBe(4);
    expect(telegramCount).toBe(13);

    // Total: 13 + 6 + 1 + 3 + 12 + 4 + 13 + 4 (task) + 3 (deploy) = 59
    expect(allActions.length).toBe(59);
  });
});
