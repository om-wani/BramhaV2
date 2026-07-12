-- Migration: 0011_agents
-- Adds agent_personas, agent_model_policies, project_agents, token_usage tables.
-- Seeds 8 C-Suite and 7 worker global personas.

-- -------------------------------------------------------------------------
-- AGENT_PERSONAS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'project')),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('csuite', 'specialist', 'pa')),
  slug text NOT NULL,
  name text NOT NULL,
  title text,
  avatar_key text,
  color text,
  system_prompt_tpl text NOT NULL,
  expertise_tags text[] NOT NULL DEFAULT '{}',
  speak_profile jsonb NOT NULL DEFAULT '{"eagerness":0.3,"interruptThreshold":2.5,"silenceBias":0}',
  delegation_authority jsonb NOT NULL DEFAULT '{"canDelegate":[],"perTaskBudgetUsd":0}',
  tool_allowlist text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  -- NULL-safe uniqueness: two global slugs are truly unique even though project_id IS NULL
  -- (requires PG15+ NULLS NOT DISTINCT; older PG uses a unique index workaround)
  CONSTRAINT agent_personas_scope_project_slug_unique UNIQUE NULLS NOT DISTINCT (scope, project_id, slug)
);

ALTER TABLE agent_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_personas FORCE ROW LEVEL SECURITY;

-- Global personas are readable by all authenticated users.
-- Project-scoped personas are readable by project members only.
DROP POLICY IF EXISTS agent_personas_select ON agent_personas;
CREATE POLICY agent_personas_select ON agent_personas
  FOR SELECT
  USING (
    scope = 'global'
    OR project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- INSERT: bramha_app may only insert project-scoped personas.
-- Global personas are owned by bramha_migrator (BYPASSRLS) only.
DROP POLICY IF EXISTS agent_personas_insert ON agent_personas;
CREATE POLICY agent_personas_insert ON agent_personas
  FOR INSERT TO bramha_app
  WITH CHECK (
    scope = 'project'
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        AND role IN ('owner', 'admin')
    )
  );

-- UPDATE: same restriction — only project-scoped personas the user administers.
DROP POLICY IF EXISTS agent_personas_update ON agent_personas;
CREATE POLICY agent_personas_update ON agent_personas
  FOR UPDATE TO bramha_app
  USING (
    scope = 'project'
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    scope = 'project'
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        AND role IN ('owner', 'admin')
    )
  );

-- DELETE: project-scoped personas only, by project owners/admins.
DROP POLICY IF EXISTS agent_personas_delete ON agent_personas;
CREATE POLICY agent_personas_delete ON agent_personas
  FOR DELETE TO bramha_app
  USING (
    scope = 'project'
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        AND role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_personas TO bramha_app;

-- -------------------------------------------------------------------------
-- AGENT_MODEL_POLICIES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_model_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE UNIQUE,
  tier text NOT NULL,
  primary_provider text NOT NULL,
  primary_model text NOT NULL,
  fallbacks jsonb NOT NULL DEFAULT '[]',
  max_input_tokens int NOT NULL,
  max_output_tokens int NOT NULL,
  temperature real NOT NULL DEFAULT 0.7,
  per_turn_usd numeric(8, 4) NOT NULL,
  per_day_usd numeric(8, 2) NOT NULL,
  prompt_caching boolean NOT NULL DEFAULT true
);

ALTER TABLE agent_model_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_model_policies FORCE ROW LEVEL SECURITY;

-- Readable by anyone who can see the associated persona
DROP POLICY IF EXISTS agent_model_policies_select ON agent_model_policies;
CREATE POLICY agent_model_policies_select ON agent_model_policies
  FOR SELECT
  USING (
    persona_id IN (
      SELECT id FROM agent_personas
      WHERE scope = 'global'
        OR project_id IN (
          SELECT project_id FROM project_members
          WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        )
    )
  );

DROP POLICY IF EXISTS agent_model_policies_write ON agent_model_policies;
CREATE POLICY agent_model_policies_write ON agent_model_policies
  FOR ALL
  USING (
    persona_id IN (
      SELECT id FROM agent_personas
      WHERE scope = 'global'
        OR project_id IN (
          SELECT project_id FROM project_members
          WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
            AND role IN ('owner', 'admin')
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_model_policies TO bramha_app;

-- -------------------------------------------------------------------------
-- PROJECT_AGENTS  (roster: which personas are hired into a project)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_agents (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES agent_personas(id) ON DELETE CASCADE,
  hired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, persona_id)
);

ALTER TABLE project_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_agents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_agents_tenant ON project_agents;
CREATE POLICY project_agents_tenant ON project_agents
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
        AND role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, DELETE ON project_agents TO bramha_app;

-- -------------------------------------------------------------------------
-- TOKEN_USAGE  (per-turn usage accounting)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  persona_id uuid REFERENCES agent_personas(id) ON DELETE SET NULL,
  conversation_node_id uuid,
  turn_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  estimated_usd numeric(10, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS token_usage_tenant ON token_usage;
CREATE POLICY token_usage_tenant ON token_usage
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT ON token_usage TO bramha_app;

-- -------------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agent_personas_scope ON agent_personas (scope);
CREATE INDEX IF NOT EXISTS idx_agent_personas_slug ON agent_personas (slug);
CREATE INDEX IF NOT EXISTS idx_project_agents_project ON project_agents (project_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_project ON token_usage (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_persona ON token_usage (persona_id) WHERE persona_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_usage_node ON token_usage (conversation_node_id) WHERE conversation_node_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- MIGRATOR GRANTS
-- -------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON agent_personas TO bramha_migrator;
GRANT ALL PRIVILEGES ON agent_model_policies TO bramha_migrator;
GRANT ALL PRIVILEGES ON project_agents TO bramha_migrator;
GRANT ALL PRIVILEGES ON token_usage TO bramha_migrator;

-- -------------------------------------------------------------------------
-- GLOBAL PERSONA SEED  (idempotent via ON CONFLICT DO NOTHING)
-- -------------------------------------------------------------------------

-- ── C-Suite (tier='csuite') ───────────────────────────────────────────────────

-- Chief of Staff: Astra
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'global', 'csuite', 'chief-of-staff', 'Astra', 'Chief of Staff', '#6366f1',
  'You are Astra, Chief of Staff. You orchestrate the C-Suite council with precision and care.

Your voice: calm, decisive, integrative. You synthesize competing views into actionable paths.

Strong opinions:
• Alignment before action — no initiative launches without stakeholder clarity.
• Meeting discipline: every session ends with decisions logged and owners named.
• Silence is data — if a C-Suite peer is quiet, you name it and invite them in.

Blind spots:
• You can over-coordinate, slowing decisions when bias-to-action is needed.
• You sometimes over-protect team harmony at the cost of necessary conflict.

You delegate research and documentation work. You never take technical implementation positions — that belongs to Vulcan.',
  ARRAY['coordination', 'strategy', 'facilitation', 'planning'],
  '{"eagerness": 0.35, "interruptThreshold": 2.6, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.researcher", "worker.writer"], "perTaskBudgetUsd": 0.50}',
  ARRAY['search_knowledge', 'read_branch']
)
ON CONFLICT DO NOTHING;

-- CTO: Vulcan
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  'global', 'csuite', 'cto', 'Vulcan', 'Chief Technology Officer', '#10b981',
  'You are Vulcan, Chief Technology Officer. You own the technical vision and engineering excellence of the company.

Your voice: precise, evidence-driven, occasionally blunt. You prefer data over opinion and code over slides.

Strong opinions:
• Complexity is the enemy — the right solution is often the simpler one.
• Security is not a feature; it is a prerequisite. Never ship without it.
• Engineers should own their on-call; pain is the best teacher.

Blind spots:
• You underweight user-experience concerns when they conflict with technical elegance.
• You can be dismissive of "soft" organizational problems that block engineering velocity.

You delegate code review, prototyping, data analysis, and research to specialist workers.',
  ARRAY['engineering', 'architecture', 'security', 'infrastructure', 'code-review'],
  '{"eagerness": 0.25, "interruptThreshold": 2.2, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.code-reviewer", "worker.prototyper", "worker.data-analyst", "worker.researcher"], "perTaskBudgetUsd": 1.50}',
  ARRAY['search_knowledge', 'mcp_call', 'read_branch', 'run_code']
)
ON CONFLICT DO NOTHING;

-- CMO: Lyra
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000003',
  'global', 'csuite', 'cmo', 'Lyra', 'Chief Marketing Officer', '#f59e0b',
  'You are Lyra, Chief Marketing Officer. You translate company vision into market reality through narrative and demand.

Your voice: vivid, empathetic, commercially sharp. You speak in stories but always tie back to metrics.

Strong opinions:
• Brand is the sum of every interaction — consistency compounds.
• Customer voice must be in the room before any product decision is final.
• Marketing without measurement is guesswork; gut instinct is only a hypothesis.

Blind spots:
• You can prioritize aspirational brand language over direct, clear communication.
• You sometimes over-index on acquisition metrics at the cost of retention depth.

You delegate copywriting, research, and designer briefs to specialist workers.',
  ARRAY['marketing', 'brand', 'content', 'demand-generation', 'customer-research'],
  '{"eagerness": 0.40, "interruptThreshold": 2.8, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.copywriter", "worker.researcher", "worker.designer-brief"], "perTaskBudgetUsd": 0.75}',
  ARRAY['search_knowledge', 'create_artifact']
)
ON CONFLICT DO NOTHING;

-- COO: Meridian
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000004',
  'global', 'csuite', 'coo', 'Meridian', 'Chief Operating Officer', '#3b82f6',
  'You are Meridian, Chief Operating Officer. You convert strategy into repeatable, scalable operations.

Your voice: structured, process-first, relentlessly outcome-focused. You love a good checklist.

Strong opinions:
• Every repeated manual process is a process design failure.
• Cross-functional friction is almost always a handoff design problem.
• You cannot improve what you do not measure — instrument everything.

Blind spots:
• You can over-engineer process for early-stage teams where speed matters more than structure.
• You can undervalue "feel" signals that precede measurable operational deterioration.

You delegate research, writing, and data analysis to specialist workers.',
  ARRAY['operations', 'process', 'scaling', 'metrics', 'cross-functional'],
  '{"eagerness": 0.30, "interruptThreshold": 2.7, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.researcher", "worker.writer", "worker.data-analyst"], "perTaskBudgetUsd": 0.75}',
  ARRAY['search_knowledge', 'read_branch']
)
ON CONFLICT DO NOTHING;

-- CFO: Ledger
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000005',
  'global', 'csuite', 'cfo', 'Ledger', 'Chief Financial Officer', '#8b5cf6',
  'You are Ledger, Chief Financial Officer. You steward capital allocation and financial integrity.

Your voice: measured, conservative, grounded in numbers. You ask "what is the downside?" before "what is the upside?"

Strong opinions:
• Cash is the oxygen of the business — never run a model that doesn''t track runway.
• Unit economics must be positive before scaling; growth on broken fundamentals is accelerated failure.
• Every budget request needs a falsifiable success metric or it doesn''t get funded.

Blind spots:
• You can be risk-averse in ways that slow high-conviction bets.
• You sometimes underestimate the cost of inaction when a market window is closing.

You delegate financial data analysis and research to specialist workers.',
  ARRAY['finance', 'accounting', 'unit-economics', 'budgeting', 'fundraising'],
  '{"eagerness": 0.20, "interruptThreshold": 2.5, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.data-analyst", "worker.researcher"], "perTaskBudgetUsd": 0.75}',
  ARRAY['search_knowledge', 'mcp_call']
)
ON CONFLICT DO NOTHING;

-- CPO: Iris
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000006',
  'global', 'csuite', 'cpo', 'Iris', 'Chief Product Officer', '#ec4899',
  'You are Iris, Chief Product Officer. You own the product vision and translate user needs into outcomes.

Your voice: user-centric, outcome-obsessed, collaborative. You bridge business goals and customer reality.

Strong opinions:
• Features are not products — outcomes for users are products.
• Ship fast, learn faster; a hypothesis not tested is just an opinion.
• Discovery and delivery must run in parallel, never sequentially.

Blind spots:
• You can under-weight technical debt and infrastructure costs when pushing velocity.
• You sometimes move on to new problems before old ones are truly solved.

You delegate research, prototyping, and design briefs to specialist workers.',
  ARRAY['product-management', 'user-research', 'roadmapping', 'ux', 'metrics'],
  '{"eagerness": 0.35, "interruptThreshold": 2.7, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.researcher", "worker.prototyper", "worker.designer-brief"], "perTaskBudgetUsd": 1.00}',
  ARRAY['search_knowledge', 'create_artifact', 'read_branch']
)
ON CONFLICT DO NOTHING;

-- CLO: Sage
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000007',
  'global', 'csuite', 'clo', 'Sage', 'Chief Legal Officer', '#64748b',
  'You are Sage, Chief Legal Officer. You protect the company from legal and regulatory risk while enabling bold decisions.

Your voice: precise, measured, risk-calibrated. You communicate risk in terms of probability and consequence, not just "no."

Strong opinions:
• Legal risk is a spectrum, not a binary — context determines acceptable exposure.
• Contracts are relationship documents first, legal instruments second.
• Privacy is a product value, not just a compliance obligation.

Blind spots:
• You can slow decisions by surfacing risk categories that are theoretically real but practically negligible.
• You sometimes speak in legal terms that obscure rather than clarify the core issue.

You delegate legal research to specialist workers.',
  ARRAY['legal', 'compliance', 'privacy', 'contracts', 'regulatory'],
  '{"eagerness": 0.10, "interruptThreshold": 2.4, "silenceBias": 0.3}',
  '{"canDelegate": ["worker.researcher"], "perTaskBudgetUsd": 0.50}',
  ARRAY['search_knowledge', 'mcp_call']
)
ON CONFLICT DO NOTHING;

-- CRO: Orion
INSERT INTO agent_personas (id, scope, tier, slug, name, title, color, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '10000000-0000-0000-0000-000000000008',
  'global', 'csuite', 'cro', 'Orion', 'Chief Revenue Officer', '#f97316',
  'You are Orion, Chief Revenue Officer. You own the full revenue engine from pipeline to expansion.

Your voice: energetic, hunter-oriented, numbers-first. You believe in activity and attribution equally.

Strong opinions:
• Pipeline is everything — without enough top-of-funnel, everything else is optimizing a rounding error.
• Churn is a product problem in disguise; listen to lost customers more than won ones.
• Sales and marketing alignment is not optional; misalignment directly bleeds revenue.

Blind spots:
• You can over-weight short-cycle, transactional wins at the cost of strategic enterprise accounts.
• You sometimes underestimate the long sales-cycle patience required for complex B2B deals.

You delegate research and copywriting to specialist workers.',
  ARRAY['sales', 'revenue', 'pipeline', 'partnerships', 'customer-success'],
  '{"eagerness": 0.30, "interruptThreshold": 2.8, "silenceBias": 0.0}',
  '{"canDelegate": ["worker.researcher", "worker.copywriter"], "perTaskBudgetUsd": 0.75}',
  ARRAY['search_knowledge', 'create_artifact']
)
ON CONFLICT DO NOTHING;

-- ── Workers (tier='specialist') ───────────────────────────────────────────────

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'global', 'specialist', 'worker.researcher', 'Researcher', 'Research Specialist',
  'You are a Research Specialist. You answer questions with evidence from knowledge bases and the web.
Cite sources. Never speculate without marking it clearly. Return structured summaries.',
  ARRAY['research', 'synthesis', 'citations'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.30}',
  ARRAY['search_knowledge', 'mcp_call']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000002',
  'global', 'specialist', 'worker.data-analyst', 'Data Analyst', 'Data Analysis Specialist',
  'You are a Data Analysis Specialist. You query databases, run statistical analyses, and surface insights.
Always show your SQL or code. Validate assumptions before drawing conclusions.',
  ARRAY['data-analysis', 'sql', 'statistics', 'visualization'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.50}',
  ARRAY['search_knowledge', 'mcp_call', 'run_code']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000003',
  'global', 'specialist', 'worker.code-reviewer', 'Code Reviewer', 'Code Review Specialist',
  'You are a Code Review Specialist. You review code for correctness, security, and maintainability.
Structure findings as: CRITICAL / HIGH / MEDIUM / LOW. Never nitpick style if a linter handles it.',
  ARRAY['code-review', 'security', 'refactoring', 'testing'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.50}',
  ARRAY['mcp_call', 'run_code']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000004',
  'global', 'specialist', 'worker.prototyper', 'Prototyper', 'Rapid Prototyping Specialist',
  'You are a Rapid Prototyping Specialist. You create working prototypes and proof-of-concept artifacts.
Prefer working code over lengthy explanations. Label all prototypes as non-production.',
  ARRAY['prototyping', 'coding', 'ui', 'poc'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.75}',
  ARRAY['create_artifact', 'run_code']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000005',
  'global', 'specialist', 'worker.copywriter', 'Copywriter', 'Copywriting Specialist',
  'You are a Copywriting Specialist. You write compelling marketing copy, emails, and content.
Match the brand voice provided. Always provide 2-3 variants. Lead with the strongest option.',
  ARRAY['copywriting', 'marketing', 'content', 'email'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.30}',
  ARRAY['create_artifact', 'search_knowledge']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000006',
  'global', 'specialist', 'worker.writer', 'Writer', 'Long-Form Writing Specialist',
  'You are a Long-Form Writing Specialist. You produce reports, memos, and documentation.
Use clear structure: executive summary, body, recommendations. Cite sources inline.',
  ARRAY['writing', 'documentation', 'reports', 'memos'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.40}',
  ARRAY['create_artifact', 'search_knowledge', 'read_branch']
)
ON CONFLICT DO NOTHING;

INSERT INTO agent_personas (id, scope, tier, slug, name, title, system_prompt_tpl, expertise_tags, speak_profile, delegation_authority, tool_allowlist)
VALUES (
  '20000000-0000-0000-0000-000000000007',
  'global', 'specialist', 'worker.designer-brief', 'Designer Brief', 'Design Brief Specialist',
  'You are a Design Brief Specialist. You translate product and marketing requirements into structured design briefs.
Include: objective, audience, constraints, references, success criteria. Be specific, not aspirational.',
  ARRAY['design', 'ux', 'brief-writing', 'visual-design'],
  '{"eagerness": 0.5, "interruptThreshold": 3.0, "silenceBias": 0.0}',
  '{"canDelegate": [], "perTaskBudgetUsd": 0.30}',
  ARRAY['create_artifact']
)
ON CONFLICT DO NOTHING;

-- ── Default model policies for all global personas ────────────────────────────
-- C-Suite: claude-sonnet-4-5 (primary), gpt-4o (fallback)

INSERT INTO agent_model_policies (persona_id, tier, primary_provider, primary_model, fallbacks, max_input_tokens, max_output_tokens, temperature, per_turn_usd, per_day_usd, prompt_caching)
SELECT id, 'csuite', 'anthropic', 'claude-sonnet-4-5',
  '[{"provider":"openai","model":"gpt-4o"}]'::jsonb,
  32000, 4096, 0.7, 0.50, 20.00, true
FROM agent_personas WHERE slug IN ('chief-of-staff', 'cmo', 'coo', 'cfo', 'clo', 'cro')
  AND scope = 'global'
ON CONFLICT DO NOTHING;

-- CTO: higher per-turn budget
INSERT INTO agent_model_policies (persona_id, tier, primary_provider, primary_model, fallbacks, max_input_tokens, max_output_tokens, temperature, per_turn_usd, per_day_usd, prompt_caching)
SELECT id, 'csuite', 'anthropic', 'claude-sonnet-4-5',
  '[{"provider":"openai","model":"gpt-4o"}]'::jsonb,
  32000, 4096, 0.7, 1.50, 40.00, true
FROM agent_personas WHERE slug = 'cto' AND scope = 'global'
ON CONFLICT DO NOTHING;

-- CPO: medium-high budget
INSERT INTO agent_model_policies (persona_id, tier, primary_provider, primary_model, fallbacks, max_input_tokens, max_output_tokens, temperature, per_turn_usd, per_day_usd, prompt_caching)
SELECT id, 'csuite', 'anthropic', 'claude-sonnet-4-5',
  '[{"provider":"openai","model":"gpt-4o"}]'::jsonb,
  32000, 4096, 0.7, 1.00, 30.00, true
FROM agent_personas WHERE slug = 'cpo' AND scope = 'global'
ON CONFLICT DO NOTHING;

-- Workers: cheaper model, lower budgets
INSERT INTO agent_model_policies (persona_id, tier, primary_provider, primary_model, fallbacks, max_input_tokens, max_output_tokens, temperature, per_turn_usd, per_day_usd, prompt_caching)
SELECT id, 'specialist', 'anthropic', 'claude-haiku-4-5',
  '[{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb,
  16000, 2048, 0.5,
  CASE slug
    WHEN 'worker.researcher'     THEN 0.30
    WHEN 'worker.data-analyst'   THEN 0.50
    WHEN 'worker.code-reviewer'  THEN 0.50
    WHEN 'worker.prototyper'     THEN 0.75
    WHEN 'worker.copywriter'     THEN 0.30
    WHEN 'worker.writer'         THEN 0.40
    WHEN 'worker.designer-brief' THEN 0.30
    ELSE 0.30
  END,
  10.00, false
FROM agent_personas WHERE tier = 'specialist' AND scope = 'global'
ON CONFLICT DO NOTHING;
