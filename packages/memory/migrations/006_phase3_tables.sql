-- Phase 3: Strength+Sentiment, Triples, Episodes, Episode Search
-- Memory Architecture Phase 3 — "Advanced" tier modules

INSERT INTO schema_version (version, description) VALUES
  (6, 'Phase 3: strength/sentiment on items, triples, episodes, episode_items + embedding indexes')
ON CONFLICT (version) DO NOTHING;

-- ─── Module 2: Strength + Sentiment ──────────────────────────────────────
-- Decay-based confidence and emotional tone tracking on items.

DO $$ BEGIN
  ALTER TABLE items ADD COLUMN strength NUMERIC(4,3) NOT NULL DEFAULT 1.000;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE items ADD COLUMN sentiment TEXT CHECK (sentiment IN ('positive','negative','neutral','mixed'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE items ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE items ADD COLUMN last_accessed_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Index for decay-based retrieval (strongest first within confidence tier)
CREATE INDEX IF NOT EXISTS idx_items_strength ON items (agent_id, strength DESC)
  WHERE status = 'active';

-- ─── Module 4: Triples ───────────────────────────────────────────────────
-- Subject-Predicate-Object knowledge graph. Facts decomposed into structured triples.

CREATE TABLE IF NOT EXISTS triples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  source_type TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triples_agent ON triples (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples (agent_id, subject, status);
CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples (agent_id, predicate, status);
CREATE INDEX IF NOT EXISTS idx_triples_object ON triples (agent_id, object, status);
CREATE INDEX IF NOT EXISTS idx_triples_item ON triples (item_id);
-- Unique constraint: one active triple per agent+subject+predicate
CREATE UNIQUE INDEX IF NOT EXISTS idx_triples_unique_active
  ON triples (agent_id, subject, predicate) WHERE status = 'active';

ALTER TABLE triples ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY triple_agent_isolation ON triples
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Module 5: Episodes ──────────────────────────────────────────────────
-- Group related facts into coherent episodes (time-bounded narrative units).

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  fact_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(1536),
  tags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episodes_agent ON episodes (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_episodes_time ON episodes (agent_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_tags ON episodes USING gin(tags);

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY episode_agent_isolation ON episodes
    USING (agent_id = current_setting('app.agent_id'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Junction table: items ↔ episodes (many-to-many)
CREATE TABLE IF NOT EXISTS episode_items (
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_items_item ON episode_items (item_id);

-- ─── Module 12: Episode Search ───────────────────────────────────────────
-- Semantic search over episode summaries via pgvector.

CREATE INDEX IF NOT EXISTS idx_episodes_embedding ON episodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
