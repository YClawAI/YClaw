import type { AgentConfig } from '../../src/config/schema.js';

/**
 * Create a minimal set of mock AgentConfig objects for tests that
 * depend on the AgentRegistry being initialized.
 */
export function createMockAgentConfigs(): Map<string, AgentConfig> {
  const configs = new Map<string, AgentConfig>();

  const base = {
    description: 'test agent',
    model: {
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.3,
    },
    system_prompts: [],
    triggers: [],
    actions: [],
    data_sources: [],
    event_subscriptions: [],
    event_publications: [],
    review_bypass: [],
  };

  // All 13 production agents + librarian and mechanic
  const agents: Array<[string, string]> = [
    ['strategist', 'executive'],
    ['reviewer', 'executive'],
    ['architect', 'development'],
    ['designer', 'development'],
    ['mechanic', 'development'],
    ['ember', 'marketing'],
    ['forge', 'marketing'],
    ['scout', 'marketing'],
    ['sentinel', 'operations'],
    ['librarian', 'operations'],
    ['treasurer', 'finance'],
    ['guide', 'support'],
    ['keeper', 'support'],
    ['signal', 'operations'],
  ];

  for (const [name, department] of agents) {
    configs.set(name, { ...base, name, department: department as AgentConfig['department'] });
  }

  return configs;
}
