# 06 — UI / UX Specification

Screen-by-screen behavioral spec for the frontend (`apps/web`). Component names refer to
`02_project_structure.md`. All realtime behavior consumes the WS contract in
`05_data_model_and_schemas.md §10`.

---

## 1. Route map

```
/                       Landing (marketing)            public
/pricing                Pricing                        public
/login /register /verify /two-factor                   public (auth flows)
/dashboard              Project management dashboard   auth
/settings/{profile,security,api-keys}                  auth
/admin/**               Admin dashboard                auth + is_admin
/p/:projectId           Workspace lobby                auth + membership
/p/:projectId/conference                               Conference Room
/p/:projectId/meeting/:roomId                          Meeting Room
/p/:projectId/call/:agentId                            1:1 Call Room
/p/:projectId/office(/:noteId)                         CEO's Office
/p/:projectId/storage                                  Storage / Server Room
/p/:projectId/graph/:conversationId                    Conversation Graph View
/p/:projectId/settings                                 Project settings, members, sources
```

## 2. Workspace shell (`(app)/p/[projectId]/layout.tsx`)

- **Left nav rail ("the office corridor")**: icons+labels for Conference, Meetings (expandable
  list + "New meeting room"), 1:1 Calls (roster of hired C-Suite with presence dots), CEO's
  Office, Storage Room, Graph, Settings. Room entries show unread badges (from `user_room_state`).
- **Top bar**: project switcher, global search (⌘K — searches nodes, notes, files via API),
  token-budget meter (green→amber at 80% of daily budget→red pause state), user menu.
- **Right collapsible Activity Pane** (`BackgroundActivityPane`): live feed of delegation events
  (`delegation.*`), ingestion jobs (`ingest.*`), and approvals. Collapsed by default to a slim
  strip showing count of running background tasks with a subtle pulse. Each entry: worker persona
  avatar, objective (truncated), progress bar, elapsed, cancel button; approval entries render
  Approve/Deny inline. Clicking expands details incl. cost so far.
- **Presence provider**: joins `proj:{id}` presence channel; agent chips animate per
  `conv.agent.status`.

## 3. Chat rooms (shared core: Conference / Meeting / 1:1)

### 3.1 Layout

```
┌ RoomHeader: name, RosterBar (agent chips w/ status), branch selector, Graph-view button ┐
├──────────────────────────────────────────────┬───────────────────────────────────────────┤
│ MessageList (active branch, virtualized)     │ ArtifactPane (slides in when an artifact  │
│  · MessageBubble(user | per-agent color)     │  is created/opened; resizable; tabs per   │
│  · ThoughtsCollapse (streamed reasoning,     │  artifact; VersionSwitcher; Copy/Download) │
│    collapsed by default, live token ticker)  │                                           │
│  · StatusTag strip under streaming bubble    │                                           │
│  · BranchChips at fork points ("2 more       │                                           │
│    replies ▸") — click switches branch       │                                           │
│  · Inline file cards, artifact ref cards     │                                           │
├──────────────────────────────────────────────┴───────────────────────────────────────────┤
│ Composer: rich input, @mention menu (agents), / commands, FileDropzone (click/drag/paste)│
│           Stop button (appears while any agent streams), branch indicator                │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Behaviors (binding)

- **Async multi-speaker rendering**: multiple agents may stream simultaneously — each gets its own
  bubble appended in `conv.stream.*` arrival order; bubbles reflow when turns complete. Sibling
  replies (auto-fork §5.3 of 04-doc) render side-by-side in a horizontal swipe group with a
  "keep this thread" affordance.
- **Interrupt & summon**: Stop button → `interrupt.raise{reason:'stop'}` (per-agent from their
  chip, or global). Typing `@CTO` inserts a mention; sending it summons (scoring handles the
  rest). Agents summoning each other render a small system line: *"CMO called in the CTO."*
- **Thought streaming**: `channel:'thought'` deltas fill `ThoughtsCollapse` ("Thinking… ▸ 214
  tokens"); expanding shows raw reasoning stream; collapses automatically on completion. Persisted
  thoughts are viewable on demand (stored in node `content.meta.thoughts_key` → S3, lazy-loaded).
- **Status tags**: `conv.agent.status` renders pill labels exactly as emitted: `Invoking
  Sub-Agent`, `Reading Database via MCP`, `Running Code`, `Generating Artifact`,
  `Waiting for Approval` (amber, clickable → approval modal).
- **Branching UX**: hover any message → "⑂ Branch from here" → names a branch, composer now
  targets it; `BranchChips` navigate siblings; breadcrumb under RoomHeader shows
  `main ▸ alt: aggressive pricing`. Switching branches animates the list swap (150 ms crossfade),
  keeps scroll anchored to the fork point.
- **Uploads**: dropzone accepts pdf, docx, md, txt, csv, xlsx, png, jpg, webp, mp3, mp4, zip
  (≤ `MAX_UPLOAD_MB`, default 50). Card shows scan state machine: `Uploading → Scanning →
  Ready | Quarantined (red, tooltip: reason)`. Quarantined files are never downloadable and never
  reach agents.
- **Meeting room creation** (`CreateMeetingDialog`): pick agent subset (min 1), name, optional
  seed prompt; creates room + conversation, navigates in.
- **1:1 Call room**: auto-exists per hired agent; header shows persona bio card; proactive
  follow-ups (04-doc §2.4) appear as normal agent messages with a "follow-up" micro-badge.

## 4. Conversation Graph View (`/graph/:conversationId`)

- React Flow canvas; custom `NodeCard` (author avatar, 2-line preview, type icon, token cost on
  hover); edges: parent (solid), `node_links` references (dashed), branch heads flagged.
- Layout: `dagre` top-to-bottom, branches fanning right; minimap; zoom-to-branch buttons synced
  with `BranchChips`.
- Interactions: click node → side drawer with full content + "Open in room at this node" +
  "Branch from here"; drag-select → "Summarize selection" (utility tier) producing a
  `merge_summary` link node.
- Live: subscribes to the same bus channels; new nodes drop in with a spring animation.
- Performance: subtree pagination beyond 500 visible nodes ("Load 214 earlier nodes").

## 5. CEO's Office (`/office`)

- **Three-pane Obsidian-style layout**: folder/file tree (drag to reorder, folders = 
  `notes.folder_path`), TipTap editor center, right pane toggles Backlinks / Outline /
  Local graph (`GraphOfNotes` — React Flow of `note_links`).
- Editor: markdown shortcuts, `[[wikilink]]` autocomplete (creates `note_links` on save), tags
  `#like-this`, checkboxes, code blocks, image paste (goes through the same secure upload
  pipeline), daily-note button (creates `is_daily` note `YYYY-MM-DD`).
- **Silent knowledge sync**: debounced 5 s save → `note_delta` ingestion job → changed blocks
  re-embedded (05-doc §5). A tiny cloud icon in the editor footer shows `synced / syncing /
  sync failed`; NO other ceremony — the CEO just writes, the org remembers.
- Trash (soft delete) with 30-day restore.

## 6. Storage / Server Room (`/storage`)

```
┌ Toolbar: breadcrumb path, search, view toggle, [+ Connect source] [⬆ Upload] ┐
├ FileTree (left, 280px)      │ Item grid/list           │ PreviewPane (right) │
│  · Uploads/                 │  name, type icon, size,  │  pdf.js viewer      │
│  · Artifacts/               │  origin room chip, scan  │  code w/ highlight  │
│  · Conversation logs/       │  badge, ingested ✓       │  image/video/audio  │
│  · Notes (read-only mirror)/│                          │  csv table preview  │
│  · Sources/ (per connector) │                          │  metadata + chunks  │
│  · Quarantine/ (admin-ish)  │                          │  count + "Ask about │
└─────────────────────────────┴──────────────────────────┴───this file" button─┘
```

- Virtual folders are queries over `files`, `artifacts`, `notes`, `knowledge_sources` — not real
  paths; preview fetches via short-lived presigned GET.
- **Connect source dialog**: GitHub/GitLab repo (URL + PAT → stored as `credential_ref`, scope
  note shown), SQL database (host/db/user/pass → secrets manager; read-only requirement stated),
  URL/sitemap crawl, manual upload. Shows sync schedule picker and per-source ingestion history
  (`ingestion_jobs` list with status/errors).
- "Ask about this file" deep-links into Conference composer with a file reference chip attached.

## 7. Dashboards & shell pages

- **Landing**: hero ("Your AI C-Suite"), room metaphor illustration, feature triad (Council /
  Delegation / Memory), pricing teaser, footer. Static, no client JS beyond nav.
- **Auth pages**: email+password (zxcvbn strength meter), OAuth buttons, verify-email interstitial,
  TOTP challenge page. All forms Zod-validated client+server; generic error copy (no user
  enumeration).
- **Project dashboard** (`/dashboard`): project cards (name, member avatars, last activity,
  token spend sparkline, running-tasks count), "New project" wizard (name → template: blank /
  startup pack → hire C-Suite checklist).
- **Profile/settings**: display name, avatar (secure upload), email change (re-verify), password
  change, 2FA enrollment (QR + recovery codes shown ONCE), active sessions list with revoke,
  API keys (hashed at rest, prefix-identified `bmv2_...`, copy-once).
- **Project settings**: members+roles, agent roster hiring/firing, budgets (daily USD, context
  cap), agents-paused kill switch, danger zone (archive/delete with typed confirmation).
- **Admin dashboard** (`/admin`): user table (suspend/reset-2FA), persona editor (system prompt
  template, tags, speak profile — with live "compiled prompt" preview), ModelPolicy editor with
  provider/model dropdowns + cost estimates, connector registry + grant matrix
  (persona × connector × scope checkboxes + `requires_approval` toggles), diagnostics: token
  spend by project/model (charts), BullMQ queue depths, error rate, active sandbox count,
  audit-log search (filters: actor, action, project, date).

## 8. Artifact engine UX

- Creation: first `artifact.stream.chunk` slides the pane open (unless user pinned it closed),
  tab appears with kind icon + streaming progress ring; code renders with syntax highlight as it
  streams; `react`/`html` kinds show "Preview" (sandboxed iframe, spinner until `done`) and
  "Source" toggles.
- The iframe host (`ArtifactFrame`): `sandbox="allow-scripts"` ONLY (no same-origin, no top-nav,
  no forms/popups), `csp` attribute mirrored by server headers on the artifact-serving route,
  separate subdomain in prod, `postMessage` bridge (height, console logs relayed to a small
  console drawer, runtime errors surfaced as overlay).
- Versions: every agent update creates a version; `VersionSwitcher` = dropdown + prev/next; diff
  view for code kinds (Monaco diff, lazy-loaded).
- Chat linkage: artifact ref cards in messages ("📄 Pricing model v3") focus the pane tab.

## 9. Design system & quality bars

- Tokens: neutral dark-first palette; each C-Suite persona gets an accent from an 8-color
  accessible set (AA on both themes); statuses: amber=waiting/approval, red=error/quarantine,
  violet=thinking, green=done.
- Density: chat 15px/1.6; panes resizable with persisted sizes (localStorage per room).
- Keyboard: ⌘K palette, ⌘Enter send, `[` `]` toggle side panes, `g` then `c/o/s` room hops.
- a11y: full keyboard nav, aria-live="polite" for streaming bubbles (throttled announcements),
  focus rings, reduced-motion mode disables stream animations.
- Loading/empty/error states are specified deliverables for every page (skeletons for lists,
  friendly empty rooms: "The conference room is quiet. Say something to convene your council.").
- All times relative with absolute tooltip; all costs in USD to 4 decimals in admin, hidden from
  non-owner members if project setting `hide_costs=true`.
