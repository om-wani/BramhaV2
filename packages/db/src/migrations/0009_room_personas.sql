-- 0009 — multi-agent custom rooms
--
-- Rooms are now either the single 'council' conference (all 8 agents) or a
-- 'custom' room with an explicit set of agents. `personas` holds the agent
-- slugs for custom rooms (empty for council). The legacy 'one_on_one' kind
-- stays valid for back-compat (treated as a 1-agent custom room at runtime).

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_kind_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('council', 'one_on_one', 'custom'));
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS personas jsonb NOT NULL DEFAULT '[]'::jsonb;
