/**
 * P5.2 delegation execution tests.
 *
 * Tests that AgentsService:
 *  - calls invokeTurnGraph with isDelegated=true and the correct boundPersona
 *  - updates delegation_tasks status: pending → running → done
 *  - handles sub-graph failures gracefully (status=failed, no rethrow)
 *
 * Strategy: inject AgentsService directly with vi.mock for @bramha/agents and @bramha/db.
 * vi.hoisted() is required so mock variables are initialised before vi.mock() factory runs.
 */

import 'reflect-metadata';
import { describe, it, beforeEach, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock functions — must be created before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockInvokeTurnGraph, mockDb, mockEventBusEmit } = vi.hoisted(() => {
  const mockInvokeTurnGraph = vi.fn();
  const mockEventBusEmit = vi.fn();

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
  };

  return { mockInvokeTurnGraph, mockDb, mockEventBusEmit };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@bramha/agents', () => ({
  PERSONAS: {
    ceo: { slug: 'ceo', name: 'CEO', title: 'Chief Executive Officer', expertise: [] },
    cfo: { slug: 'cfo', name: 'CFO', title: 'Chief Financial Officer', expertise: [] },
  },
  computeDomainEmbeddings: vi.fn().mockResolvedValue(new Map()),
  getModelRouter: vi.fn().mockReturnValue({}),
  invokeTurnGraph: mockInvokeTurnGraph,
}));

vi.mock('@bramha/db', () => ({
  getDb: () => Promise.resolve(mockDb),
  conversationNodes: 'conversationNodes_table',
  branches: 'branches_table',
  delegationTasks: { id: 'delegation_tasks_id_col' },
  searchKnowledge: vi.fn().mockResolvedValue([]),
}));

vi.mock('@bramha/event-bus', () => ({
  eventBus: { emit: mockEventBusEmit },
}));

// ---------------------------------------------------------------------------
// SUT import — after mocks
// ---------------------------------------------------------------------------

import { AgentsService } from '../modules/agents/agents.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Captured calls to mockDb.update for assertion */
const capturedUpdates: Array<{ set: Record<string, unknown> }> = [];

function setupDbMocks(opts: {
  delegationTasksInsertRow?: { id: string };
  subGraphResponses?: Array<{ persona: string; nodeId: string; content: string }>;
}) {
  capturedUpdates.length = 0;

  // conversationNodes insert (in delegatedPersistFn)
  const nodeInsertRow = {
    id: 'delegated-node-001',
    roomId: 'room-1',
    projectId: 'proj-1',
    persona: 'cfo',
    authorType: 'agent',
    content: 'Budget analysis done.',
    parentId: 'node-ceo-1',
  };

  // Track how many times insert is called so we return the right fixture
  let insertCallCount = 0;
  mockDb.insert.mockImplementation(() => ({
    values: () => ({
      returning: () => {
        insertCallCount += 1;
        if (insertCallCount === 1) {
          // First insert: delegation_tasks row
          const row = opts.delegationTasksInsertRow ?? { id: 'dtask-001' };
          return Promise.resolve([row]);
        }
        // Subsequent inserts: conversationNodes (in delegatedPersistFn)
        return Promise.resolve([nodeInsertRow]);
      },
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: (vals: Record<string, unknown>) => ({
      where: () => {
        capturedUpdates.push({ set: vals });
        return Promise.resolve([]);
      },
    }),
  }));
}

function buildParams(overrides?: Record<string, unknown>) {
  return {
    projectId: 'proj-1',
    roomId: 'room-1',
    branchId: 'branch-1',
    orgName: 'Acme Corp',
    userNodeId: 'user-node-1',
    userMessage: 'Help me plan the budget',
    roomKind: 'council' as const,
    thread: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentsService — delegation execution (P5.2)', () => {
  let service: AgentsService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new AgentsService();
    // Bypass onModuleInit embedding computation
    (service as unknown as { domainEmbeddings: Map<string, number[]> }).domainEmbeddings =
      new Map();
  });

  it('invokes sub-graph with isDelegated=true and correct boundPersona', async () => {
    mockInvokeTurnGraph
      .mockResolvedValueOnce({
        responses: [{ persona: 'ceo', nodeId: 'node-ceo-1', content: 'I delegate this.' }],
        pendingDelegations: [
          { fromSlug: 'ceo', toSlug: 'cfo', task: 'Analyse Q3 budget variance' },
        ],
      })
      .mockResolvedValueOnce({
        responses: [
          { persona: 'cfo', nodeId: 'node-cfo-delegated', content: 'Budget analysis complete.' },
        ],
        pendingDelegations: [],
      });

    setupDbMocks({ delegationTasksInsertRow: { id: 'dtask-001' } });

    await service.triggerAgentTurn(buildParams());

    // invokeTurnGraph called twice: primary turn + delegated sub-graph
    expect(mockInvokeTurnGraph).toHaveBeenCalledTimes(2);

    const calls = mockInvokeTurnGraph.mock.calls as Array<[Record<string, unknown>]>;
    const subGraphArg = calls[1]?.[0];

    expect(subGraphArg?.['isDelegated']).toBe(true);
    expect(subGraphArg?.['boundPersona']).toBe('cfo');
    // userNodeId for sub-graph should be the delegating agent's nodeId
    expect(subGraphArg?.['userNodeId']).toBe('node-ceo-1');
  });

  it('updates delegation_tasks: pending → running → done on sub-graph success', async () => {
    const subGraphNodeId = 'node-cfo-done';

    mockInvokeTurnGraph
      .mockResolvedValueOnce({
        responses: [{ persona: 'ceo', nodeId: 'node-ceo-1', content: 'Delegating.' }],
        pendingDelegations: [{ fromSlug: 'ceo', toSlug: 'cfo', task: 'Run the numbers' }],
      })
      // Second call (delegated sub-graph): invoke persistFn so delegatedPersistFn fires
      .mockImplementationOnce(async (args: Record<string, unknown>) => {
        const persistFn = args['persistFn'] as (p: Record<string, unknown>) => Promise<unknown>;
        await persistFn({
          responses: [{ persona: 'cfo', nodeId: subGraphNodeId, content: 'Done.' }],
          roomId: 'room-1',
          projectId: 'proj-1',
          branchId: 'branch-1',
          userNodeId: 'node-ceo-1',
        });
        return {
          responses: [{ persona: 'cfo', nodeId: subGraphNodeId, content: 'Done.' }],
          pendingDelegations: [],
        };
      });

    setupDbMocks({ delegationTasksInsertRow: { id: 'dtask-002' } });

    await service.triggerAgentTurn(buildParams());

    // Expect exactly two update calls: running, then done
    expect(capturedUpdates).toHaveLength(2);
    expect(capturedUpdates[0]?.set).toEqual({ status: 'running' });
    expect(capturedUpdates[1]?.set).toEqual({ status: 'done', resultNodeId: subGraphNodeId });

    // Delegated node creation must emit node.created
    expect(mockEventBusEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'node.created' })
    );
  });

  it('sets delegation_tasks status=failed and does not rethrow when sub-graph throws', async () => {
    mockInvokeTurnGraph
      .mockResolvedValueOnce({
        responses: [{ persona: 'ceo', nodeId: 'node-ceo-1', content: 'Delegating.' }],
        pendingDelegations: [{ fromSlug: 'ceo', toSlug: 'cfo', task: 'Run the numbers' }],
      })
      .mockRejectedValueOnce(new Error('model timeout'));

    setupDbMocks({ delegationTasksInsertRow: { id: 'dtask-003' } });

    // Must NOT throw — main turn already succeeded
    await expect(service.triggerAgentTurn(buildParams())).resolves.toBeDefined();

    // Two update calls: running then failed
    expect(capturedUpdates).toHaveLength(2);
    expect(capturedUpdates[0]?.set).toEqual({ status: 'running' });
    expect(capturedUpdates[1]?.set).toEqual({ status: 'failed' });
  });

  it('does not call invokeTurnGraph a second time when there are no delegations', async () => {
    mockInvokeTurnGraph.mockResolvedValueOnce({
      responses: [{ persona: 'ceo', nodeId: 'node-ceo-1', content: 'No delegation here.' }],
      pendingDelegations: [],
    });

    setupDbMocks({});

    await service.triggerAgentTurn(buildParams());

    expect(mockInvokeTurnGraph).toHaveBeenCalledTimes(1);
  });
});
