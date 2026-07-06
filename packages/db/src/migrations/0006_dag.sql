-- Migration: 0006_dag
-- Adds conversation DAG tables: rooms, room_participants, conversations,
-- conversation_nodes (append-only), node_links, branches, user_room_state.
-- Includes: ltree materialised paths, append-only trigger, depth/path trigger,
-- cycle-guard trigger, and full RLS policies on all 7 tables.

-- -------------------------------------------------------------------------
-- EXTENSIONS
-- -------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS ltree;
-- btree_gist allows mixing btree (uuid) + gist (ltree) in one GiST index
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -------------------------------------------------------------------------
-- ROOMS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        text        NOT NULL
                          CHECK (type IN ('conference','meeting','call','office','system')),
  name        text        NOT NULL,
  created_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_rooms_project_id ON rooms (project_id);

-- Only one 'conference' room per project
CREATE UNIQUE INDEX IF NOT EXISTS rooms_conference_unique
  ON rooms (project_id, type) WHERE type = 'conference';

-- -------------------------------------------------------------------------
-- ROOM_PARTICIPANTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_participants (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_kind text        NOT NULL
                               CHECK (participant_kind IN ('user','agent')),
  user_id          uuid        REFERENCES users(id) ON DELETE CASCADE,
  -- persona_id: no FK — agent_personas table doesn't exist until Phase 3
  persona_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_participants_kind_check
    CHECK ((participant_kind = 'user') = (user_id IS NOT NULL)),
  -- An agent participant must always have a persona_id (even though no FK yet — Phase 3)
  CONSTRAINT room_participants_agent_check
    CHECK (participant_kind != 'agent' OR persona_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_room_participants_room_id
  ON room_participants (room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id
  ON room_participants (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_participants_persona_id
  ON room_participants (persona_id) WHERE persona_id IS NOT NULL;

-- Unique user participant per room
CREATE UNIQUE INDEX IF NOT EXISTS room_participants_user_unique
  ON room_participants (room_id, user_id) WHERE user_id IS NOT NULL;

-- Unique agent participant per room
CREATE UNIQUE INDEX IF NOT EXISTS room_participants_agent_unique
  ON room_participants (room_id, persona_id) WHERE persona_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- CONVERSATIONS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id           uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- project_id denormalised for RLS + hot-path filters
  project_id        uuid        NOT NULL,
  title             text,
  -- default_branch_id FK to branches deferred (circular — branches references conversations)
  default_branch_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_conversations_room_id    ON conversations (room_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations (project_id);

-- -------------------------------------------------------------------------
-- CONVERSATION_NODES  (APPEND-ONLY)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_nodes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- project_id denormalised for RLS + hot-path filters
  project_id        uuid        NOT NULL,
  -- NULL = root node; self-referential FK
  parent_id         uuid        REFERENCES conversation_nodes(id),
  -- depth and path are maintained by the BEFORE INSERT trigger below
  depth             int         NOT NULL DEFAULT 0,
  path              ltree       NOT NULL DEFAULT '_',
  type              text        NOT NULL
                                CHECK (type IN (
                                  'user_message','agent_message','system_event','interrupt',
                                  'summon','delegation_report','artifact_ref','file_ref',
                                  'branch_point_marker'
                                )),
  author_kind       text        NOT NULL
                                CHECK (author_kind IN ('user','agent','system')),
  author_user_id    uuid,
  author_persona_id uuid,
  content           jsonb       NOT NULL,
  token_usage       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
  -- NO updated_at — append-only; any change means a new node
);

-- GiST index for efficient ltree ancestor/descendant queries scoped to a conversation
CREATE INDEX IF NOT EXISTS idx_conversation_nodes_conv_path
  ON conversation_nodes USING GIST (conversation_id, path);
-- B-tree index for parent lookup
CREATE INDEX IF NOT EXISTS idx_conversation_nodes_conv_parent
  ON conversation_nodes (conversation_id, parent_id);
-- B-tree index for project-scoped time-ordered reads
CREATE INDEX IF NOT EXISTS idx_conversation_nodes_project_created
  ON conversation_nodes (project_id, created_at);

-- -------------------------------------------------------------------------
-- TRIGGER: Append-only guard — reject any UPDATE or DELETE
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION conversation_nodes_append_only()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow cascaded deletes triggered by parent table cleanup (e.g. hard project delete).
  -- pg_trigger_depth() > 0 means we are inside another trigger's execution, i.e. a cascade.
  IF pg_trigger_depth() > 0 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'conversation_nodes is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER conversation_nodes_no_update_delete
  BEFORE UPDATE OR DELETE ON conversation_nodes
  FOR EACH ROW EXECUTE FUNCTION conversation_nodes_append_only();

-- -------------------------------------------------------------------------
-- TRIGGER: Maintain depth + ltree path on INSERT
-- ltree labels must match [A-Za-z0-9_]+; UUID hyphens become underscores.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION conversation_nodes_set_depth_path()
RETURNS TRIGGER AS $$
DECLARE
  v_id_label     text;
  v_parent_depth int;
  v_parent_path  ltree;
BEGIN
  v_id_label := replace(NEW.id::text, '-', '_');

  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    NEW.path  := v_id_label::ltree;
  ELSE
    SELECT depth, path
      INTO v_parent_depth, v_parent_path
      FROM conversation_nodes
     WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent node % does not exist', NEW.parent_id;
    END IF;

    NEW.depth := v_parent_depth + 1;
    NEW.path  := v_parent_path || v_id_label::ltree;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Must fire BEFORE the append-only trigger to avoid the exception
-- (set_depth_path runs on INSERT; append_only only blocks UPDATE/DELETE — no conflict)
CREATE OR REPLACE TRIGGER conversation_nodes_before_insert
  BEFORE INSERT ON conversation_nodes
  FOR EACH ROW EXECUTE FUNCTION conversation_nodes_set_depth_path();

-- -------------------------------------------------------------------------
-- NODE_LINKS  (cross-branch references — full DAG edges)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_links (
  from_node uuid NOT NULL REFERENCES conversation_nodes(id) ON DELETE CASCADE,
  to_node   uuid NOT NULL REFERENCES conversation_nodes(id) ON DELETE CASCADE,
  kind      text NOT NULL
            CHECK (kind IN ('reference','merge_summary','duplicate_of')),
  PRIMARY KEY (from_node, to_node)
);

CREATE INDEX IF NOT EXISTS idx_node_links_to_node ON node_links (to_node);

-- -------------------------------------------------------------------------
-- TRIGGER: Cycle guard on node_links INSERT — BFS up to 10 000 hops
-- Prevents directed cycles: if to_node can reach from_node via existing
-- forward edges, the new edge would close a cycle.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION node_links_cycle_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_frontier  uuid[];
  v_visited   uuid[];
  v_head      uuid;
  v_neighbor  uuid;
  v_neighbors uuid[];
  v_count     int := 0;
BEGIN
  IF NEW.from_node = NEW.to_node THEN
    RAISE EXCEPTION 'cycle detected: self-loop on node %', NEW.from_node;
  END IF;

  -- BFS from to_node following outgoing edges.
  -- If we reach from_node, adding from_node→to_node closes a cycle.
  v_frontier := ARRAY[NEW.to_node];
  v_visited  := ARRAY[NEW.to_node];

  WHILE array_length(v_frontier, 1) IS NOT NULL AND v_count < 10000 LOOP
    v_head     := v_frontier[1];
    v_frontier := v_frontier[2:array_length(v_frontier, 1)];

    SELECT array_agg(nl.to_node)
      INTO v_neighbors
      FROM node_links nl
     WHERE nl.from_node = v_head;

    IF v_neighbors IS NOT NULL THEN
      FOREACH v_neighbor IN ARRAY v_neighbors LOOP
        IF v_neighbor = NEW.from_node THEN
          RAISE EXCEPTION 'cycle detected: adding edge %→% would create a cycle',
            NEW.from_node, NEW.to_node;
        END IF;
        IF NOT (v_neighbor = ANY(v_visited)) THEN
          v_visited  := array_append(v_visited, v_neighbor);
          v_frontier := array_append(v_frontier, v_neighbor);
        END IF;
      END LOOP;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- If the frontier is non-empty when the limit is hit, the graph is too large to verify safely.
  IF v_count >= 10000 AND array_length(v_frontier, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'node_links cycle check traversal limit exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER node_links_before_insert_cycle_check
  BEFORE INSERT ON node_links
  FOR EACH ROW EXECUTE FUNCTION node_links_cycle_guard();

-- -------------------------------------------------------------------------
-- BRANCHES  (git-ref-like named leaf pointers)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL,
  name             text        NOT NULL,
  head_node_id     uuid        NOT NULL REFERENCES conversation_nodes(id),
  forked_from_node uuid        REFERENCES conversation_nodes(id),
  created_by_kind  text        NOT NULL
                               CHECK (created_by_kind IN ('user','agent','system')),
  created_by_id    uuid,
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','merged','abandoned')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, name)
);

CREATE OR REPLACE TRIGGER branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_branches_conversation_id ON branches (conversation_id);
CREATE INDEX IF NOT EXISTS idx_branches_project_id      ON branches (project_id);

-- Now that branches exists, add the deferred FK from conversations → branches
-- (circular: conversations → branches → conversation_nodes → conversations)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'conversations_default_branch_id_fk'
       AND table_name = 'conversations'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_default_branch_id_fk
      FOREIGN KEY (default_branch_id) REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- USER_ROOM_STATE  (read cursors, active branch, collapsed panes)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_room_state (
  user_id           uuid NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  room_id           uuid NOT NULL REFERENCES rooms(id)          ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES conversations(id)  ON DELETE CASCADE,
  active_branch_id  uuid REFERENCES branches(id)                ON DELETE SET NULL,
  last_read_node_id uuid REFERENCES conversation_nodes(id)      ON DELETE SET NULL,
  PRIMARY KEY (user_id, room_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_user_room_state_user_id ON user_room_state (user_id);

-- -------------------------------------------------------------------------
-- ENABLE & FORCE ROW LEVEL SECURITY
-- -------------------------------------------------------------------------
ALTER TABLE rooms              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms              FORCE  ROW LEVEL SECURITY;

ALTER TABLE room_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants  FORCE  ROW LEVEL SECURITY;

ALTER TABLE conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations      FORCE  ROW LEVEL SECURITY;

ALTER TABLE conversation_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_nodes FORCE  ROW LEVEL SECURITY;

ALTER TABLE node_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_links         FORCE  ROW LEVEL SECURITY;

ALTER TABLE branches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches           FORCE  ROW LEVEL SECURITY;

ALTER TABLE user_room_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_room_state    FORCE  ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- RLS POLICIES  (bramha_app role; NULLIF guards against empty GUC string)
-- -------------------------------------------------------------------------

-- Rooms: project must be one the user is a member of
DROP POLICY IF EXISTS rooms_isolation ON rooms;
CREATE POLICY rooms_isolation ON rooms
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Room participants: room must be in a project the user is a member of
DROP POLICY IF EXISTS room_participants_isolation ON room_participants;
CREATE POLICY room_participants_isolation ON room_participants
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    room_id IN (
      SELECT r.id FROM rooms r
       WHERE r.project_id IN (
         SELECT pm.project_id FROM project_members pm
          WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
       )
    )
  );

-- Conversations: project must be one the user is a member of
DROP POLICY IF EXISTS conversations_isolation ON conversations;
CREATE POLICY conversations_isolation ON conversations
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Conversation nodes: project must be one the user is a member of
DROP POLICY IF EXISTS conversation_nodes_isolation ON conversation_nodes;
CREATE POLICY conversation_nodes_isolation ON conversation_nodes
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Node links: from_node must be in a node the user can see (project membership).
-- WITH CHECK also restricts to_node so cross-project links cannot be inserted.
DROP POLICY IF EXISTS node_links_isolation ON node_links;
CREATE POLICY node_links_isolation ON node_links
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    from_node IN (
      SELECT cn.id FROM conversation_nodes cn
       WHERE cn.project_id IN (
         SELECT pm.project_id FROM project_members pm
          WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
       )
    )
  )
  WITH CHECK (
    from_node IN (
      SELECT cn.id FROM conversation_nodes cn
       WHERE cn.project_id IN (
         SELECT pm.project_id FROM project_members pm
          WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
       )
    )
    AND to_node IN (
      SELECT cn2.id FROM conversation_nodes cn2
       WHERE cn2.project_id IN (
         SELECT pm2.project_id FROM project_members pm2
          WHERE pm2.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
       )
    )
  );

-- Branches: project must be one the user is a member of
DROP POLICY IF EXISTS branches_isolation ON branches;
CREATE POLICY branches_isolation ON branches
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- User room state: own rows only
DROP POLICY IF EXISTS user_room_state_isolation ON user_room_state;
CREATE POLICY user_room_state_isolation ON user_room_state
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
  );

-- -------------------------------------------------------------------------
-- PERMISSIONS
-- -------------------------------------------------------------------------
-- bramha_app: conversation_nodes is SELECT+INSERT only (append-only enforced by trigger)
GRANT SELECT, INSERT, UPDATE, DELETE ON rooms              TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON room_participants  TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations      TO bramha_app;
GRANT SELECT, INSERT                 ON conversation_nodes TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON node_links         TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON branches           TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_room_state    TO bramha_app;

GRANT ALL PRIVILEGES ON rooms              TO bramha_migrator;
GRANT ALL PRIVILEGES ON room_participants  TO bramha_migrator;
GRANT ALL PRIVILEGES ON conversations      TO bramha_migrator;
GRANT ALL PRIVILEGES ON conversation_nodes TO bramha_migrator;
GRANT ALL PRIVILEGES ON node_links         TO bramha_migrator;
GRANT ALL PRIVILEGES ON branches           TO bramha_migrator;
GRANT ALL PRIVILEGES ON user_room_state    TO bramha_migrator;
