-- Phase 2 Prep: Make all DDL idempotent
-- Enables safe re-running of migrations during recovery/deployment

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_version (version, description) VALUES
  (1, 'Phase 1: Core tables (items, write_gate_log, categories, category_archives)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, description) VALUES
  (2, 'Phase 1: Seed categories (6 org + 12 dept + 98 agent)')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, description) VALUES
  (3, 'Phase 2 prep: write_gate_log RLS')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, description) VALUES
  (4, 'Phase 2 prep: idempotent DDL + schema_version tracking')
ON CONFLICT (version) DO NOTHING;

-- Make index creation idempotent (recreate only missing ones)
-- Items indexes
CREATE INDEX IF NOT EXISTS idx_items_agent_id ON items(agent_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_key);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_confidence ON items(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_items_tags ON items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(agent_id, status) WHERE status = 'active';

-- Write gate log indexes
CREATE INDEX IF NOT EXISTS idx_wg_agent ON write_gate_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_wg_decision ON write_gate_log(decision);
CREATE INDEX IF NOT EXISTS idx_wg_created ON write_gate_log(created_at DESC);

-- Categories indexes
CREATE INDEX IF NOT EXISTS idx_cat_scope ON categories(scope, sort_order);
CREATE INDEX IF NOT EXISTS idx_cat_dept ON categories(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cat_agent ON categories(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cat_key ON categories(category_key);
CREATE INDEX IF NOT EXISTS idx_cat_tags ON categories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_cat_updated ON categories(updated_at DESC);

-- Category archives indexes
CREATE INDEX IF NOT EXISTS idx_archive_cat ON category_archives(category_id);
CREATE INDEX IF NOT EXISTS idx_archive_version ON category_archives(category_id, version DESC);

-- Make seed categories idempotent (add ON CONFLICT to 002 pattern)
-- This doesn't re-run 002 but ensures future seeds are safe
-- The UNIQUE constraint uq_category_scope already exists on categories
