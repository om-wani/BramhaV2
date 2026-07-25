/**
 * UsageService tests — aggregation shape and per-model cost estimation.
 * DB mocked; the SQL itself is exercised by the running app (PGlite/PG both
 * accept the FILTER clause used).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: { select: vi.fn() },
}));

vi.mock('@bramha/db', () => ({
  getDb: () => Promise.resolve(mockDb),
  modelCalls: { model: 'model', inputTokens: 'in', outputTokens: 'out', createdAt: 'created', projectId: 'pid' },
  projectMembers: { projectId: 'pid', userId: 'uid' },
}));

import { UsageService } from '../usage.service.js';

interface Row {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  recentCalls: number;
  recentInputTokens: number;
  recentOutputTokens: number;
}

function setupRows(rows: Row[]) {
  mockDb.select.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        groupBy: () => Promise.resolve(rows),
      }),
    }),
  });
}

describe('UsageService.getUsageForUser', () => {
  let service: UsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UsageService();
  });

  it('returns zeroed buckets when there are no calls', async () => {
    setupRows([]);
    const usage = await service.getUsageForUser('u1');
    expect(usage.total).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(usage.last24h).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(usage.byModel).toEqual([]);
  });

  it('estimates cost per model: kimi-k2.6 at $0.68/$3.42 per M tokens', async () => {
    setupRows([
      {
        model: 'moonshotai/kimi-k2.6',
        calls: 2,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        recentCalls: 0,
        recentInputTokens: 0,
        recentOutputTokens: 0,
      },
    ]);
    const usage = await service.getUsageForUser('u1');
    expect(usage.total.costUsd).toBeCloseTo(0.68 + 3.42, 5);
  });

  it('sums totals across models and computes last24h independently', async () => {
    setupRows([
      {
        model: 'moonshotai/kimi-k2.6',
        calls: 10,
        inputTokens: 500_000,
        outputTokens: 100_000,
        recentCalls: 2,
        recentInputTokens: 100_000,
        recentOutputTokens: 20_000,
      },
      {
        model: 'text-embedding-3-small',
        calls: 40,
        inputTokens: 2_000_000,
        outputTokens: 0,
        recentCalls: 5,
        recentInputTokens: 250_000,
        recentOutputTokens: 0,
      },
    ]);
    const usage = await service.getUsageForUser('u1');

    expect(usage.total.calls).toBe(50);
    expect(usage.total.inputTokens).toBe(2_500_000);
    expect(usage.last24h.calls).toBe(7);
    expect(usage.last24h.inputTokens).toBe(350_000);

    // kimi: 0.5*0.68 + 0.1*3.42 = 0.34 + 0.342 = 0.682; embed: 2*0.02 = 0.04
    expect(usage.total.costUsd).toBeCloseTo(0.682 + 0.04, 5);
    // last24h kimi: 0.1*0.68 + 0.02*3.42 = 0.068+0.0684; embed: 0.25*0.02 = 0.005
    expect(usage.last24h.costUsd).toBeCloseTo(0.068 + 0.0684 + 0.005, 5);
  });

  it('unknown models cost $0 but still count calls/tokens', async () => {
    setupRows([
      {
        model: 'mystery/model-x',
        calls: 3,
        inputTokens: 999,
        outputTokens: 999,
        recentCalls: 3,
        recentInputTokens: 999,
        recentOutputTokens: 999,
      },
    ]);
    const usage = await service.getUsageForUser('u1');
    expect(usage.total.calls).toBe(3);
    expect(usage.total.costUsd).toBe(0);
  });

  it('sorts byModel descending by cost', async () => {
    const zero = { recentCalls: 0, recentInputTokens: 0, recentOutputTokens: 0 };
    setupRows([
      { model: 'text-embedding-3-small', calls: 1, inputTokens: 1_000_000, outputTokens: 0, ...zero },
      { model: 'moonshotai/kimi-k2.6', calls: 1, inputTokens: 1_000_000, outputTokens: 0, ...zero },
    ]);
    const usage = await service.getUsageForUser('u1');
    expect(usage.byModel[0]?.model).toBe('moonshotai/kimi-k2.6');
  });
});
