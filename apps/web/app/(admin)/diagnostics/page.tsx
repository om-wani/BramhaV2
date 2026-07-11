'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Schemas ──────────────────────────────────────────────────────────────────

const TokenUsageSchema = z.array(z.object({
  projectId: z.string(),
  personaId: z.string().nullable(),
  model: z.string(),
  day: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
}))

const QueueDepthItemSchema = z.object({
  waiting: z.number(),
  active:  z.number(),
  delayed: z.number(),
  failed:  z.number(),
})
const QueueDepthSchema = z.record(z.string(), QueueDepthItemSchema)

type TokenUsageRow = z.infer<typeof TokenUsageSchema>[number]
type QueueDepthMap = z.infer<typeof QueueDepthSchema>
type QueueDepthEntry = z.infer<typeof QueueDepthItemSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const { data: tokenUsage, isLoading: tuLoading } = useQuery({
    queryKey: ['admin', 'diagnostics', 'token-usage'],
    queryFn: () => api.get('/admin/diagnostics/token-usage', TokenUsageSchema),
  })

  const { data: queueDepths, isLoading: qdLoading } = useQuery({
    queryKey: ['admin', 'diagnostics', 'queue-depths'],
    queryFn: () => api.get('/admin/diagnostics/queue-depths', QueueDepthSchema),
    refetchInterval: 15_000, // refresh every 15s
  })

  // Aggregate totals
  const totalCost = tokenUsage?.reduce((acc, r) => acc + r.costUsd, 0) ?? 0
  const totalInput = tokenUsage?.reduce((acc, r) => acc + r.inputTokens, 0) ?? 0
  const totalOutput = tokenUsage?.reduce((acc, r) => acc + r.outputTokens, 0) ?? 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Diagnostics</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total cost (30d)
            </p>
            <p className="text-3xl font-bold">{formatCost(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Input tokens (30d)
            </p>
            <p className="text-3xl font-bold">{totalInput.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Output tokens (30d)
            </p>
            <p className="text-3xl font-bold">{totalOutput.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Token spend table */}
      <Card>
        <CardHeader>
          <CardTitle>Token Spend — Last 30 Days</CardTitle>
        </CardHeader>
        <CardContent>
          {tuLoading ? (
            <div className="h-48 rounded-lg bg-muted animate-pulse" />
          ) : !tokenUsage?.length ? (
            <p className="text-sm text-muted-foreground">
              No token usage data yet. Refresh the token_usage_daily materialized view:
              <code className="ml-1 text-xs font-mono bg-muted px-1 py-0.5 rounded">
                REFRESH MATERIALIZED VIEW token_usage_daily;
              </code>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium text-right">Input</th>
                    <th className="px-3 py-2 font-medium text-right">Output</th>
                    <th className="px-3 py-2 font-medium text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tokenUsage.map((r: TokenUsageRow, i: number) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">{formatDate(r.day)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.projectId.slice(0, 8)}&hellip;
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{r.model}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inputTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {formatCost(r.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td colSpan={3} className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totalInput.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {totalOutput.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCost(totalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Queue depths */}
      <Card>
        <CardHeader>
          <CardTitle>
            BullMQ Queue Depths
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (refreshes every 15s)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {qdLoading ? (
            <div className="h-24 rounded-lg bg-muted animate-pulse" />
          ) : !queueDepths || Object.keys(queueDepths).length === 0 ? (
            <p className="text-sm text-muted-foreground">No queues found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Queue</th>
                    <th className="px-3 py-2 font-medium text-right">Waiting</th>
                    <th className="px-3 py-2 font-medium text-right">Active</th>
                    <th className="px-3 py-2 font-medium text-right">Delayed</th>
                    <th className="px-3 py-2 font-medium text-right">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(queueDepths as QueueDepthMap).map(([name, depth]: [string, QueueDepthEntry]) => (
                    <tr key={name} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">{name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {depth.waiting < 0 ? '—' : depth.waiting}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {depth.active < 0 ? '—' : depth.active}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {depth.delayed < 0 ? '—' : depth.delayed}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={depth.failed > 0 ? 'text-destructive font-medium' : ''}>
                          {depth.failed < 0 ? '—' : depth.failed}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
