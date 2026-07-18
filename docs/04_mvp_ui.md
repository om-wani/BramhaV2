# MVP UI Spec

## Route structure

```
(marketing)
  /                    Landing page

(auth)
  /register            Sign up
  /login               Sign in
  /logout              (action, redirects)

(app)  [auth-gated]
  /dashboard           Org + project list
  /orgs/new            Create org
  /p/[projectSlug]     Project home (rooms list + files)
  /p/[projectSlug]/r/[roomId]   Room / conversation view
  /p/[projectSlug]/files        File library
  /settings            User profile + password
```

Removed routes (not hidden, deleted): admin panel, source connectors, standup, approvals, diagnostics.

## Design system

- Dark-first. Background: `--bg-base: #0d0d0d`
- Accent: `--accent: #6366f1` (indigo)
- Persona accents: CSS variables `--persona-ceo`, `--persona-cto`, etc.
- Font: Inter (system fallback: ui-sans-serif)
- Components: hand-written shadcn-style (Button, Input, Card, Badge, Avatar, Tooltip, DropdownMenu, Dialog)
- Tailwind CSS with `@layer components` for persona chips

## Screen: Landing `/`

Hero: "Your AI C-Suite, always in session." 
Subheading: "A council of specialized AI executives that debate, delegate, and remember — built for founders who move fast."
CTA: "Start free" → `/register`
Three feature cards: Selective council · Branching threads · Org memory

## Screen: Dashboard `/dashboard`

Left sidebar: org switcher + project list.
Main: recent rooms grid. Empty state: "Create your first project."
Header: org name + user avatar + settings link.

## Screen: Project home `/p/[projectSlug]`

Two-column:
- Left: rooms list (name, last active, agent count badge). "New room" button.
- Right: file library preview (top 5 files, "View all" link).

## Screen: Room `/p/[projectSlug]/r/[roomId]`

```
┌──────────────────────────────────────────────────────────────┐
│  [← Project]  Room name          [Upload file]  [Branch ▾]  │
├───────────────────────┬──────────────────────────────────────┤
│                       │                                      │
│   DAG tree panel      │      Message thread                  │
│   (branch switcher)   │      (active branch)                 │
│                       │                                      │
│   [main ●]            │  ┌─ User ──────────────────────┐    │
│   └─ [branch-2]       │  │  What should we prioritize? │    │
│      └─ [branch-3]    │  └─────────────────────────────┘    │
│                       │  ┌─ Astra (CEO) ───────────────┐    │
│                       │  │  Focus on the core loop...  │    │
│                       │  └─────────────────────────────┘    │
│                       │  ┌─ Vulcan (CTO) ──────────────┐    │
│                       │  │  Technically, the bottleneck │    │
│                       │  │  ↳ delegated to Orion        │    │
│                       │  └─────────────────────────────┘    │
│                       │  ┌─ [streaming...] ────────────┐    │
│                       │  │  Orion (CDAO): Based on the │    │
│                       │  │  data... ▌                  │    │
│                       │  └─────────────────────────────┘    │
│                       │                                      │
│                       │  [Branch off this node]              │
│                       ├──────────────────────────────────────┤
│                       │  [Type a message...]        [Send]   │
└───────────────────────┴──────────────────────────────────────┘
```

**Message card anatomy:**
- Persona chip: colored dot + codename + role (e.g. `● Vulcan · CTO`)
- Content: markdown-rendered (sanitized)
- Citations: inline `[Source: filename.pdf, §3]` → hover tooltip with excerpt
- Delegation badge: `↳ delegated from Astra` on sub-task nodes
- "Branch off" button on hover (any node)
- Agent streaming: typewriter cursor `▌`, disabled send button during stream

**DAG tree panel:**
- Branch list (main + forks), active branch highlighted
- Click branch → switch thread view
- "New branch from here" button on any selected node

**Relevance sidebar** (collapsed by default, expandable):
- Shows this-turn agent scores
- Silent agents: greyed out with score
- Responding agents: score + why (mention/expertise/lexical)

## Screen: File library `/p/[projectSlug]/files`

Grid of uploaded files. Status badge: pending / processing / ready / error.
Upload dropzone (top). Click file → preview panel (text chunks, embedding status).
Delete button (owner only).

## Screen: Settings `/settings`

- Display name edit
- Password change (current + new + zxcvbn strength bar)
- No 2FA, no API keys in MVP

## Socket.IO events (client-side handling)

| Event | Payload | Action |
|-------|---------|--------|
| `message:created` | `{ node, branchId }` | Append node to thread |
| `message:delta` | `{ nodeId, delta, branchId }` | Append delta to streaming node |
| `message:error` | `{ nodeId, error }` | Show error state, discard partial |
| `branch:created` | `{ branch }` | Add branch to DAG panel |
| `file:status` | `{ fileId, status }` | Update file badge |

## Demo narrative (exit gate)

Non-developer runs this in ≤ 15 min on the deployed URL:

1. **Register** — create account, create org "AcmeCorp", create project "Q3 Strategy"
2. **Upload** — drag-drop a PDF (e.g. market research doc). Wait for "ready" badge.
3. **Ask the council** — open room "Strategy Session". Type: "Based on the market research, what should we prioritize for Q3?" Send.
4. **Watch council respond** — 3–4 personas respond in sequence, streaming. At least one cites the uploaded doc with `[Source: ...]`.
5. **Branch** — hover a node from Vulcan, click "Branch off". Type a follow-up technical question. See new branch with only CTO/CDAO responding.
6. **Delegate** — type "@astra delegate the security review to sage". Astra responds, Sage receives delegation, posts result as child node with delegation chain shown.
7. **Switch branches** — click back to main branch. Original thread intact.

All 4 essence pillars demonstrated: selective council (step 3–4), branching DAG (step 5), org memory/RAG (step 4 citation), delegation (step 6).
