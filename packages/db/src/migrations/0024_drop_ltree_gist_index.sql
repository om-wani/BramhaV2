-- Migration: 0024_drop_ltree_gist_index
--
-- idx_conversation_nodes_conv_path (GiST over ltree path, from 0006) crashes
-- Postgres with "stack depth limit exceeded" once a linear conversation
-- chain passes ~63 nodes — GiST's recursive page-splitting on ltree blows the
-- 2MB default stack (reproduced live: 500 inserts fail at node 64 with the
-- index present, all 500 succeed with it dropped). One node per message means
-- any active conversation hit this wall almost immediately.
--
-- conversations.service.ts no longer runs `path @>`/`<@` ancestor queries —
-- they were replaced with a `WITH RECURSIVE ... parent_id` walk (plain btree
-- on the existing idx_conversation_nodes_conv_parent index). The `path`
-- column itself is kept for display/debug; only the GiST index is dropped.

DROP INDEX IF EXISTS idx_conversation_nodes_conv_path;
