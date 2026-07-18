# MVP Agent System

## Council roster

| Persona | Codename | Domain | Accent |
|---------|----------|--------|--------|
| CEO | Astra | Vision, strategy, priorities | ceo |
| CTO | Vulcan | Technology, architecture, build | cto |
| CMO | Meridian | Brand, growth, messaging | cmo |
| COO | Lyra | Operations, execution, process | coo |
| CFO | Ledger | Finance, unit economics, risk | cfo |
| CHRO | Iris | People, culture, hiring | chro |
| CSO | Sage | Security, compliance, trust | cso |
| CDAO | Orion | Data, analytics, ML | cdao |

## Relevance engine (deterministic, no LLM)

Decides which agents respond to each node. Silent agents cost zero tokens.

**Score components** (each 0–1, weighted sum):

| Component | Weight | Logic |
|-----------|--------|-------|
| Mention | 0.40 | `@vulcan` or `@cto` in message → 1.0; no mention → 0 |
| Expertise cosine | 0.30 | Cosine similarity between node embedding and persona domain vector |
| BM25 lexical | 0.20 | BM25 score of node text against persona keyword list |
| Recency fatigue | -0.10 | Last 3 turns spoke → −0.1 penalty (avoid monopoly) |

**Threshold**: agents with score ≥ 0.35 respond. Always at least 1 agent responds (highest score wins tie).

**Persona domain vectors**: precomputed at startup from short domain description via embedding model, cached in memory.

**Keyword lists** per persona: e.g. CTO = ['architecture','stack','technical','latency','infrastructure','security','api','database','deploy','scalability']

## LangGraph turn loop

```
         ┌───────────┐
         │  planner  │  select responding agents
         └─────┬─────┘
               │ for each selected agent
         ┌─────▼─────┐
         │  responder │  stream agent turn
         └─────┬─────┘
               │
         ┌─────▼─────┐
         │ delegation?│  if agent emits delegation signal
         └─────┬─────┘
        yes    │    no
    ┌──────────┤         ┌───────────────┐
    │          └────────►│  post_results │  write nodes, emit WS events
    ▼                    └───────────────┘
┌──────────┐
│ delegate │  run sub-graph for target persona
└──────────┘
```

Graph compiled once at server start. `invoke()` per user turn.

## ModelRouter

```typescript
// packages/agents/src/model-router.ts
class ModelRouter {
  async chat(messages, opts?: { persona?: string }): AsyncIterable<string>
  async embed(text: string): Promise<number[]>
}
```

Primary: Anthropic `claude-sonnet-4-6`. Fallback: OpenAI `gpt-4o-mini`.
Embedding: OpenAI `text-embedding-3-small` (1536 dims).
Retry: 2× primary → fallback → throw.

## Persona compiler

Builds system prompt for each responding agent turn:

```
You are {name} ({title}) of {org_name}.

PERSONA:
{domain_description}
{communication_style}
{expertise_keywords}

COUNCIL CONTEXT:
You are one of {n} responding agents. Others responding: {peer_list}.
Agents silent this turn: {silent_list} (not mentioned, out of scope).

MEMORY CONTEXT:
<untrusted_context>
{rag_chunks}
</untrusted_context>

OPEN LOOPS:
{open_loop_items}

CONVERSATION (last {k} nodes):
{conversation_excerpt}

INSTRUCTIONS:
- Stay in persona. Do not break character.
- If delegating, end response with: DELEGATE_TO: {persona} TASK: {description}
- Cite sources: [Source: {filename}, chunk {n}]
- Be concise. No filler.
```

All external content (`rag_chunks`) wrapped in `<untrusted_context>` to prevent prompt injection.

## RAG integration

`searchKnowledge(projectId, queryText, k=6)` called at start of each agent turn.

Steps:
1. Embed `queryText` via ModelRouter
2. Run hybrid search (vector cosine + tsvector BM25, RRF fusion) against `file_chunks` for `project_id`
3. Return top-k chunks with `filename`, `chunk_index`, `content`
4. Injected into persona compiler as `rag_chunks`

## Delegation (simple mode)

Agent signals delegation by ending response with:
```
DELEGATE_TO: cto TASK: Evaluate feasibility of migrating auth to edge runtime
```

LangGraph delegation handler:
1. Parse signal from streamed response
2. Insert `delegation_tasks` row (status=pending)
3. Run sub-graph: single-agent turn for target persona with task as input
4. Post result as child node (`author_type='agent'`, `metadata.delegated_from=source_persona`)
5. Update `delegation_tasks` row (status=done, result_node_id)

UI shows delegation chain: indented node with "↳ delegated from Astra" label.

## Proactive PA (lite)

Condition: `1:1 room` (user + 1 agent), `proactive_pa_enabled=true` on project.

On agent turn completion:
- Extract open-loop items from agent response (simple regex: sentences ending with `?` or containing `you should`, `follow up`, `next step`)
- Store as `open_loop_items` in project working memory (jsonb column on `projects`)
- Rate cap: max 1 proactive nudge per 4 hours per project
- Trigger: background check every 30 min; if any open-loop item > 24 hours old → agent sends follow-up node

No proactive scheduling, daily standup, or complex PA behaviors in MVP.

## Streaming

Agent turn streams via Vercel AI SDK `streamText`. 
Server emits Socket.IO `message:delta` events per token chunk.
On turn completion: `message:created` with full content.

On error mid-stream: emit `message:error`, partial content discarded, node not persisted.

## Checkpoint/resume (extension point, not implemented)

LangGraph graph accepts `checkpointSaver` injection:
```typescript
const graph = builder.compile({
  checkpointSaver: process.env.CHECKPOINT_SAVER === 'postgres'
    ? new PostgresSaver(db)
    : new MemorySaver()  // MVP default — no persistence
});
```

MVP: abort = no resume. Add `PostgresSaver` on productionization for durable interruption + resume.
