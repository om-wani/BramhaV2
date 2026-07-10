-- Migration: 0016_context_routing
-- Adds cross-room context routing support:
--   1. is_confidential flag on rooms (for call/1:1 rooms)
--
-- Note: working-memory facts routing metadata (sourceRoomId, sourceRoomConfidential, etc.)
-- is handled at the application layer via additive jsonb fields in the facts[] column.
-- No schema migration is needed for the facts jsonb — it is schema-flexible.

-- 1. rooms.is_confidential ────────────────────────────────────────────────────

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;

-- Allow bramha_app to toggle the confidentiality flag (UPDATE is already granted
-- on all columns via the rooms table grant; this explicit column grant is belt-and-
-- suspenders for environments that use column-level privileges).
GRANT UPDATE (is_confidential) ON rooms TO bramha_app;
