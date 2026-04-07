/**
 * Integration test: github:issue_labeled → evaluate_and_delegate path
 *
 * Verifies:
 *   1. The github:issue_labeled schema requires `label_added` (not the old `label` field)
 *   2. GitHubWebhookHandler emits `github:issue_labeled` with `label_added` in the payload
 *   3. The eligibility contract correctly reads `label_added` from the payload:
 *      - Eligible labels (🐛 bug, 🧪 QA, 🤖 ao-eligible) trigger delegation
 *      - Exclusion labels (needs-human, coordination, UI, security-sensitive) block it
 *      - in-progress label blocks it
 *
 * Follow-up from #925 — see PR #933 for the label → label_added field fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock logger (required by GitHubWebhookHandler + EventBus) ──────────────

vi.mock('../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

const { validateEventPayload, EVENT_SCHEMAS } = await import('../src/triggers/event-schemas.js');
const { GitHubWebhookHandler } = await import('../src/triggers/github-webhook.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal mock RepoRegistry that approves a single repo. */
function makeRegistry(fullName: string) {
  return {
    size: 1,
    has: (name: string) => name === fullName,
    getByFullName: (_name: string) => undefined,
  } as any;
}

/** Minimal mock EventBus that records publish calls. */
function makeEventBus() {
  const calls: Array<{ source: string; type: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    publish: vi.fn(async (source: string, type: string, payload: Record<string, unknown>) => {
      calls.push({ source, type, payload });
    }),
  } as any;
}

/** Build a GitHub `issues` webhook payload for a `labeled` action. */
function makeLabeledWebhookPayload(overrides: {
  issueNumber?: number;
  labelName?: string;
  issueLabels?: string[];
} = {}) {
  const {
    issueNumber = 100,
    labelName = '🐛 bug',
    issueLabels = ['🐛 bug'],
  } = overrides;

  return {
    action: 'labeled',
    label: { name: labelName },
    issue: {
      number: issueNumber,
      title: 'Test issue',
      body: 'Repro steps here',
      html_url: `https://github.com/your-org/yclaw/issues/${issueNumber}`,
      labels: issueLabels.map(name => ({ name })),
      assignee: null,
      assignees: [],
    },
    repository: {
      name: 'yclaw',
      full_name: 'your-org/yclaw',
      owner: { login: 'your-org' },
    },
    sender: { login: 'test-user' },
  };
}

// ─── 1. Schema validation ────────────────────────────────────────────────────

describe('github:issue_labeled schema', () => {
  it('is registered in EVENT_SCHEMAS with required fields [issue_number, label_added]', () => {
    const schema = EVENT_SCHEMAS['github:issue_labeled'];
    expect(schema).toBeDefined();
    expect(schema.required).toContain('issue_number');
    expect(schema.required).toContain('label_added');
  });

  it('passes validation when payload includes issue_number and label_added', () => {
    const result = validateEventPayload('github:issue_labeled', {
      issue_number: 936,
      label_added: '🐛 bug',
    });
    expect(result).toBeNull();
  });

  it('fails validation when label_added is missing (old "label" field name)', () => {
    const result = validateEventPayload('github:issue_labeled', {
      issue_number: 936,
      label: '🐛 bug', // wrong field name — this is the pre-#933 bug
    });
    expect(result).not.toBeNull();
    expect(result).toContain('label_added');
  });

  it('fails validation when issue_number is missing', () => {
    const result = validateEventPayload('github:issue_labeled', {
      label_added: '🐛 bug',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('issue_number');
  });

  it('passes with additional optional fields (title, body, url, labels, etc.)', () => {
    const result = validateEventPayload('github:issue_labeled', {
      issue_number: 936,
      label_added: '🤖 ao-eligible',
      title: 'Add feature X',
      body: 'Description',
      url: 'https://github.com/your-org/yclaw/issues/936',
      labels: ['🤖 ao-eligible', '🟡 P2'],
      owner: 'your-org',
      repo: 'yclaw',
      repo_full: 'your-org/yclaw',
    });
    expect(result).toBeNull();
  });
});

// ─── 2. Webhook handler → event bus integration ──────────────────────────────

describe('GitHubWebhookHandler: issues/labeled → github:issue_labeled', () => {
  let handler: InstanceType<typeof GitHubWebhookHandler>;
  let bus: ReturnType<typeof makeEventBus>;

  beforeEach(() => {
    bus = makeEventBus();
    handler = new GitHubWebhookHandler(bus, {
      registry: makeRegistry('your-org/yclaw'),
    });
  });

  it('publishes github:issue_labeled when action is labeled', async () => {
    const payload = makeLabeledWebhookPayload({ labelName: '🐛 bug', issueLabels: ['🐛 bug'] });
    const result = await handler.handleWebhook('issues', payload, 'delivery-001');

    expect(result.processed).toBe(true);
    expect(result.event).toBe('github:issue_labeled');
    expect(bus.calls).toHaveLength(1);

    const call = bus.calls[0];
    expect(call.source).toBe('github');
    expect(call.type).toBe('issue_labeled');
  });

  it('payload contains label_added (not "label")', async () => {
    const payload = makeLabeledWebhookPayload({ labelName: '🐛 bug', issueLabels: ['🐛 bug'] });
    await handler.handleWebhook('issues', payload, 'delivery-002');

    const published = bus.calls[0].payload;
    expect(published).toHaveProperty('label_added', '🐛 bug');
    expect(published).not.toHaveProperty('label'); // old field must not be present
  });

  it('payload passes schema validation after publish', async () => {
    const payload = makeLabeledWebhookPayload({
      issueNumber: 936,
      labelName: '🤖 ao-eligible',
      issueLabels: ['🤖 ao-eligible', '🟡 P2'],
    });
    await handler.handleWebhook('issues', payload, 'delivery-003');

    const published = bus.calls[0].payload;
    const validationErrors = validateEventPayload('github:issue_labeled', published);
    expect(validationErrors).toBeNull();
  });

  it('published payload includes issue_number, label_added, title, body, url, labels', async () => {
    const payload = makeLabeledWebhookPayload({
      issueNumber: 936,
      labelName: '🧪 QA',
      issueLabels: ['🧪 QA', '🟡 P2'],
    });
    await handler.handleWebhook('issues', payload, 'delivery-004');

    const published = bus.calls[0].payload;
    expect(published.issue_number).toBe(936);
    expect(published.label_added).toBe('🧪 QA');
    expect(published.title).toBe('Test issue');
    expect(published.body).toBe('Repro steps here');
    expect(published.url).toContain('issues/936');
    expect(published.labels).toContain('🧪 QA');
    expect(published.owner).toBe('your-org');
    expect(published.repo).toBe('yclaw');
    expect(published.repo_full).toBe('your-org/yclaw');
  });

  it('does not publish when action is not labeled', async () => {
    const payload = { ...makeLabeledWebhookPayload(), action: 'unlabeled' };
    const result = await handler.handleWebhook('issues', payload, 'delivery-005');

    expect(result.processed).toBe(false);
    expect(bus.calls).toHaveLength(0);
  });

  it('does not publish when label field is absent from payload', async () => {
    const payload = makeLabeledWebhookPayload() as any;
    delete payload.label; // simulate a malformed GitHub payload without the label object
    const result = await handler.handleWebhook('issues', payload, 'delivery-006');

    expect(result.processed).toBe(false);
    expect(bus.calls).toHaveLength(0);
  });
});

// ─── 3. Eligibility contract (label-based rules) ─────────────────────────────
//
// These tests mirror the evaluate_and_delegate eligibility contract defined in
// prompts/architect-workflow.md (§ "Eligibility Contract").
// They validate the contract at the data level — the label_added field must
// match an eligible label for delegation to proceed.

/** Returns true if label matches an eligible label for AO delegation. */
function isEligibleLabel(label: string): boolean {
  return ['bug', '🐛 bug', 'QA', '🧪 QA', 'ao-eligible', '🤖 ao-eligible'].includes(label);
}

/** Returns true if label matches an exclusion label that blocks delegation. */
function isExclusionLabel(label: string): boolean {
  return [
    'needs-human', '🙅 needs-human',
    'coordination', '🔗 coordination',
    'UI', '🎨 UI',
    'security-sensitive', '🔒 security-sensitive',
    'in-progress', '🚧 in-progress',
  ].includes(label);
}

/** Determine if an issue should be delegated given its labels and the newly-added label. */
function shouldDelegate(issueLabelNames: string[], labelAdded: string): boolean {
  if (!isEligibleLabel(labelAdded)) return false;
  if (issueLabelNames.some(isExclusionLabel)) return false;
  return true;
}

describe('evaluate_and_delegate eligibility contract', () => {
  describe('eligible labels trigger delegation', () => {
    it('🐛 bug label added → eligible', () => {
      expect(shouldDelegate(['🐛 bug', '🟡 P2'], '🐛 bug')).toBe(true);
    });

    it('🧪 QA label added → eligible', () => {
      expect(shouldDelegate(['🧪 QA'], '🧪 QA')).toBe(true);
    });

    it('🤖 ao-eligible label added → eligible', () => {
      expect(shouldDelegate(['🤖 ao-eligible'], '🤖 ao-eligible')).toBe(true);
    });

    it('bare "bug" label (no emoji) → eligible', () => {
      expect(shouldDelegate(['bug'], 'bug')).toBe(true);
    });

    it('bare "QA" label (no emoji) → eligible', () => {
      expect(shouldDelegate(['QA'], 'QA')).toBe(true);
    });

    it('bare "ao-eligible" label (no emoji) → eligible', () => {
      expect(shouldDelegate(['ao-eligible'], 'ao-eligible')).toBe(true);
    });
  });

  describe('exclusion labels block delegation', () => {
    it('needs-human present → blocked even if bug label was just added', () => {
      expect(shouldDelegate(['🐛 bug', '🙅 needs-human'], '🐛 bug')).toBe(false);
    });

    it('in-progress present → blocked (already being worked)', () => {
      expect(shouldDelegate(['🐛 bug', '🚧 in-progress'], '🐛 bug')).toBe(false);
    });

    it('coordination present → blocked', () => {
      expect(shouldDelegate(['🐛 bug', '🔗 coordination'], '🐛 bug')).toBe(false);
    });

    it('UI present → blocked', () => {
      expect(shouldDelegate(['🐛 bug', '🎨 UI'], '🐛 bug')).toBe(false);
    });

    it('security-sensitive present → blocked', () => {
      expect(shouldDelegate(['🐛 bug', '🔒 security-sensitive'], '🐛 bug')).toBe(false);
    });
  });

  describe('label_added field is what drives delegation (not historical labels)', () => {
    it('eligible label already on issue but non-eligible label was just added → NOT delegated', () => {
      // The issue already has 🐛 bug but a P2 label was just added.
      // The contract checks label_added, not the full label set.
      expect(shouldDelegate(['🐛 bug', '🟡 P2'], '🟡 P2')).toBe(false);
    });

    it('non-eligible label added to issue that has no eligible labels → NOT delegated', () => {
      expect(shouldDelegate(['🟡 P2'], '🟡 P2')).toBe(false);
    });
  });

  describe('end-to-end: webhook payload → eligibility check', () => {
    let handler: InstanceType<typeof GitHubWebhookHandler>;
    let bus: ReturnType<typeof makeEventBus>;

    beforeEach(() => {
      bus = makeEventBus();
      handler = new GitHubWebhookHandler(bus, {
        registry: makeRegistry('your-org/yclaw'),
      });
    });

    it('bug label webhook → published payload is eligible for delegation', async () => {
      const webhookPayload = makeLabeledWebhookPayload({
        labelName: '🐛 bug',
        issueLabels: ['🐛 bug', '🟡 P2'],
      });
      await handler.handleWebhook('issues', webhookPayload, 'delivery-e2e-001');

      const published = bus.calls[0].payload;
      const eligible = shouldDelegate(
        published.labels as string[],
        published.label_added as string,
      );
      expect(eligible).toBe(true);
    });

    it('QA label webhook → published payload is eligible for delegation', async () => {
      const webhookPayload = makeLabeledWebhookPayload({
        labelName: '🧪 QA',
        issueLabels: ['🧪 QA'],
      });
      await handler.handleWebhook('issues', webhookPayload, 'delivery-e2e-002');

      const published = bus.calls[0].payload;
      const eligible = shouldDelegate(
        published.labels as string[],
        published.label_added as string,
      );
      expect(eligible).toBe(true);
    });

    it('bug label + needs-human webhook → published payload is NOT eligible for delegation', async () => {
      const webhookPayload = makeLabeledWebhookPayload({
        labelName: '🐛 bug',
        issueLabels: ['🐛 bug', '🙅 needs-human'],
      });
      await handler.handleWebhook('issues', webhookPayload, 'delivery-e2e-003');

      const published = bus.calls[0].payload;
      const eligible = shouldDelegate(
        published.labels as string[],
        published.label_added as string,
      );
      expect(eligible).toBe(false);
    });

    it('ao-eligible label + in-progress webhook → published payload is NOT eligible for delegation', async () => {
      const webhookPayload = makeLabeledWebhookPayload({
        labelName: '🤖 ao-eligible',
        issueLabels: ['🤖 ao-eligible', '🚧 in-progress'],
      });
      await handler.handleWebhook('issues', webhookPayload, 'delivery-e2e-004');

      const published = bus.calls[0].payload;
      const eligible = shouldDelegate(
        published.labels as string[],
        published.label_added as string,
      );
      expect(eligible).toBe(false);
    });
  });
});
