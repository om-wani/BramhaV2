'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { FeedbackWidget } from './FeedbackWidget';

// Mirrors UsageSummary from apps/server usage.service
interface UsageBucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageSummary {
  total: UsageBucket;
  last24h: UsageBucket;
  byModel: Array<UsageBucket & { model: string }>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Derive a short human label for the current route. */
function contextLabel(pathname: string): string {
  if (pathname.startsWith('/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/settings')) return 'Settings';
  const parts = pathname.split('/').filter(Boolean);
  // /p/[org]/[project]/...
  if (parts[0] === 'p' && parts.length >= 3) {
    const org = parts[1] ?? '';
    const project = parts[2] ?? '';
    if (parts[3] === 'r') return `${org} / ${project} · room`;
    if (parts[3] === 'files') return `${org} / ${project} · files`;
    return `${org} / ${project}`;
  }
  return 'Bramha';
}

export function StatusBar() {
  const pathname = usePathname();
  const inRoom = /\/r\/[^/]+$/.test(pathname);
  const [socketConnected, setSocketConnected] = useState(false);

  // Track socket connectivity (socket connects only inside rooms)
  useEffect(() => {
    const socket = getSocket();
    setSocketConnected(socket.connected);
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const usageQuery = useQuery<UsageSummary>({
    queryKey: ['usage', 'me'],
    queryFn: () => apiFetch('/backend/usage/me'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const usage = usageQuery.data;

  return (
    <div
      role="status"
      aria-label="Status bar"
      className="shrink-0 flex items-center justify-between gap-4 h-7 px-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[11px] text-[hsl(var(--text-muted))] select-none"
    >
      {/* Left: route context + realtime status */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="truncate">{contextLabel(pathname)}</span>
        {inRoom && (
          <span className="flex items-center gap-1 shrink-0" title={socketConnected ? 'Realtime connected' : 'Realtime disconnected'}>
            <span
              aria-hidden="true"
              className={`inline-block w-1.5 h-1.5 rounded-full ${socketConnected ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            {socketConnected ? 'live' : 'offline'}
          </span>
        )}
      </div>

      {/* Center: demo feedback */}
      <div className="shrink-0">
        <FeedbackWidget />
      </div>

      {/* Right: usage — always visible */}
      <div className="flex-1 flex items-center justify-end gap-3 shrink-0 tabular-nums">
        {usage ? (
          <>
            <span title="Model calls · tokens in+out · estimated cost — last 24 hours">
              24h: {usage.last24h.calls} calls · {formatTokens(usage.last24h.inputTokens + usage.last24h.outputTokens)} tok · ~{formatCost(usage.last24h.costUsd)}
            </span>
            <span aria-hidden="true" className="opacity-40">|</span>
            <span title="All-time estimated spend across your projects">
              total ~{formatCost(usage.total.costUsd)}
            </span>
          </>
        ) : (
          <span>{usageQuery.isError ? 'usage unavailable' : 'usage…'}</span>
        )}
      </div>
    </div>
  );
}
