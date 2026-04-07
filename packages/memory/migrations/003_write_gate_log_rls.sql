-- Phase 2 Prep: Add RLS to write_gate_log table
-- Tech debt from Phase 1 — write_gate_log was missing RLS policies

ALTER TABLE write_gate_log ENABLE ROW LEVEL SECURITY;

-- Agents can only read their own gate decisions
CREATE POLICY wg_agent_read ON write_gate_log
  FOR SELECT USING (agent_id = current_setting('app.agent_id'));

-- Write gate role can insert log entries for any agent
CREATE POLICY wg_insert ON write_gate_log
  FOR INSERT WITH CHECK (
    current_setting('app.role', true) = 'write_gate'
    OR agent_id = current_setting('app.agent_id')
  );
