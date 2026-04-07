-- Memory Architecture Phase 1 — Core Tables
-- Spec: Architect v1.1, approved by Troy via Elon
-- Date: 2026-02-21

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- TABLE: items
-- Atomic facts extracted from agent executions
-- ============================================
CREATE TABLE items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  fact_text     TEXT NOT NULL,
  confidence    NUMERIC(3,2) NOT NULL DEFAULT 0.70
                  CHECK (confidence >= 0.0 AND confidence <= 1.0),
  category_key  TEXT,
  source_type   TEXT NOT NULL DEFAULT 'execution',
  source_ref    TEXT,
  tags          TEXT[] DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_agent_id ON items(agent_id);
CREATE INDEX idx_items_category ON items(category_key);
CREATE INDEX idx_items_created ON items(created_at DESC);
CREATE INDEX idx_items_confidence ON items(confidence DESC);
CREATE INDEX idx_items_tags ON items USING GIN(tags);
CREATE INDEX idx_items_active ON items(agent_id, status) WHERE status = 'active';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TABLE: write_gate_log
-- Every Write Gate decision (accept + reject)
-- ============================================
CREATE TABLE write_gate_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  input_text    TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'conflict')),
  reject_reason TEXT,
  confidence    NUMERIC(3,2),
  category_key  TEXT,
  conflict_item_id UUID REFERENCES items(id),
  llm_model     TEXT NOT NULL DEFAULT 'claude-haiku',
  latency_ms    INTEGER,
  tokens_used   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wg_agent ON write_gate_log(agent_id);
CREATE INDEX idx_wg_decision ON write_gate_log(decision);
CREATE INDEX idx_wg_created ON write_gate_log(created_at DESC);

-- ============================================
-- TABLE: categories
-- Living summary documents per knowledge domain
-- v1.1: scope-based, tags, brand_voice org-level
-- ============================================
CREATE TYPE category_scope AS ENUM ('org', 'department', 'agent');

CREATE TABLE categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key    TEXT NOT NULL,
  scope           category_scope NOT NULL,
  department_id   TEXT,
  agent_id        TEXT,
  content         TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  tags            TEXT[] DEFAULT '{}',
  immutable       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_scope_org CHECK (
    scope != 'org' OR (department_id IS NULL AND agent_id IS NULL)
  ),
  CONSTRAINT chk_scope_dept CHECK (
    scope != 'department' OR (department_id IS NOT NULL AND agent_id IS NULL)
  ),
  CONSTRAINT chk_scope_agent CHECK (
    scope != 'agent' OR agent_id IS NOT NULL
  ),
  CONSTRAINT uq_category_scope UNIQUE (category_key, scope, department_id, agent_id)
);

CREATE INDEX idx_cat_scope ON categories(scope, sort_order);
CREATE INDEX idx_cat_dept ON categories(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX idx_cat_agent ON categories(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_cat_key ON categories(category_key);
CREATE INDEX idx_cat_tags ON categories USING GIN(tags);
CREATE INDEX idx_cat_updated ON categories(updated_at DESC);

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TABLE: category_archives
-- Version history for category rewrites
-- ============================================
CREATE TABLE category_archives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID NOT NULL REFERENCES categories(id),
  content         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by     TEXT NOT NULL
);

CREATE INDEX idx_archive_cat ON category_archives(category_id);
CREATE INDEX idx_archive_version ON category_archives(category_id, version DESC);

-- ============================================
-- ROW-LEVEL SECURITY
-- ============================================
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_agent_isolation ON items
  USING (agent_id = current_setting('app.agent_id'));

CREATE POLICY cat_org_read ON categories
  FOR SELECT USING (scope = 'org');

CREATE POLICY cat_dept_read ON categories
  FOR SELECT USING (
    scope = 'department'
    AND department_id = current_setting('app.department_id')
  );

CREATE POLICY cat_agent_read ON categories
  FOR SELECT USING (
    scope = 'agent'
    AND agent_id = current_setting('app.agent_id')
  );

CREATE POLICY cat_marketing_protocol_access ON categories
  FOR SELECT USING (
    current_setting('app.department_id') = 'marketing'
    AND scope = 'org'
    AND category_key IN ('org.product_knowledge')
  );

CREATE POLICY cat_write ON categories
  FOR INSERT WITH CHECK (
    current_setting('app.role', true) = 'write_gate'
  );

CREATE POLICY cat_update ON categories
  FOR UPDATE USING (
    current_setting('app.role', true) = 'write_gate'
    AND NOT immutable
  );
