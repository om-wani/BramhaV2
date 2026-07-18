# 04 — Agent Orchestration Spec (`agent_orchestration_spec.md`)

Technical specification for the hierarchical agent system: PA→C-Suite context injection,
turn-taking and interruption, background delegation, MCP connector schema, and the graph-based
asynchronous conversation loop — all under zero-trust safety bounds. This document is normative:
"MUST/SHOULD" language binds the Implementation Agent.

Cross-references: data structures in `05_data_model_and_schemas.md`, bus topics in
`01_architecture_and_stack.md §5`, personas in `08_agent_personas.md`.

---

## 1. The three tiers, restated precisely

| Tier | Runtime form | LLM usage | Lifetime |
|---|---|---|---|
| **C-Suite** | LangGraph loop per turn (`csuite-loop.ts`) | Yes — `csuite` ModelPolicy | One turn = one job; persona persists in DB |
| **Specialist / worker** | Isolated LangGraph loop (`specialist-loop.ts`) | Yes — `specialist` policy (cheaper default) | One delegation = one job (may checkpoint/resume) |
| **PA** | **Pure deterministic code** (`apps/agent-runtime/src/pa/`) | **Never** (may *schedule* utility-tier summaries) | Always-on library functions, no processes |

The PA tier is the token-frugality keystone: everything a PA does — relevance scoring, context
assembly, working-memory upkeep — is an algorithm with unit tests, not a prompt.

---

## 2. PA engine (deterministic context managers)

### 2.1 Relevance scoring — decides WHO speaks

Executed by the Turn Engine for every agent in the room roster whenever a `conv.node.created`
event lands. **Zero LLM calls.**

```
score(agent, node) =
    w_m · mention(node, agent)            // 1.0 if @mentioned or summoned; else 0
  + w_e · expertise(node, agent)          // cosine(node_embedding, agent_expertise_centroid)
                                          //   agent centroid = mean embedding of expertise_tags
                                          //   node embedding = cheap embed of last user msg (cached)
  + w_l · lexical(node, agent)            // BM25 of node text vs agent tag/keyword lexicon
  + w_t · thread_ownership(agent, branch) // 0.3 if agent authored an ancestor in last k=6 nodes
  + w_o · open_loop(agent, conversation)  // 0.4 if working_memory.open_loops has a pending item
                                          //   addressed by this node (question directed at agent)
  − w_r · recency_fatigue(agent, branch)  // penalty if agent spoke in last 2 nodes (anti-dominance)
  + ε    // small deterministic jitter seeded by (nodeId, personaId) to break ties stably

Defaults: w_m=10, w_e=2.0, w_l=1.0, w_t=1.0, w_o=1.5, w_r=1.2. Tunable per project settings.
```

Speaker selection per room type (`turn-policies.ts`):

| Room | Policy |
|---|---|
| `call` (1:1) | The single agent always speaks. Score only gates *proactivity* (§2.4). |
| `meeting` | Speak set = agents with `score ≥ θ_meeting (default 1.4)`, ordered by score, **max 3 per user turn**; others stay silent (no tokens burned). |
| `conference` | Same, `θ_conf = 1.8`, max 3; if NO agent clears θ, highest scorer speaks (someone must answer the CEO). Agents below θ get their working memory updated by PA anyway (free). |
| agent→agent triggers | After an agent message, re-score with stricter θ+0.6 and `turn_depth` budget (§5.4) so agent chatter converges. |

### 2.2 Context Bundle assembly — decides WHAT the speaker sees

`buildContextBundle(personaId, conversationId, branchId, triggerNodeId, budgetTokens)` —
deterministic, ordered for prompt-cache stability:

```
[1] Persona system prompt          (compiled once, cached — stable prefix)
[2] Tool schemas                   (persona.tool_allowlist ∩ room capabilities)
[3] Project brief                  (projects.settings.brief, ≤500 tok)
[4] Working-memory summary         (agent_working_memory.summary_md, ≤800 tok)
[5] Open loops for this agent      (bulleted, ≤200 tok)
[6] RAG block                      (§2.3, ≤ 35% of remaining budget, wrapped in
                                    <untrusted_context> delimiters)
[7] Thread window                  (branch slice ancestors of trigger node, newest-last,
                                    remaining budget; older nodes replaced by their rolling
                                    summary marker when evicted)
[8] Trigger instruction            ("You are speaking now because: {mention|expertise|follow-up}.
                                    Other speakers this turn: [...]. Be concise; do not repeat them.")
Budget: min(ModelPolicy.maxInputTokens, project cap, CONTEXT_TOKEN_CAP default 12k).
Token counting via packages/agents/token-count (per-provider tokenizer).
```

### 2.3 RAG retrieval (hybrid, algorithmic)

```
query  = last user message + open-loop texts (concatenated, ≤512 tok)
lex    = top-40 by ts_rank(content_tsv)      WHERE project_id = :pid AND NOT stale
vec    = top-40 by cosine(embedding, embed(query))  same filter (HNSW)
fused  = Reciprocal Rank Fusion (k=60) → top-12 → dedupe by origin_id (max 3 per origin)
       → recency boost ×(1 + 0.1·e^(-age_days/30)) for origin='ceo_office'
       → pack into budget with heading_trail breadcrumbs + provenance ids
```
Chunk provenance ids are included so agents can cite (`[src:chunk_id]`) and the UI can link into
the Storage Room preview.

### 2.4 Working-memory upkeep (free, every node)

On every `conv.node.created`, for EVERY agent in the roster (speakers or not), the PA runs:
- **Fact extraction (regex/heuristic pass):** decisions ("we will…", "decided…"), numbers/dates,
  explicit commitments containing the agent's name/title → append to `facts` (capped ring buffer
  of 50, LRU eviction).
- **Open-loop tracking:** direct questions to the agent (`@cto`, "can the CTO…", second-person in
  a `call` room) → push open loop; loops are closed when the agent's own message's first 2
  sentences lexically match the loop (cosine ≥ 0.55 on cheap embedding) or on explicit user
  dismissal.
- **Summary scheduling:** when un-summarized window exceeds 3.5k tokens, enqueue a `utility`-tier
  rolling-summary job (`summary_md ≤ 800 tok`, prompt-cached, shared across agents in the room —
  ONE summary per (conversation, branch), not per agent; per-agent memory stays algorithmic).
- **Proactivity check (`call`/`meeting` idle):** if an open loop is stale > 10 min and the room is
  idle, PA MAY schedule a proactive agent turn ("following up on…") — max 1 per hour per agent,
  off by default in project settings.

---

## 3. C-Suite turn loop (LangGraph)

```
graph csuite_turn:
  START → gather        # receives prebuilt ContextBundle (PA already did the work)
        → reason        # model call via ModelRouter.chat(policy, bundle, tools)
        ├─ tool_call? → act → reason           (max 6 tool iterations/turn)
        ├─ interrupt_signal? → checkpoint_yield (§5)
        └─ final → respond → persist → END

Streaming: 'reasoning' deltas → conv.stream.thought (UI collapsible section);
           content deltas → conv.stream.content;
           each tool dispatch → conv.agent.status with the mandated labels
           ('Invoking Sub-Agent', 'Reading Database via MCP', 'Running Test Suite',
            'Generating Artifact', ...).
persist: appendNode(type=agent_message, parent=triggerNode) + token_usage row +
         working-memory self-update (PA closes matching open loops).
```

**Tool surface for C-Suite (exact schemas in `packages/shared/schemas/tools.ts`):**

| Tool | Effect | Guard |
|---|---|---|
| `delegate_task{objective, worker_slug, inputs[], deliverable, budget?}` | Creates delegation (§4) | `delegation_authority` matrix + project budget |
| `summon_agent{persona_slug, reason}` | Emits `conv.interrupt(summon)` → Turn Engine schedules that agent with mention-level score | Target must be in roster |
| `create_artifact{kind, title, content}` / `update_artifact{id, patch}` | Streams to artifact pane; persists version | Size cap 2 MB; html/react render only in sandbox |
| `search_knowledge{query, origins?}` | §2.3 retrieval, results as tool output | RLS-scoped |
| `read_node{node_id}` / `read_branch{branch_id, n}` | Fetch specific history outside window | Same conversation only |
| `mcp_call{connector, tool, args}` | Proxied MCP invocation (§6) | Policy engine + approval gates |
| `run_code{language, source, stdin?}` | Sandbox execution (§7 of 01-doc) | Ephemeral container, no network |
| `schedule_followup{when, note}` | Creates open loop for future proactive turn | Rate-limited |
| `end_turn{}` | Explicit stop | — |

C-Suite agents SHOULD answer directly (no tools) for advisory/counsel turns — the persona prompts
(08-doc) instruct: *"Use tools only when they change your answer. Delegate only what you cannot
answer in under two paragraphs of thought."*

---

## 4. Background delegation lifecycle

```
state machine: queued → running → (waiting_approval ⇄ running) → completed | failed | timeout | cancelled

1. SPAWN    csuite tool delegate_task → validate against persona.delegation_authority
            {allowed worker slugs, maxUsd ≤ cap, maxConcurrent per agent (default 3)}
            → INSERT delegations(group_id = existing group if the task references one, else new)
            → enqueue BullMQ 'delegations' job → emit delegation.created
            → The C-Suite turn CONTINUES (non-blocking); its reply SHOULD acknowledge the
              delegation ("I've put our researcher on it — expect a report here shortly.").

2. RUN      specialist-loop with OWN ContextBundle:
              [persona, tools(subset), task spec, inputs, RAG scoped to spec.query_hints]
            NEVER the room transcript. Budget guard wraps the loop: abort at
            maxUsd | maxSeconds | maxToolCalls; each breach → status=timeout + partial result.
            Progress: worker calls report_progress{pct, note} → delegation.progress (Activity pane).

3. COLLAB   Workers in the same group_id may publish deleg.{groupId}.msg {from, to?, content}
            and read the group channel (capped 50 msgs, 10k tokens total per group).
            Cross-worker messages are NEVER user-visible; the group's final outputs are.

4. APPROVAL Any write-classified MCP scope → status=waiting_approval + approval row +
            approval.requested event → user modal. Denied/expired ⇒ tool error inside the worker
            (it must adapt or finish without the write).

5. RETURN   result = {report_md, artifact_ids[], usage} → status=completed →
            delegation.completed → PA writes a fact + open loop ("report ready") into the
            delegating agent's working memory → Turn Engine enqueues a LOW-priority report-back
            turn for that C-Suite agent in the origin room, parented to origin_node_id
            (type=delegation_report node). If the user is mid-conversation elsewhere on the
            branch, the report node attaches without stealing the branch head (auto-fork rule
            §5.3 handles collisions).

6. CANCEL   User (Activity pane) or delegating agent may cancel → BullMQ job.discard +
            checkpoint delete + status=cancelled.
```

---

## 5. Interrupt-driven, graph-based conversation loop

### 5.1 Interrupt sources & semantics

| Source | Event | Effect |
|---|---|---|
| User presses Stop on a streaming agent | `conv.interrupt{reason:'stop', targetPersonaId}` | AbortSignal → LangGraph checkpoint → partial message persisted with `meta.interrupted=true` |
| User/agent mentions another agent | `conv.interrupt{reason:'summon'}` | Target scheduled with mention-score; current speaker(s) UNAFFECTED (parallel, not preemptive) |
| Agent judges it must interject (tool `summon_agent` on self is disallowed; interjection = high `speak_profile.eagerness` + score above `interrupt_threshold` on ANOTHER agent's streaming message) | Turn Engine schedules interjector; its node parents to the interrupted message's node | UI renders as an interleaved reply; original speaker finishes unless user stops them |
| User sends a new message while agents stream | Normal `node.created`; streaming turns continue on their branch | New scoring round; concurrency cap (default 3 active turns/conversation) queues the rest |
| Redirect ("drop that, focus on X") | `conv.interrupt{reason:'redirect'}` classified by a cheap utility-tier check ONLY when the composer's stop-affordance is used, else plain message | Aborts all active turns on the branch, clears their queue entries |

### 5.2 Checkpoint-yield protocol

Every LangGraph loop checks a Redis flag `interrupt:{turnId}` between graph nodes and between
streamed tool calls. On flag: persist checkpoint → emit `conv.agent.status{state:'idle',
detail:'interrupted'}` → job completes as `interrupted`. Resumable turns (delegations) resume from
checkpoint; conversational turns are NOT resumed (the world moved on — re-scoring decides if the
agent speaks again).

### 5.3 Concurrency without collision (the append-only rule)

Two agents finishing simultaneously both call `appendNode(parent = branch head they saw)`. The
optimistic head-advance (05-doc §3) lets the first win; the second's node lands as a **sibling**
and the branch auto-forks `parallel-{n}` — the UI shows both as side-by-side replies with a merge
affordance (user picks which continuation becomes `main`, or keeps both threads). No locks, no
lost writes, ever.

### 5.4 Convergence budgets (hard, enforced by budget-guard)

```
turn_depth      ≤ 4    agent-triggered-by-agent chain length per user message
active_turns    ≤ 3    concurrent streaming turns per conversation
delegations     ≤ 3    running per C-Suite agent; ≤ 10 per project
group messages  ≤ 50   per delegation group
daily usd       per project (settings) — breach ⇒ project-wide agent pause + user notification
```

---

## 6. MCP connector infrastructure

### 6.1 Connector manifest schema (validated at registration, `registry.ts`)

```jsonc
{
  "slug": "postgres-readonly",
  "name": "PostgreSQL (read-only)",
  "version": "1.0.0",
  "transport": { "type": "streamable-http", "endpoint": "http://mcp-db.internal:8801" },
  "auth": { "type": "capability-token" },          // §6.2 — always
  "tools": [
    { "name": "query", "scope": "db.query",       // every tool maps to EXACTLY one scope
      "classification": "read",                    // read | write | execute
      "inputSchema": { /* JSON Schema */ },
      "limits": { "maxResultBytes": 262144, "timeoutMs": 15000 } }
  ],
  "egress": ["userdb.customer.example:5432"],      // declared targets → security-group source of truth
  "dataClassification": "tenant-confidential"
}
```

### 6.2 Zero-trust call path

```
agent tool mcp_call{connector, tool, args}
 → POLICY ENGINE (packages/mcp-connectors/client/policy-engine.ts):
    1. grant exists?           mcp_grants(persona, connector, project) ∋ tool.scope
    2. classification gate:    write|execute ⇒ requires_approval ⇒ approval flow (§4.4)
    3. args validation:        JSON Schema + size cap + secret-pattern scan (deny if creds detected)
    4. rate limit:             token bucket per (persona, connector): 30 calls / 5 min
 → mint capability token: JWT {personaId, projectId, connectorId, scope, argsHash, exp: now+60s},
   signed with the orchestrator's key; MCP node verifies signature + single-use (jti in Redis).
 → dispatch over mTLS to the isolated node; response size-capped; result wrapped in
   <untrusted_context> before entering the model context.
 → audit_log row {action:'mcp.call', meta:{connector, tool, argsHash, resultBytes, ms}}.
```

### 6.3 Isolation requirements (binding on infra tasks)

- Each connector class runs as its own container in the isolated network zone; security groups
  allow ingress ONLY from agent-runtime, egress ONLY to `manifest.egress` targets.
- Connector credentials (e.g., the user's SQL database password from `knowledge_sources.
  credential_ref`) are injected into the MCP node at job time from the secrets manager — the agent
  runtime, the model, and the prompt NEVER see them.
- Filesystem connector chroots to `/data/{projectId}`; database connector enforces read-only
  transactions (`SET TRANSACTION READ ONLY`) + statement timeout + row limits.

---

## 7. Model routing & token governance (normative summary)

1. Vendor SDKs only in `packages/agents/providers/*`. Everything else consumes the normalized
   stream interface. Adding a provider = one file + registry entry.
2. Per-persona `ModelPolicy` resolved at turn start; hot-reload on admin change (bus event
   `policy.updated` → router cache bust).
3. Prompt-cache discipline: bundle sections [1..5] are byte-stable across turns of the same
   (persona, conversation) whenever unchanged — the assembler MUST NOT re-order or re-timestamp
   them (timestamps live in section [8] only).
4. All usage → `token_usage`; diagnostics dashboard aggregates per project/persona/model/day;
   alerts at 80% of `per_day_usd`.
5. Utility tier handles: titles, rolling summaries, redirect classification, tag suggestions —
   ALWAYS the cheapest configured model; semantic cache consulted first.

---

## 8. Zero-trust safety bounds (consolidated checklist for every orchestration task)

- [ ] No component trusts message content for authorization — only JWTs/capability tokens.
- [ ] Agents cannot name tools/connectors outside `tool_allowlist` ∩ `mcp_grants` (schema simply
      absent from their context).
- [ ] All external/ingested/MCP content enters prompts inside `<untrusted_context>` delimiters;
      personas carry a standing injection-resistance clause (08-doc §1).
- [ ] Write/execute actions gate on human approval unless the user granted a standing
      per-connector waiver (`requires_approval=false`, admin UI, audit-logged).
- [ ] Every agent action row-scoped by RLS via the system-membership mechanism (05-doc §9.2).
- [ ] Budgets (§5.4) enforced in the runtime, not the prompt.
- [ ] Kill switch: `projects.settings.agents_paused=true` halts scheduling instantly (Turn Engine
      checks per event); Admin Dashboard exposes global pause.
