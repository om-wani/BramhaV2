/**
 * Regression: multi-persona agent responses must be persisted as a CHAIN
 * (first child of the user node, each next child of the previous), not as
 * siblings — sibling nodes fall out of the head's ancestry and vanish from
 * the thread on reload.
 */

import 'reflect-metadata';
import { describe, it, beforeEach, expect, vi } from 'vitest';

const { mockInvokeTurnGraph, mockDb, capturedInserts, capturedHeadUpdates } = vi.hoisted(() => ({
  mockInvokeTurnGraph: vi.fn(),
  mockDb: { insert: vi.fn(), update: vi.fn(), select: vi.fn() },
  capturedInserts: [] as Array<Record<string, unknown>>,
  capturedHeadUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock('@bramha/agents', () => ({
  PERSONAS: {},
  computeDomainEmbeddings: vi.fn().mockResolvedValue(new Map()),
  configureModelRouter: vi.fn(),
  getModelRouter: vi.fn().mockReturnValue({}),
  invokeTurnGraph: mockInvokeTurnGraph,
}));

vi.mock('@bramha/db', () => ({
  getDb: () => Promise.resolve(mockDb),
  conversationNodes: 'conversationNodes_table',
  branches: 'branches_table',
  delegationTasks: { id: 'id' },
  projects: { id: 'id', settings: 'settings', workingMemory: 'wm' },
  modelCalls: 'model_calls_table',
  searchKnowledge: vi.fn().mockResolvedValue([]),
  getThreadAncestry: vi.fn().mockResolvedValue([]),
}));

vi.mock('@bramha/event-bus', () => ({ eventBus: { emit: vi.fn() } }));

import { AgentsService } from '../modules/agents/agents.service.js';

let nodeCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  capturedInserts.length = 0;
  capturedHeadUpdates.length = 0;
  nodeCounter = 0;

  mockDb.insert.mockImplementation(() => ({
    values: (vals: Record<string, unknown>) => ({
      returning: () => {
        capturedInserts.push(vals);
        nodeCounter += 1;
        return Promise.resolve([{ id: `node-${nodeCounter}`, ...vals }]);
      },
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: (vals: Record<string, unknown>) => ({
      where: () => {
        capturedHeadUpdates.push(vals);
        const p = Promise.resolve([{}]) as unknown as Promise<unknown[]> & {
          returning: () => Promise<unknown[]>;
        };
        p.returning = () => Promise.resolve([{}]);
        return p;
      },
    }),
  }));

  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve([{ settings: {} }]) }),
  }));
});

describe('agent response persistence (chain semantics)', () => {
  it('chains multi-persona responses: user → r1 → r2, head advances to the tail', async () => {
    mockInvokeTurnGraph.mockImplementationOnce(async (args: Record<string, unknown>) => {
      const persistFn = args['persistFn'] as (p: Record<string, unknown>) => Promise<
        Array<{ persona: string; nodeId: string }>
      >;
      const results = await persistFn({
        projectId: 'proj-1',
        roomId: 'room-1',
        branchId: 'branch-1',
        userNodeId: 'user-node-1',
        responses: [
          { persona: 'ceo', content: 'CEO says', metadata: {} },
          { persona: 'cfo', content: 'CFO says', metadata: {} },
          { persona: 'cto', content: 'CTO says', metadata: {} },
        ],
      });
      return {
        responses: results.map((r) => ({ ...r, content: 'x' })),
        pendingDelegations: [],
      };
    });

    const service = new AgentsService();
    (service as unknown as { domainEmbeddings: Map<string, number[]> }).domainEmbeddings = new Map();

    await service.triggerAgentTurn({
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'Acme',
      userNodeId: 'user-node-1',
      userMessage: 'hello council',
      roomKind: 'council',
      thread: [],
    });

    // Three node inserts, chained parentIds
    expect(capturedInserts).toHaveLength(3);
    expect(capturedInserts[0]?.['parentId']).toBe('user-node-1');
    expect(capturedInserts[1]?.['parentId']).toBe('node-1');
    expect(capturedInserts[2]?.['parentId']).toBe('node-2');

    // Branch head advanced once, to the LAST node in the chain
    const headSet = capturedHeadUpdates.find((u) => 'headNodeId' in u);
    expect(headSet?.['headNodeId']).toBe('node-3');
  });
});
