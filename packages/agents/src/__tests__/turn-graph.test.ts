import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeTurnGraph } from '../turn-graph.js';
import type { PersistResponseFn, EmitStreamingFn, EmitSelectionFn } from '../turn-graph.js';

// Mock getModelRouter BEFORE importing turn-graph
const mockEmbed = vi.fn();
const mockStream = vi.fn();

vi.mock('../model-router.js', () => ({
  getModelRouter: vi.fn(() => ({
    embed: mockEmbed,
    stream: mockStream,
    chat: vi.fn(),
  })),
}));

describe('invokeTurnGraph', () => {
  const fakeEmbedding = new Array(1536).fill(0.1);

  beforeEach(() => {
    vi.clearAllMocks();
    // embed returns fake embedding
    mockEmbed.mockResolvedValue([fakeEmbedding]);
    // stream yields 2 chunks
    mockStream.mockImplementation(async function* () {
      yield 'Hello ';
      yield 'world';
    });
  });

  it('returns responses for selected personas and calls persistFn', async () => {
    // Dynamic mock: returns one nodeId per response received (so length always matches)
    const persistFn: PersistResponseFn = vi.fn().mockImplementation(
      async (p: { responses: Array<{ persona: string; content: string }> }) =>
        p.responses.map((r, i) => ({ persona: r.persona, nodeId: `node-${r.persona}-${i}` })),
    );
    const emitStreamingFn: EmitStreamingFn = vi.fn();
    const emitSelectionFn: EmitSelectionFn = vi.fn();

    // ceo and cto have same direction as fakeEmbedding → high cosine similarity
    const domainEmbeddings = new Map<string, number[]>([
      ['ceo', new Array(1536).fill(0.1)],  // same direction → cosine = 1.0
      ['cto', new Array(1536).fill(0.1)],
      ['cmo', new Array(1536).fill(-0.1)], // opposite → 0 after max(0,...)
      ['cfo', new Array(1536).fill(-0.1)],
      ['coo', new Array(1536).fill(-0.1)],
      ['chro', new Array(1536).fill(-0.1)],
      ['cso', new Array(1536).fill(-0.1)],
      ['cdao', new Array(1536).fill(-0.1)],
    ]);

    const result = await invokeTurnGraph({
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'ACME',
      userNodeId: 'user-node-1',
      userMessage: 'What is our strategy?',
      roomKind: 'council',
      recentSpeakers: [],
      domainEmbeddings,
      persistFn,
      emitStreamingFn,
      emitSelectionFn,
      searchFn: vi.fn().mockResolvedValue([]),
    });

    const { responses } = result;

    // Should have responses (at least 1)
    expect(responses.length).toBeGreaterThan(0);
    // persistFn called exactly once with correct payload shape
    expect(persistFn).toHaveBeenCalledTimes(1);
    const persistCall = (persistFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      projectId: string;
      userNodeId: string;
      responses: Array<{ persona: string; content: string }>;
    };
    expect(persistCall.projectId).toBe('proj-1');
    expect(persistCall.userNodeId).toBe('user-node-1');
    expect(persistCall.responses.length).toBe(responses.length);
    for (const r of persistCall.responses) {
      expect(r.content).toBe('Hello world');
    }
    // streaming events emitted
    expect(emitStreamingFn).toHaveBeenCalled();
    // selection event emitted with all 8 scores
    expect(emitSelectionFn).toHaveBeenCalledOnce();
    const selectionCall = (emitSelectionFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      scores: Array<{ persona: string; score: number; selected: boolean }>;
    };
    expect(selectionCall.scores).toHaveLength(8);
    // All responses have content and real nodeIds
    for (const r of responses) {
      expect(r.content).toBe('Hello world');
      expect(r.nodeId).not.toBe('pending');
    }
  });

  it('falls back to top-1 when no personas pass threshold', async () => {
    const persistFn: PersistResponseFn = vi.fn().mockImplementation(
      async (p: { responses: Array<{ persona: string; content: string }> }) =>
        p.responses.map((r, i) => ({ persona: r.persona, nodeId: `node-${i}` })),
    );
    const emitStreamingFn: EmitStreamingFn = vi.fn();
    const emitSelectionFn: EmitSelectionFn = vi.fn();

    // All domain embeddings orthogonal to message embedding → near-zero cosine
    const orthogonal = new Array(1536).fill(0);
    const firstEl = orthogonal[0];
    if (firstEl !== undefined) {
      orthogonal[0] = 1; // only first dimension
    }
    const msgDir = new Array(1536).fill(0);
    const secondEl = msgDir[1];
    if (secondEl !== undefined) {
      msgDir[1] = 1; // orthogonal to orthogonal
    }

    // Override embed to return orthogonal to domain embeddings
    mockEmbed.mockResolvedValue([msgDir]);

    const domainEmbeddings = new Map<string, number[]>();
    for (const slug of ['ceo', 'cto', 'cmo', 'cfo', 'coo', 'chro', 'cso', 'cdao']) {
      domainEmbeddings.set(slug, orthogonal);
    }

    const result = await invokeTurnGraph({
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'ACME',
      userNodeId: 'user-node-1',
      userMessage: 'xyz', // no keyword matches
      roomKind: 'council',
      recentSpeakers: [],
      domainEmbeddings,
      persistFn,
      emitStreamingFn,
      emitSelectionFn,
      searchFn: vi.fn().mockResolvedValue([]),
    });

    // Top-1 fallback: exactly 1 response
    expect(result.responses.length).toBe(1);
    expect(persistFn).toHaveBeenCalledTimes(1);
  });
});
