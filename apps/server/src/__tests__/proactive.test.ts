/**
 * P6.1 PA lite tests.
 *
 * Tests for ProactiveService (scanner) and AgentsService (PA lite capture).
 */

import 'reflect-metadata';
import { describe, it, beforeEach, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock functions
// ---------------------------------------------------------------------------

const { mockInvokeTurnGraph, mockDb, mockEventBusEmit } = vi.hoisted(() => {
  const mockInvokeTurnGraph = vi.fn();
  const mockEventBusEmit = vi.fn();

  const mockDb = {
    select: vi.fn(),
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
  },
  computeDomainEmbeddings: vi.fn().mockResolvedValue(new Map()),
  getModelRouter: vi.fn().mockReturnValue({}),
  invokeTurnGraph: mockInvokeTurnGraph,
}));

vi.mock('@bramha/db', () => ({
  getDb: () => Promise.resolve(mockDb),
  projects: 'projects_table',
  rooms: 'rooms_table',
  conversationNodes: 'conversationNodes_table',
  branches: 'branches_table',
  delegationTasks: { id: 'delegation_tasks_id_col' },
  searchKnowledge: vi.fn().mockResolvedValue([]),
}));

vi.mock('@bramha/event-bus', () => ({
  eventBus: { emit: mockEventBusEmit },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({ type: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  gt: vi.fn(() => ({ type: 'gt' })),
  lt: vi.fn(() => ({ type: 'lt' })),
}));

// ---------------------------------------------------------------------------
// SUT imports — after mocks
// ---------------------------------------------------------------------------

import { AgentsService } from '../modules/agents/agents.service.js';
import { ProactiveService } from '../modules/proactive/proactive.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentsService(): AgentsService {
  const svc = new AgentsService();
  (svc as unknown as { domainEmbeddings: Map<string, number[]> }).domainEmbeddings = new Map();
  return svc;
}

function makeProactiveService(agentsService?: AgentsService): ProactiveService {
  const as = agentsService ?? makeAgentsService();
  return new ProactiveService(as);
}

/** Fluent builder for mockDb.select chains */
function buildSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  // Allow awaiting the chain directly (no .limit call) by making it a thenable
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// ProactiveService.scan() tests
// ---------------------------------------------------------------------------

describe('ProactiveService.scan()', () => {
  let service: ProactiveService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeProactiveService();
  });

  it('no eligible projects → invokeTurnGraph never called', async () => {
    // select returns empty array for projects query
    mockDb.select.mockReturnValueOnce(buildSelectChain([]));

    await service.scan();

    expect(mockInvokeTurnGraph).not.toHaveBeenCalled();
  });

  it('skips loops < 24h old', async () => {
    const wm = {
      open_loops: [
        {
          roomId: 'room-1',
          persona: 'ceo',
          text: 'Let me know if you need anything',
          nodeId: 'node-1',
          createdAt: hoursAgo(12), // only 12h old — not stale yet
        },
      ],
    };

    mockDb.select.mockReturnValueOnce(
      buildSelectChain([
        { id: 'proj-1', name: 'Acme', orgId: 'org-1', workingMemory: wm },
      ]),
    );

    await service.scan();

    expect(mockInvokeTurnGraph).not.toHaveBeenCalled();
  });

  it('skips projects with lastProactiveAt < 4h ago', async () => {
    const wm = {
      open_loops: [
        {
          roomId: 'room-1',
          persona: 'ceo',
          text: 'Let me know if you need anything',
          nodeId: 'node-1',
          createdAt: hoursAgo(30), // stale enough
        },
      ],
      lastProactiveAt: hoursAgo(2), // fired 2h ago — still in cooldown
    };

    mockDb.select.mockReturnValueOnce(
      buildSelectChain([
        { id: 'proj-1', name: 'Acme', orgId: 'org-1', workingMemory: wm },
      ]),
    );

    await service.scan();

    expect(mockInvokeTurnGraph).not.toHaveBeenCalled();
  });

  it('fires nudge when all conditions met — loop removed and lastProactiveAt set', async () => {
    const loop = {
      roomId: 'room-1',
      persona: 'ceo',
      text: 'Next step is to review the budget',
      nodeId: 'node-1',
      createdAt: hoursAgo(30), // stale
    };
    const wm = { open_loops: [loop] };

    // projects query
    mockDb.select
      .mockReturnValueOnce(
        buildSelectChain([
          { id: 'proj-1', name: 'Acme', orgId: 'org-1', workingMemory: wm },
        ]),
      )
      // usersSince query (no user nodes since then)
      .mockReturnValueOnce(buildSelectChain([]))
      // room query
      .mockReturnValueOnce(buildSelectChain([{ id: 'room-1', kind: 'one_on_one', boundPersona: 'ceo' }]))
      // branch query
      .mockReturnValueOnce(buildSelectChain([{ id: 'branch-1', headNodeId: 'head-node-1' }]));

    // invokeTurnGraph — exercise persistFn so proactivePersistFn is covered
    const capturedInserts: Array<Record<string, unknown>> = [];
    mockDb.insert.mockReturnValue({
      values: (vals: Record<string, unknown>) => {
        capturedInserts.push(vals);
        return {
          returning: () =>
            Promise.resolve([{ id: 'proactive-node-001', roomId: 'room-1', persona: 'cto' }]),
        };
      },
    });

    // update call — first calls come from branch head advance (with .returning()), last from workingMemory update
    const capturedSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockReturnValue({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          capturedSets.push(vals);
          // Return a thenable AND expose .returning() for the CAS branch-head update
          const result = Promise.resolve([{ id: 'branch-1' }]);
          return Object.assign(result, {
            returning: () => Promise.resolve([{ id: 'branch-1' }]),
          });
        },
      }),
    });

    mockInvokeTurnGraph.mockImplementationOnce(async (params: Record<string, unknown>) => {
      // Call the injected persistFn so proactivePersistFn is exercised
      const persistFn = params['persistFn'] as (p: Record<string, unknown>) => Promise<unknown>;
      await persistFn({
        projectId: params['projectId'],
        roomId: params['roomId'],
        branchId: params['branchId'],
        userNodeId: params['userNodeId'],
        responses: [{ persona: 'cto', content: 'Follow-up content.', metadata: {} }],
      });
      return { responses: [{ persona: 'cto', nodeId: 'proactive-node-001', content: 'Follow-up content.' }], pendingDelegations: [] };
    });

    await service.scan();

    expect(mockInvokeTurnGraph).toHaveBeenCalledTimes(1);
    const callArg = mockInvokeTurnGraph.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg?.['isDelegated']).toBe(true);
    expect(callArg?.['roomKind']).toBe('one_on_one');
    expect((callArg?.['userMessage'] as string)).toContain('Next step is to review the budget');

    // Assert that the inserted node had metadata.proactive === true
    expect(capturedInserts).toHaveLength(1);
    const insertedNode = capturedInserts[0] as { metadata: Record<string, unknown> };
    expect(insertedNode?.metadata).toEqual(expect.objectContaining({ proactive: true }));

    // The working_memory update should have the loop removed and lastProactiveAt set
    const wmSet = capturedSets.find((s) => s['workingMemory'] !== undefined);
    expect(wmSet).toBeDefined();
    const updatedWm = wmSet?.['workingMemory'] as {
      open_loops: unknown[];
      lastProactiveAt?: string;
    };
    expect(updatedWm?.open_loops).toHaveLength(0);
    expect(updatedWm?.lastProactiveAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AgentsService — PA lite capture tests
// ---------------------------------------------------------------------------

describe('AgentsService — PA lite capture', () => {
  let service: AgentsService;

  function setupMainTurnMocks(opts: {
    responses: Array<{ persona: string; nodeId: string; content: string }>;
    workingMemory?: Record<string, unknown>;
  }) {
    mockInvokeTurnGraph.mockResolvedValueOnce({
      responses: opts.responses,
      pendingDelegations: [],
    });

    const wm = opts.workingMemory ?? { open_loops: [] };

    let selectCallCount = 0;
    mockDb.select.mockImplementation(() => {
      selectCallCount += 1;
      // First select: projects (for PA capture)
      if (selectCallCount === 1) {
        return buildSelectChain([{ workingMemory: wm }]);
      }
      return buildSelectChain([]);
    });

    const capturedSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockReturnValue({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          capturedSets.push(vals);
          return Promise.resolve([{ headNodeId: 'new-head' }]);
        },
      }),
    });

    mockDb.insert.mockReturnValue({
      values: () => ({
        returning: () =>
          Promise.resolve([
            {
              id: 'agent-node-1',
              roomId: 'room-1',
              persona: opts.responses[0]?.persona ?? 'ceo',
            },
          ]),
      }),
    });

    return capturedSets;
  }

  function buildParams(overrides?: Record<string, unknown>) {
    return {
      projectId: 'proj-1',
      roomId: 'room-1',
      branchId: 'branch-1',
      orgName: 'Acme',
      userNodeId: 'user-node-1',
      userMessage: 'What is the plan?',
      roomKind: 'one_on_one' as const,
      thread: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeAgentsService();
  });

  it('captures open loop when 1:1 room and response line ends with ?', async () => {
    const capturedSets = setupMainTurnMocks({
      responses: [
        {
          persona: 'ceo',
          nodeId: 'agent-node-1',
          content: 'Here is my plan.\nWould you like more detail on Phase 2?',
        },
      ],
    });

    await service.triggerAgentTurn(buildParams({ roomKind: 'one_on_one' }));

    // Should have called update with workingMemory containing the captured loop
    const wmUpdate = capturedSets.find((s) => s['workingMemory'] !== undefined);
    expect(wmUpdate).toBeDefined();
    const wm = wmUpdate?.['workingMemory'] as { open_loops: Array<{ text: string }> };
    expect(wm?.open_loops).toHaveLength(1);
    expect(wm?.open_loops[0]?.text).toContain('?');
  });

  it('does NOT capture when room is council', async () => {
    const capturedSets = setupMainTurnMocks({
      responses: [
        {
          persona: 'ceo',
          nodeId: 'agent-node-1',
          content: 'Let me know if you need anything else.',
        },
      ],
    });

    await service.triggerAgentTurn(buildParams({ roomKind: 'council' }));

    // No workingMemory update should be triggered for council rooms
    const wmUpdate = capturedSets.find((s) => s['workingMemory'] !== undefined);
    expect(wmUpdate).toBeUndefined();
  });
});
