-- Phase 2: Checkpoint, Resources, Dedup, Conflict Resolution
-- Memory Architecture Phase 2 — "Next" tier modules

-- Track migration
INSERT INTO schema_version (version, description) VALUES
  (5, 'Phase 2: checkpoints, resources, dedup_log, conflict_log tables + items columns')
ON CONFLICT (version) DO NOTHING;

-- ─── Module 1: Checkpoint ────────────────────────────────────────────────────
-- Session crash recovery and replay. Serialize execution state per turn.

CREATE TABLE IF NOT EXISTS checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  user_input JSONB,
  tool_calls JSONB,
  llm_output JSONB,
  internal_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints (session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON checkpoints (agent_id, created_at DESC);

ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY checkpoint_agent_isolation ON checkpoints
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Module 3: Resources ────────────────────────────────────────────────────
-- Append-only audit trail for all raw inputs.

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_metadata JSONB,
  conversation_id TEXT,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resources_agent ON resources (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_source ON resources (source_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resources_conversation ON resources (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_hash ON resources (content_hash);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY resource_agent_isolation ON resources
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Executive read-all for audit
DO $$ BEGIN
  CREATE POLICY resource_executive_read ON resources
    FOR SELECT USING (current_setting('app.role', true) = 'executive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add provenance link from items to resources
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN source_resource_id UUID REFERENCES resources(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── Module 6: Dedup ────────────────────────────────────────────────────────
-- Cosine similarity deduplication via pgvector.

-- pgvector should already be installed (CREATE EXTENSION vector ran in Phase 1 fix)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to items
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN embedding vector(1536);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_items_embedding ON items
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Dedup merge log
CREATE TABLE IF NOT EXISTS dedup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  surviving_item_id UUID REFERENCES items(id),
  merged_item_text TEXT NOT NULL,
  similarity_score NUMERIC(4,3) NOT NULL,
  confidence_before NUMERIC(3,2),
  confidence_after NUMERIC(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dedup_agent ON dedup_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dedup_surviving ON dedup_log (surviving_item_id);

ALTER TABLE dedup_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY dedup_agent_isolation ON dedup_log
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Module 11: Conflict Resolution ─────────────────────────────────────────
-- One-active-truth enforcement via subject+predicate extraction.

-- Add subject/predicate columns to items
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN subject TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN predicate TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN archived_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_items_subject_predicate ON items (agent_id, subject, predicate)
  WHERE status = 'active';

-- Conflict resolution log
CREATE TABLE IF NOT EXISTS conflict_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  archived_item_id UUID REFERENCES items(id),
  new_item_id UUID REFERENCES items(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflict_agent ON conflict_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_archived ON conflict_log (archived_item_id);
CREATE INDEX IF NOT EXISTS idx_conflict_new ON conflict_log (new_item_id);

ALTER TABLE conflict_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY conflict_agent_isolation ON conflict_log
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
