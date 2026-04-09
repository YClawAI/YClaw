import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AO Agent Plugin: Claude Code (Headless one-shot)
 *
 * Launches Claude Code in -p (print) mode for one-shot execution.
 * Each task is a separate subprocess. Context persists in the workspace.
 * For multi-turn (CI fixes, reviews): re-spawn with accumulated context.
 */

/**
 * Resolve the latest installed version directory for a Claude Code plugin.
 * Plugin cache layout: basePath/<version>/ — returns the latest version path.
 */
function resolvePluginDir(basePath) {
  try {
    const versions = readdirSync(basePath);
    if (versions.length > 0) {
      versions.sort();
      return join(basePath, versions[versions.length - 1]);
    }
  } catch { /* plugin not installed */ }
  return null;
}

export const manifest = {
  name: 'claude-code-headless',
  slot: 'agent',
  description: 'Claude Code CLI in headless one-shot mode',
  version: '0.1.0',
  displayName: 'Claude Code (Headless)',
};

export function create() {
  return {
    name: 'claude-code-headless',
    processName: 'claude',
    promptDelivery: 'inline', // Prompt included in launch command via -p

    getLaunchCommand(config) {
      const parts = ['claude'];

      // Use direct API-key auth; avoid interactive auth/keychain flows.
      parts.push('--bare');

      // Permission bypass — required for autonomous operation
      parts.push('--dangerously-skip-permissions');

      // ── Claude Code Plugins (loaded explicitly for --bare mode) ──────
      // Superpowers: TDD, debugging methodology, brainstorming, code review
      const superpowersDir = resolvePluginDir('/home/ao/.claude/plugins/cache/claude-plugins-official/superpowers');
      if (superpowersDir) parts.push('--plugin-dir', superpowersDir);
      // Frontend Design: Anthropic's official distinctive UI generation
      const frontendDir = resolvePluginDir('/home/ao/.claude/plugins/cache/claude-code-plugins/frontend-design');
      if (frontendDir) parts.push('--plugin-dir', frontendDir);
      // Note: UI UX Pro Max is a skill (not a plugin) — auto-discovered
      // from ~/.claude/skills/ via SKILL.md even in --bare mode.

      // Output format for structured parsing
      parts.push('--output-format', 'json');

      // Max turns to prevent runaway sessions
      parts.push('--max-turns', '25');

      // Model selection
      if (config.model) {
        parts.push('--model', config.model);
      }

      // System prompt
      if (config.systemPromptFile) {
        try {
          const prompt = readFileSync(config.systemPromptFile, 'utf-8');
          if (prompt.trim()) {
            parts.push('--append-system-prompt', JSON.stringify(prompt));
          }
        } catch {
          // Best effort only — AO can still run without the appended prompt.
        }
      } else if (config.systemPrompt) {
        parts.push('--append-system-prompt', JSON.stringify(config.systemPrompt));
      }

      // The prompt itself (inline via -p)
      if (config.prompt) {
        parts.push('-p', JSON.stringify(config.prompt));
      }

      return parts.join(' ');
    },

    getEnvironment(config) {
      return {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        AO_SESSION_ID: config.sessionId,
        CLAUDECODE: '', // Unset to avoid nested agent conflicts
      };
    },

    detectActivity(terminalOutput) {
      // Claude Code -p outputs JSON and exits. No interactive detection needed.
      if (!terminalOutput.trim()) return 'idle';
      return 'active';
    },

    async getActivityState(session, readyThresholdMs) {
      if (!session.runtimeHandle) return { state: 'exited' };
      return null;
    },

    async isProcessRunning(handle) {
      if (!handle.data?.pid) return false;
      try {
        process.kill(handle.data.pid, 0);
        return true;
      } catch {
        return false;
      }
    },

    async getSessionInfo(session) {
      return {
        summary: null,
        agentSessionId: session.id,
        cost: undefined,
      };
    },

    async getRestoreCommand(session, project) {
      return null; // TODO: implement session resume
    },
  };
}

export default { manifest, create };
