import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, modelCalls, projectMembers } from '@bramha/db';

// ---------------------------------------------------------------------------
// Pricing (USD per 1M tokens). Estimates only — surface as "~$".
// Keys are matched by substring against the logged model name so gateway
// prefixes ("openai/gpt-4o-mini") still resolve.
// ---------------------------------------------------------------------------
const PRICES_PER_MTOK: Array<{ match: string; input: number; output: number }> = [
  { match: 'claude-sonnet', input: 3, output: 15 },
  { match: 'claude-haiku', input: 0.8, output: 4 },
  { match: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { match: 'gpt-4o', input: 2.5, output: 10 },
  { match: 'kimi-k2.6', input: 0.68, output: 3.42 },
  { match: 'llama-3.3-70b', input: 0.13, output: 0.4 },
  { match: 'text-embedding-3-small', input: 0.02, output: 0 },
  { match: 'text-embedding-3-large', input: 0.13, output: 0 },
];

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MTOK.find((p) => model.includes(p.match));
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export interface UsageBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelUsageRow extends UsageBucket {
  model: string;
}

export interface UsageSummary {
  total: UsageBucket;
  last24h: UsageBucket;
  byModel: ModelUsageRow[];
}

@Injectable()
export class UsageService {
  /**
   * Aggregate model_calls across every project the user is a member of.
   * Grouped by model so cost estimation can apply per-model pricing.
   */
  async getUsageForUser(userId: string): Promise<UsageSummary> {
    const db = await getDb();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        model: modelCalls.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${modelCalls.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${modelCalls.outputTokens}), 0)::int`,
        recentCalls: sql<number>`count(*) filter (where ${modelCalls.createdAt} >= ${dayAgo})::int`,
        recentInputTokens: sql<number>`coalesce(sum(${modelCalls.inputTokens}) filter (where ${modelCalls.createdAt} >= ${dayAgo}), 0)::int`,
        recentOutputTokens: sql<number>`coalesce(sum(${modelCalls.outputTokens}) filter (where ${modelCalls.createdAt} >= ${dayAgo}), 0)::int`,
      })
      .from(modelCalls)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, modelCalls.projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .groupBy(modelCalls.model);

    const total: UsageBucket = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const last24h: UsageBucket = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const byModel: ModelUsageRow[] = [];

    for (const row of rows) {
      const cost = estimateCostUsd(row.model, row.inputTokens, row.outputTokens);
      const recentCost = estimateCostUsd(row.model, row.recentInputTokens, row.recentOutputTokens);

      byModel.push({
        model: row.model,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: cost,
      });

      total.calls += row.calls;
      total.inputTokens += row.inputTokens;
      total.outputTokens += row.outputTokens;
      total.costUsd += cost;

      last24h.calls += row.recentCalls;
      last24h.inputTokens += row.recentInputTokens;
      last24h.outputTokens += row.recentOutputTokens;
      last24h.costUsd += recentCost;
    }

    byModel.sort((a, b) => b.costUsd - a.costUsd);

    return { total, last24h, byModel };
  }
}
