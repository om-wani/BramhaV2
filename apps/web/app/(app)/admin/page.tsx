'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/Toaster';

interface Me {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}
interface AdminFeedback {
  id: string;
  content: string;
  path: string | null;
  createdAt: string;
  userId: string;
  userEmail: string;
  userName: string;
}
interface Overview {
  tables: string[];
  counts: Record<string, number>;
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

// ---- feedback tab ----------------------------------------------------------

function FeedbackTab() {
  const q = useQuery<AdminFeedback[]>({
    queryKey: ['admin', 'feedback'],
    queryFn: () => apiFetch('/backend/admin/feedback'),
  });
  const rows = q.data ?? [];

  // group by user
  const byUser = new Map<string, AdminFeedback[]>();
  for (const r of rows) {
    const arr = byUser.get(r.userEmail) ?? [];
    arr.push(r);
    byUser.set(r.userEmail, arr);
  }

  if (q.isLoading) return <p className="text-sm text-[hsl(var(--text-muted))]">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-[hsl(var(--text-muted))]">No feedback yet.</p>;

  return (
    <div className="space-y-6">
      {[...byUser.entries()].map(([email, items]) => (
        <div key={email}>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold text-[hsl(var(--text-primary))]">{items[0]?.userName}</span>
            <span className="text-xs text-[hsl(var(--text-muted))]">{email}</span>
            <span className="text-xs text-[hsl(var(--text-muted))]">· {items.length} note(s)</span>
          </div>
          <div className="space-y-2">
            {items.map((f) => (
              <div key={f.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
                <p className="text-sm text-[hsl(var(--text-primary))] whitespace-pre-wrap break-words">{f.content}</p>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                  {new Date(f.createdAt).toLocaleString()}{f.path ? ` · ${f.path}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- tables tab ------------------------------------------------------------

function TablesTab({ overview }: { overview: Overview | undefined }) {
  const tables = overview?.tables ?? [];
  const [table, setTable] = useState<string>('');
  const qc = useQueryClient();
  const toast = useToast();
  const active = table || tables[0] || '';

  const rowsQuery = useQuery<Record<string, unknown>[]>({
    queryKey: ['admin', 'table', active],
    queryFn: () => apiFetch(`/backend/admin/tables/${active}`),
    enabled: !!active,
  });

  const del = useMutation<unknown, Error, string>({
    mutationFn: (id) => apiFetch(`/backend/admin/tables/${active}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'table', active] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast('Row deleted', { kind: 'success' });
    },
    onError: (e) => toast(e.message || 'Delete failed', { kind: 'error' }),
  });

  const toggleAdmin = useMutation<unknown, Error, { id: string; isAdmin: boolean }>({
    mutationFn: ({ id, isAdmin }) =>
      apiFetch(`/backend/admin/users/${id}/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'table', active] });
      toast('Updated', { kind: 'success' });
    },
    onError: (e) => toast(e.message || 'Update failed', { kind: 'error' }),
  });

  const rows = rowsQuery.data ?? [];
  const cols = rows.length > 0 ? Object.keys(rows[0] as object) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tables.map((t) => (
          <button
            key={t}
            onClick={() => setTable(t)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              t === active
                ? 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] font-semibold'
                : 'text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface))]'
            }`}
          >
            {t} <span className="opacity-60">({overview?.counts[t] ?? 0})</span>
          </button>
        ))}
      </div>

      {rowsQuery.isLoading ? (
        <p className="text-sm text-[hsl(var(--text-muted))]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[hsl(var(--text-muted))]">Empty.</p>
      ) : (
        <div className="overflow-auto border border-[hsl(var(--border))] rounded-lg max-h-[60vh]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-[hsl(var(--surface))]">
              <tr>
                {cols.map((c) => (
                  <th key={c} className="text-left px-2 py-1.5 font-semibold text-[hsl(var(--text-muted))] border-b border-[hsl(var(--border))] whitespace-nowrap">
                    {c}
                  </th>
                ))}
                <th className="px-2 py-1.5 border-b border-[hsl(var(--border))]">actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const id = String((row as Record<string, unknown>)['id'] ?? '');
                const isAdminRow = active === 'users' && (row as Record<string, unknown>)['isAdmin'] === true;
                return (
                  <tr key={id || i} className="hover:bg-[hsl(var(--surface)/0.5)]">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-1 border-b border-[hsl(var(--border))] whitespace-nowrap max-w-[220px] truncate text-[hsl(var(--text-primary))]" title={cellValue((row as Record<string, unknown>)[c])}>
                        {cellValue((row as Record<string, unknown>)[c])}
                      </td>
                    ))}
                    <td className="px-2 py-1 border-b border-[hsl(var(--border))] whitespace-nowrap">
                      <div className="flex gap-1.5">
                        {active === 'users' && id && (
                          <button
                            onClick={() => toggleAdmin.mutate({ id, isAdmin: !isAdminRow })}
                            className="text-[hsl(var(--accent))] hover:underline"
                          >
                            {isAdminRow ? 'revoke admin' : 'make admin'}
                          </button>
                        )}
                        {id && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete this ${active} row? This cannot be undone.`)) del.mutate(id);
                            }}
                            className="text-red-400 hover:underline"
                          >
                            delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default function AdminPage() {
  const [tab, setTab] = useState<'feedback' | 'tables'>('feedback');
  const meQuery = useQuery<Me>({ queryKey: ['me'], queryFn: () => apiFetch('/backend/auth/me'), retry: 0 });
  const overviewQuery = useQuery<Overview>({
    queryKey: ['admin', 'overview'],
    queryFn: () => apiFetch('/backend/admin/overview'),
    enabled: meQuery.data?.isAdmin === true,
  });

  if (meQuery.isLoading) {
    return <div className="p-8 text-sm text-[hsl(var(--text-muted))]">Loading…</div>;
  }
  if (!meQuery.data?.isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-1">Not authorized</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">This area is admin-only.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-[hsl(var(--text-primary))]">⚡ Godmode</h1>
        <span className="text-xs text-[hsl(var(--text-muted))]">signed in as {meQuery.data.email}</span>
      </div>

      <div className="flex gap-1.5 mb-5">
        {(['feedback', 'tables'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors capitalize ${
              tab === t
                ? 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] font-semibold'
                : 'text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--surface))]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'feedback' ? <FeedbackTab /> : <TablesTab overview={overviewQuery.data} />}
    </div>
  );
}
