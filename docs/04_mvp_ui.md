# BramhaV2 — MVP UI Spec

## 1. Routes

```
(marketing)   /                          landing
(auth)        /login  /register          split-panel auth screens
(app — gated) /dashboard                 orgs + projects
              /orgs/new
              /p/[org]/[project]         project home (rooms + files)
              /p/[org]/[project]/files   file library
              /p/[org]/[project]/r/[roomId]   the room (core screen)
              /settings                  profile + password
```

Nothing else exists. No admin, connectors, approvals, standup, diagnostics — deleted from the tree, not hidden.

## 2. Design language

- Dark-first. Near-black canvas (`#0B0C0E` range), one indigo accent, generous whitespace, Inter.
- **Persona color is the identity system**: 8 CSS variables (`--persona-ceo` … `--persona-cdao`), used consistently for avatar rings, name chips, streaming cursors, branch-origin markers, relevance bars. A viewer should learn "amber = Ledger = CFO" within two turns.
- Components hand-written shadcn-style: Button, Input, Card, Dialog, DropdownMenu, Tooltip, Badge, Avatar, Skeleton.
- Motion: streaming text is the hero animation; everything else is subtle (150 ms fades). No layout shift when agents start/stop.

## 3. Landing `/`

Hero: **"Your AI C-suite is in session."** Sub: "Eight executive agents that know when to speak, remember what your company knows, and delegate to each other — in one room." Single CTA → `/register`. Below: three static product-shot cards (council selectivity, branching, citations). No pricing, no nav-bloat. This page is the demo's first 30 seconds.

## 4. Dashboard `/dashboard`

Sidebar: org switcher (dropdown), project list, settings link, user chip. Main: project cards (name, member count, room count, last activity). Empty state walks straight into org → project creation (two dialogs, prefilled slugs).

## 5. Project home `/p/[org]/[project]`

Two columns. Left: **Rooms** — list with name, kind badge (`Council` / `1:1 · Vulcan`), last-message preview, "New room" (dialog: name + kind + persona picker when 1:1). Right: **Memory** — recent files with status badges, dropzone, "All files →". Uploading here (not buried in the room) makes pillar 3 legible: *this project has a memory*.

## 6. The Room `/p/[org]/[project]/r/[roomId]` — core screen

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Q3 Strategy   ● Strategy Session      [branch: main ▾] [Council] │
├──────────┬─────────────────────────────────────────┬───────────────┤
│ BRANCHES │  THREAD (active branch)                 │ COUNCIL       │
│          │                                         │               │
│ ● main   │  You                                    │ ● Astra   .82 │
│ ├ pricing│  │ Given the research, what should      │ ● Ledger  .61 │
│ │  -alt  │  │ we prioritize in Q3?                 │ ● Vulcan  .48 │
│ └ cto-   │                                         │ ○ Meridian.31 │
│    deep  │  ◉ Astra · CEO                          │ ○ Iris    .12 │
│    dive  │  │ Three things matter this quarter…    │ ○ Lyra    .09 │
│          │  │ ┌───────────────────────────┐        │ ○ Sage    .07 │
│ [+ from  │  │ │ Source: market-research   │        │ ○ Orion   .05 │
│  node]   │  │ │ .pdf #4        ↗ preview  │        │               │
│          │  │ └───────────────────────────┘        │ silent = $0   │
│          │                                         │               │
│          │  ◉ Vulcan · CTO            ⑂ branch     ├───────────────┤
│          │  │ Feasibility-wise, the bottleneck…    │ FILES         │
│          │  │ ↳ delegated to Orion ▸               │ market-       │
│          │  │                                      │ research.pdf ✓│
│          │  ◉ Orion · CDAO  (↳ from Vulcan)        │               │
│          │  │ Based on the cohort data… ▌          │               │
│          │                                         │               │
│          ├─────────────────────────────────────────┤               │
│          │ [ Message the council…      @  ⏎ Send ] │               │
└──────────┴─────────────────────────────────────────┴───────────────┘
```

**Thread.** Message cards: persona avatar ring + name chip in persona color; sanitized markdown; hover reveals `⑂ Branch from here`. Streaming: colored cursor `▌`, composer stays enabled (queueing next message is fine — turns serialize server-side). Citation chips under the paragraph that used them; hover = chunk excerpt popover. Delegated nodes indent one level under the delegating node with `↳ from {persona}` badge. Artifact nodes render an iframe card (sandboxed, `allow-scripts`, null origin) with an expand dialog.

**Branch rail (left).** Tree of branches, active highlighted, fork points shown as connectors. Switching = instant thread swap (ancestry query is cheap; cache per branch). "＋ from node" mirrors the hover action.

**Council panel (right).** All 8 personas every turn, live from `turn:selection`: filled dot + score bar for speakers, dimmed for silent. Footer literally says **"silent = $0"** — the investor line, in the product. Collapsible; open by default in demo seed.

**Composer.** `@` popover for persona mentions (forces relevance override — demo lever). Enter sends; Shift+Enter newline.

## 7. Files `/p/[org]/[project]/files`

Table: name, size, status (`pending → processing → ready` live via `file:status`), chunk count, uploader, delete (owner/editor). Row click → side panel with first chunks and their text — makes "chunked + embedded" tangible for technical audiences.

## 8. Demo narrative — THE EXIT GATE

Pre-req: deployed URL, seeded demo org (`pnpm seed:demo`: account, org "Northwind", project "Q3 Strategy", `market-research.pdf` already `ready`, one backdated open loop in the Vulcan 1:1 room). A non-developer performs the following in ≤ 15 min:

1. **Log in** with seeded credentials → dashboard → open "Q3 Strategy". *(1 min)*
2. **Show memory.** Project home: point at `market-research.pdf ✓ ready`. Drag in one extra small .md file; watch status flip to processing → ready live. *(2 min)*
3. **Selective council.** Open "Strategy Session" (council room). Send: *"Based on the market research, what should we prioritize in Q3?"* → 3–4 personas stream in sequence; council panel shows 8 scores, silent members dimmed at $0. At least one response carries a citation chip; hover it → excerpt from the PDF. **Pillars 1 + 3.** *(4 min)*
4. **Override with mention.** Send: *"@iris does this plan create hiring risk?"* → Iris (silent before) responds; panel shows mention driving her score. *(1 min)*
5. **Branch.** Hover Vulcan's reply → `⑂ Branch from here` → name it `cto-deep-dive` → ask a technical follow-up → only Vulcan/Orion respond. Switch back to `main` — untouched. **Pillar 2.** *(3 min)*
6. **Delegation.** On main, send: *"Vulcan, have Orion size the data work for option two."* → Vulcan replies ending in delegation → Orion's indented result streams in under it with the `↳ from Vulcan` chain badge. **Pillar 4.** *(2 min)*
7. **Proactive close.** Open the Vulcan 1:1 room: a proactive follow-up on the backdated open loop is waiting (or fires on entry). "It comes back to you." *(1 min)*

Pass = all seven beats land on the deployed URL without developer intervention. This section is the acceptance test for P6 and the golden-path Playwright spec mirrors beats 1–6.
