/**
 * AO Agent Plugin: Codex (NOT YET IMPLEMENTED)
 *
 * TODO: Implement when Codex CLI interface is finalized.
 * Expected to follow similar one-shot pattern as Claude Code.
 *
 * IMPORTANT: This adapter is a placeholder. It is NOT registered in the AO plugin
 * registry (register-plugins.sh) and is NOT present in the bridge allowlist
 * (ao-bridge-server.mjs validAgents). Do not expose 'codex' as an orchestrator
 * option until this adapter is fully implemented and registered.
 */

export const manifest = {
  name: 'codex',
  slot: 'agent',
  description: 'OpenAI Codex CLI (NOT YET IMPLEMENTED – placeholder only)',
  version: '0.1.0',
  displayName: 'Codex',
};

export function create() {
  throw new Error(
    '[agent-codex] The Codex adapter is a placeholder and has not been implemented yet. ' +
    'Do not register or invoke this plugin until the adapter is complete.',
  );
}

export default { manifest, create };
