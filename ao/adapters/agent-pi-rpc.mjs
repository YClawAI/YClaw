/**
 * AO Agent Plugin: Pi (RPC mode)
 *
 * Launches Pi coding agent in headless RPC mode.
 * Uses stdin/stdout JSON protocol for bidirectional communication.
 * Supports multi-turn: steer during work, follow_up after completion.
 */

export const manifest = {
  name: 'pi-rpc',
  slot: 'agent',
  description: 'Pi coding agent in headless RPC mode',
  version: '0.1.0',
  displayName: 'Pi (RPC)',
};

export function create() {
  return {
    name: 'pi-rpc',
    processName: 'pi',
    promptDelivery: 'post-launch', // Prompt sent via stdin after process starts

    getLaunchCommand(config) {
      const parts = ['pi', '--mode', 'rpc'];

      // No session persistence needed — AO manages state
      parts.push('--no-session');

      // Model selection
      if (config.model) {
        parts.push('--model', config.model);
      } else {
        // Default to Claude Sonnet via Anthropic provider
        parts.push('--provider', 'anthropic');
      }

      return parts.join(' ');
    },

    getEnvironment(config) {
      return {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        AO_SESSION_ID: config.sessionId,
      };
    },

    detectActivity(terminalOutput) {
      // For RPC mode, parse JSONL events
      const lines = terminalOutput.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]);
          switch (event.type) {
            case 'agent_start':
            case 'turn_start':
            case 'tool_execution_start':
            case 'tool_execution_update':
            case 'message_update':
              return 'active';
            case 'agent_end':
            case 'turn_end':
            case 'message_end':
              return 'ready';
            default:
              continue;
          }
        } catch {
          continue; // Not valid JSON, skip
        }
      }
      return 'idle';
    },

    async getActivityState(session, readyThresholdMs) {
      if (!session.runtimeHandle) return { state: 'exited' };
      return null; // Let lifecycle manager use isAlive() fallback
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
  };
}

export default { manifest, create };
