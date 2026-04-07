/**
 * Integration test: github:issue_labeled wiring
 *
 * Verifies that the GitHubWebhookHandler correctly publishes the
 * `label_added` field (not `label`) when processing an `issues:labeled`
 * webhook — matching the field name expected by the Architect's
 * evaluate_and_delegate task and the github:issue_labeled event schema.
 *
 * Regression for issue #925.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Minimal RepoRegistry stub ───────────────────────────────────────────────

function makeRegistry(fullNames: string[]) {
  const set = new Set(fullNames);
  return {
    has: (name: string) => set.has(name),
    get size() { return set.size; },
    getByFullName: () => undefined,
  };
}

// ─── Minimal EventBus spy ────────────────────────────────────────────────────

function makeEventBus() {
  const published: Array<{ source: string; type: string; payload: Record<string, unknown> }> = [];
  return {
    published,
    publish: vi.fn(async (source: string, type: string, payload: Record<string, unknown>) => {
      published.push({ source, type, payload });
    }),
  };
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeLabeledPayload(labelName: string) {
  return {
    action: 'labeled',
    label: { name: labelName },
    issue: {
      number: 42,
      title: 'Fix something',
      body: 'Description of the issue',
      html_url: 'https://github.com/your-org/yclaw/issues/42',
      labels: [{ name: labelName }],
      assignee: null,
      assignees: [],
      state: 'open',
    },
    repository: {
      name: 'yclaw',
      full_name: 'your-org/yclaw',
      owner: { login: 'your-org' },
    },
    sender: { login: 'human-user' },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const { GitHubWebhookHandler } = await import('../src/triggers/github-webhook.js');

describe('github:issue_labeled — wiring contract (issue #925)', () => {
  let eventBus: ReturnType<typeof makeEventBus>;
  let handler: InstanceType<typeof GitHubWebhookHandler>;

  beforeEach(() => {
    eventBus = makeEventBus();
    handler = new GitHubWebhookHandler(eventBus as any, {
      registry: makeRegistry(['your-org/yclaw']) as any,
    });
  });

  it('publishes github:issue_labeled with label_added field (not label)', async () => {
    const result = await handler.handleWebhook(
      'issues',
      makeLabeledPayload('🤖 ao-eligible') as any,
      'delivery-001',
    );

    expect(result.processed).toBe(true);
    expect(result.event).toBe('github:issue_labeled');

    expect(eventBus.published).toHaveLength(1);
    const { source, type, payload } = eventBus.published[0];
    expect(source).toBe('github');
    expect(type).toBe('issue_labeled');

    // ── The critical wiring assertion ──
    // The Architect evaluate_and_delegate task reads `label_added` from the
    // event payload. The publisher MUST set `label_added`, not `label`.
    expect(payload).toHaveProperty('label_added', '🤖 ao-eligible');
    expect(payload).not.toHaveProperty('label'); // old broken field name
  });

  it('label_added matches the specific label that was added (not the full labels array)', async () => {
    // Issue already has two labels; only one was just added
    const payload: any = {
      ...makeLabeledPayload('🐛 bug'),
      issue: {
        ...makeLabeledPayload('🐛 bug').issue,
        labels: [{ name: '🐛 bug' }, { name: '🟡 P2' }],
      },
    };

    await handler.handleWebhook('issues', payload, 'delivery-002');

    const published = eventBus.published[0];
    expect(published.payload['label_added']).toBe('🐛 bug');
    // `labels` contains ALL current labels on the issue
    expect(published.payload['labels']).toEqual(['🐛 bug', '🟡 P2']);
  });

  it('does not publish when label field is missing from webhook payload', async () => {
    const noLabelPayload: any = {
      action: 'labeled',
      // label field intentionally absent (malformed webhook)
      issue: makeLabeledPayload('bug').issue,
      repository: makeLabeledPayload('bug').repository,
      sender: { login: 'human-user' },
    };

    const result = await handler.handleWebhook('issues', noLabelPayload, 'delivery-003');

    expect(result.processed).toBe(false);
    expect(eventBus.published).toHaveLength(0);
  });

  it('event schema requires label_added field', async () => {
    // Verify the schema contract in event-schemas.ts
    const { EVENT_SCHEMAS, validateEventPayload } = await import('../src/triggers/event-schemas.js');

    const schema = EVENT_SCHEMAS['github:issue_labeled'];
    expect(schema).toBeDefined();
    expect(schema!.required).toContain('label_added');
    expect(schema!.required).not.toContain('label');

    // Payload with label_added passes validation
    expect(validateEventPayload('github:issue_labeled', {
      issue_number: 42,
      label_added: 'bug',
    })).toBeNull();

    // Payload missing label_added fails validation
    expect(validateEventPayload('github:issue_labeled', {
      issue_number: 42,
    })).toEqual(['label_added']);
  });
});
