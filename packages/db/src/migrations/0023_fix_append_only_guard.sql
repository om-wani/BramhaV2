-- Migration: 0023_fix_append_only_guard
--
-- The append-only guard from 0006 tested pg_trigger_depth() > 0 to allow
-- FK-cascade deletes. But inside a directly-fired row trigger the depth is
-- already 1, so the exception branch was unreachable and conversation_nodes
-- accepted every UPDATE/DELETE — the append-only invariant was never
-- enforced (caught by the db test suite run against a live database).
--
-- Direct statement → depth 1 → reject. FK cascade (RI trigger → our
-- trigger) → depth 2 → allow.

CREATE OR REPLACE FUNCTION conversation_nodes_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'conversation_nodes is append-only';
END;
$$ LANGUAGE plpgsql;
