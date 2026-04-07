import type { ToolDefinition } from '../config/schema.js';

// ─── Self-Modification Tools ──────────────────────────────────────────────────

export const SELF_MOD_TOOLS: ToolDefinition[] = [
  {
    name: 'self.read_config',
    description: 'Read your own YAML configuration file',
    parameters: {},
  },
  {
    name: 'self.read_prompt',
    description: 'Read one of your system prompt files',
    parameters: {
      name: { type: 'string', description: 'Prompt filename (e.g., "brand-voice.md")', required: true },
    },
  },
  {
    name: 'self.read_source',
    description: 'Read a runtime source code file',
    parameters: {
      path: { type: 'string', description: 'Source file path relative to project root', required: true },
    },
  },
  {
    name: 'self.read_history',
    description: 'Read your recent execution history',
    parameters: {
      limit: { type: 'number', description: 'Number of recent executions to retrieve (default: 10)' },
    },
  },
  {
    name: 'self.read_org_chart',
    description: 'Read the full organization structure and event topology',
    parameters: {},
  },
  {
    name: 'self.update_config',
    description: 'Modify your own YAML configuration (auto-approved, logged)',
    parameters: {
      changes: { type: 'object', description: 'Key-value pairs to merge into your config', required: true },
    },
  },
  {
    name: 'self.update_prompt',
    description: 'Modify one of your system prompts (reviewed by REVIEWER)',
    parameters: {
      name: { type: 'string', description: 'Prompt filename to modify', required: true },
      content: { type: 'string', description: 'New content for the prompt (or section to append)', required: true },
      mode: { type: 'string', description: '"replace" or "append" (default: append)' },
    },
  },
  {
    name: 'self.update_schedule',
    description: 'Change your own cron schedule (auto-approved, logged)',
    parameters: {
      task: { type: 'string', description: 'Task name whose schedule to change', required: true },
      schedule: { type: 'string', description: 'New cron expression', required: true },
    },
  },
  {
    name: 'self.update_model',
    description: 'Switch your own LLM model (auto-approved, logged)',
    parameters: {
      provider: { type: 'string', description: 'LLM provider (anthropic, openrouter, ollama)', required: true },
      model: { type: 'string', description: 'Model identifier', required: true },
    },
  },
  {
    name: 'self.request_new_data_source',
    description: 'Request a new MCP tool or API endpoint (flagged to Development department)',
    parameters: {
      description: { type: 'string', description: 'What data you need and why', required: true },
      suggestedSource: { type: 'string', description: 'Suggested API or data source' },
    },
  },
  {
    name: 'self.memory_read',
    description: 'Read from your persistent agent memory',
    parameters: {
      key: { type: 'string', description: 'Memory key to read (or omit for all memory)', },
    },
  },
  {
    name: 'self.memory_write',
    description: 'Write to your persistent agent memory (auto-approved, logged)',
    parameters: {
      key: { type: 'string', description: 'Memory key to write', required: true },
      value: { type: 'string', description: 'Value to store', required: true },
    },
  },
  {
    name: 'self.search_memory',
    description: 'Search past executions, agent memory, and reviews across the organization. Read-only.',
    parameters: {
      query: { type: 'string', description: 'What to search for', required: true },
      scope: { type: 'string', description: '"self", "department", or "all" (default: "department"). Non-executive agents are limited to department scope.' },
      limit: { type: 'number', description: 'Max results to return (default: 10)' },
    },
  },
  {
    name: 'self.cross_write_memory',
    description: 'Write a memory key/value into another agent\'s memory. Executive department only.',
    parameters: {
      target_agent: { type: 'string', description: 'The agent to write memory into', required: true },
      key: { type: 'string', description: 'Memory key to write', required: true },
      value: { type: 'string', description: 'Value to store', required: true },
    },
  },
];

// ─── Review Tool ──────────────────────────────────────────────────────────────

export const REVIEW_TOOL: ToolDefinition = {
  name: 'submit_for_review',
  description: 'Submit content for brand review before publishing externally. Required for all external content.',
  parameters: {
    content: { type: 'string', description: 'The content to review', required: true },
    contentType: { type: 'string', description: 'Content type (e.g., "x_thread", "tg_message", "ig_post", "outreach_dm")', required: true },
    targetPlatform: { type: 'string', description: 'Target platform (x, telegram, instagram, tiktok, email)', required: true },
    metadata: { type: 'object', description: 'Additional context for the reviewer' },
  },
};
