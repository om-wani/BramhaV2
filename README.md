# BramhaV2 — Multi-Agentic AI Business Operating System (BOS)

> A virtual headquarters where the user is the **CEO** and an AI **C-Suite** is their council.
> Hierarchical agent orchestration: C-Suite agents plan, strategize, and execute small tasks directly;
> they delegate complex work to specialist worker agents; lightweight algorithmic **PA agents** keep
> every executive perfectly briefed — without burning tokens.

---

## 1. What this repository contains (right now)

This repository currently contains the **complete planning & documentation suite** for BramhaV2,
written for an autonomous **Implementation Agent** (an AI coding assistant) to execute end-to-end.
There is no application code yet — the documents below ARE the deliverable of the planning phase and
the single source of truth for the build phase.

## 2. Product vision in one paragraph

The user creates **Projects**. Each project is a spatial workspace modeled on a physical office:
a **Conference Room** (all C-Suite agents + user), dynamic **Meeting Rooms** (user + a chosen subset
of executives), **1:1 Call Rooms** (user + one agent), the **CEO's Office** (an Obsidian-style
markdown mind-dump space whose content silently feeds the knowledge layer), and the
**Storage / Server Room** (a file-explorer-with-preview over every artifact, upload, log, and
connected knowledge source). Conversations are **non-linear DAGs** — any message can be branched,
threads run in parallel, and agents speak asynchronously, interrupt, and summon each other while
background delegation runs without blocking the chat. The chat renders **Artifacts** (code, docs,
live UI components) in a sandboxed side pane, Claude-style.

## 3. Reading order for the Implementation Agent

Read the documents **in numeric order**. Later documents assume the vocabulary and decisions of the
earlier ones. The four documents marked ★ are the core mandated deliverables.

| # | File | Purpose |
|---|------|---------|
| 1 | ★ [`docs/01_architecture_and_stack.md`](docs/01_architecture_and_stack.md) | Tech stack + rationale, C4-style system map, dataflows, security boundaries, model-agnostic LLM layer, token-frugality strategy |
| 2 | ★ [`docs/02_project_structure.md`](docs/02_project_structure.md) | Full annotated monorepo directory tree (apps, packages, infra, CI) |
| 3 | [`docs/05_data_model_and_schemas.md`](docs/05_data_model_and_schemas.md) | Column-level DDL for every table, DAG conversation model, pgvector layout, RLS policies, Zod event/WS contracts |
| 4 | ★ [`docs/04_agent_orchestration_spec.md`](docs/04_agent_orchestration_spec.md) | PA→C-Suite context injection, turn-taking/interrupt state machine, delegation lifecycle, MCP connector schema, zero-trust bounds, model routing |
| 5 | [`docs/06_ui_ux_spec.md`](docs/06_ui_ux_spec.md) | Route map, per-room UX, artifact pane, thought streaming, graph/branch visualization, dashboards |
| 6 | [`docs/07_security_compliance.md`](docs/07_security_compliance.md) | Chronological security lifecycle (dev → data layer → agent runtime → production infra), agentic threat model |
| 7 | [`docs/08_agent_personas.md`](docs/08_agent_personas.md) | C-Suite roster with system-prompt templates, speak-relevance profiles, delegation authority matrix, worker catalog, PA behavioral spec |
| 8 | ★ [`docs/03_implementation_phases.md`](docs/03_implementation_phases.md) | **The master task list.** 5 phases, granular tasks, each with Security Configuration + Acceptance Criteria checklists |

> Naming note: the four mandated deliverables keep their canonical names
> (`architecture_and_stack`, `project_structure`, `implementation_phases`,
> `agent_orchestration_spec`) behind numeric prefixes that encode reading order.
> `03_implementation_phases.md` is read **last** because it references every other document.

## 4. Non-negotiable design constraints (repeated everywhere on purpose)

1. **Model agnosticism.** No agent is hard-wired to a vendor. Every agent tier resolves its model
   through a single provider-abstraction layer and a per-agent `ModelPolicy` config. Swapping
   `claude-*` → `gpt-*` → local `ollama/*` is a config change, not a code change.
2. **Token frugality.** LLM calls are the *last resort*. PA agents are deterministic algorithms
   (scoring, windowing, retrieval) — not LLMs. Relevance gating, RAG instead of context stuffing,
   prompt caching, cheap-model routing for classification, and hard per-conversation token budgets
   are all first-class architecture, not afterthoughts.
3. **Security is chronological.** Every implementation phase carries its own security workload —
   from pre-commit hooks on day one to WAF + SIEM at production. No task in
   `03_implementation_phases.md` is complete until its Security Configuration checklist passes.
4. **Multi-tenant isolation is absolute.** Postgres Row-Level Security on every tenant-scoped
   table, project-scoped object-storage prefixes, project-scoped vector namespaces, and
   tenancy-asserting middleware on both REST and WebSocket boundaries.
5. **Conversations are DAGs.** No linear message arrays anywhere in the schema, API, or UI state.

## 5. High-level architecture (one glance)

```
Browser (Next.js) ── HTTPS/WSS ──> API Gateway (NestJS) ──> Postgres(+pgvector, RLS)
   │  artifact iframe sandbox           │        │  ──> Redis (BullMQ + Pub/Sub bus)
   │                                    │        │  ──> S3/MinIO (uploads, artifacts)
   │                                    ▼
   │                          Agent Runtime workers (LangGraph.js)
   │                             │            │
   │                     LLM Provider     MCP Clients ──> network-isolated MCP servers
   │                     Abstraction              (fs, db, git, web, custom connectors)
   └── SSE/WS streams: tokens, thoughts, status tags, artifact chunks, bus events
```

## 6. Repository status & next step

- **Current branch:** `claude/multi-agent-ai-orchestration-zt6xvw`
- **Next step for the Implementation Agent:** open `docs/03_implementation_phases.md`, start at
  `Phase 1 / Epic 1.1 / Task T1.1.1`, and proceed strictly in dependency order.
