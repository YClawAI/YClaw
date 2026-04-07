-- Memory Architecture Phase 1 — Seed Categories
-- Content placeholders to be replaced with actual .md file contents during migration
-- Spec: Architect v1.1, Troy's decisions applied

-- ORG-LEVEL CATEGORIES (loaded by ALL agents)
INSERT INTO categories (category_key, scope, department_id, agent_id, content, version, tags, immutable, sort_order) VALUES
('org.identity',           'org', NULL, NULL, '', 1, '{"core","identity","immutable"}',        true,  10),
('org.authority',          'org', NULL, NULL, '', 1, '{"core","authority","immutable"}',        true,  20),
('org.product_knowledge',  'org', NULL, NULL, '', 1, '{"core","protocol","product"}',           true,  30),
('org.brand_voice',        'org', NULL, NULL, '', 1, '{"core","voice","brand","immutable"}',    true,  40),
('org.compliance',         'org', NULL, NULL, '', 1, '{"core","compliance","legal"}',            true,  45),
('org.processes.standup',  'org', NULL, NULL, '', 1, '{"process","standup","task_triggered"}',  false, 50);

-- DEPARTMENT-LEVEL CATEGORIES
INSERT INTO categories (category_key, scope, department_id, agent_id, content, version, tags, immutable, sort_order) VALUES
-- Executive
('dept.executive.directives',         'department', 'executive',   NULL, '', 1, '{"directives","executive"}',           false, 100),
('dept.executive.strategic_context',  'department', 'executive',   NULL, '', 1, '{"strategy","coordination"}',          false, 101),
-- Development
('dept.development.engineering',      'department', 'development', NULL, '', 1, '{"engineering","standards","code"}',    false, 110),
('dept.development.design_system',    'department', 'development', NULL, '', 1, '{"design","ui","components"}',          false, 111),
('dept.development.architecture',     'department', 'development', NULL, '', 1, '{"architecture","decisions","tech"}',   false, 112),
-- Marketing
('dept.marketing.content_perf',       'department', 'marketing',   NULL, '', 1, '{"content","performance","metrics"}',   false, 120),
('dept.marketing.audience',           'department', 'marketing',   NULL, '', 1, '{"audience","insights","growth"}',      false, 121),
-- Operations
('dept.operations.analytics',         'department', 'operations',  NULL, '', 1, '{"analytics","metrics","schema"}',      false, 130),
('dept.operations.infrastructure',    'department', 'operations',  NULL, '', 1, '{"infra","health","alerts"}',           false, 131),
-- Finance
('dept.finance.treasury',             'department', 'finance',     NULL, '', 1, '{"treasury","wallets","spend"}',        false, 140),
-- Support
('dept.support.knowledge',            'department', 'support',     NULL, '', 1, '{"faq","support","knowledge"}',         false, 150),
('dept.support.resolution_patterns',  'department', 'support',     NULL, '', 1, '{"patterns","resolution","issues"}',    false, 151);

-- PER-AGENT DEFAULT CATEGORIES (created for each of the 14 agents)
DO $$
DECLARE
  agent_rec RECORD;
  agent_list TEXT[] := ARRAY[
    'strategist','reviewer',
    'architect','builder','deployer','designer',
    'ember','forge','scout',
    'keeper','sentinel','signal',
    'treasurer',
    'guide'
  ];
  agent_name TEXT;
BEGIN
  FOREACH agent_name IN ARRAY agent_list LOOP
    INSERT INTO categories (category_key, scope, agent_id, content, version, tags, sort_order) VALUES
      ('agent.' || agent_name || '.directives',   'agent', agent_name, '', 1, '{"directives"}',   200),
      ('agent.' || agent_name || '.tasks',        'agent', agent_name, '', 1, '{"tasks"}',        201),
      ('agent.' || agent_name || '.lessons',      'agent', agent_name, '', 1, '{"lessons"}',      202),
      ('agent.' || agent_name || '.tools',        'agent', agent_name, '', 1, '{"tools"}',        203),
      ('agent.' || agent_name || '.blockers',     'agent', agent_name, '', 1, '{"blockers"}',     204),
      ('agent.' || agent_name || '.collaborations','agent', agent_name, '', 1, '{"collaborations"}',205),
      ('agent.' || agent_name || '.config',       'agent', agent_name, '', 1, '{"config"}',       206);
  END LOOP;
END $$;
