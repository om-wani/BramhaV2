'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useToast } from './Toaster';

interface FeedbackRow {
  id: string;
  content: string;
  path: string | null;
  createdAt: string;
}

const DRAFT_KEY = 'bramha_feedback_draft';

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false); // starts collapsed
  const [draft, setDraft] = useState('');
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Restore persisted draft on mount
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(DRAFT_KEY) : null;
    if (saved) setDraft(saved);
  }, []);

  // Persist draft as the user types
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DRAFT_KEY, draft);
  }, [draft]);

  const mineQuery = useQuery<FeedbackRow[]>({
    queryKey: ['feedback', 'mine'],
    queryFn: () => apiFetch('/backend/feedback/mine'),
    enabled: open,
    staleTime: 30_000,
  });

  const submit = useMutation<FeedbackRow, Error, string>({
    mutationFn: (content) =>
      apiFetch('/backend/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, path: pathname }),
      }),
    onSuccess: () => {
      setDraft('');
      if (typeof window !== 'undefined') window.localStorage.removeItem(DRAFT_KEY);
      void qc.invalidateQueries({ queryKey: ['feedback', 'mine'] });
      toast('Thanks — feedback saved', { kind: 'success' });
    },
    onError: () => toast('Could not save feedback', { kind: 'error' }),
  });

  const mine = mineQuery.data ?? [];

  return (
    <div className="fixed bottom-9 left-4 z-40 flex flex-col items-start gap-2">
      {open && (
        <div className="w-80 max-h-[70vh] flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-xs font-semibold text-[hsl(var(--text-primary))]">Demo feedback</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Collapse feedback"
              className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] text-sm"
            >
              ✕
            </button>
          </div>

          {/* New note */}
          <div className="p-3 border-b border-[hsl(var(--border))]">
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Notes, bugs, what you liked… (saved as a draft until you submit)"
              rows={4}
              maxLength={5000}
              className="w-full resize-none px-2.5 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] text-sm"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-[hsl(var(--text-muted))]">Submitted notes can’t be edited.</span>
              <button
                onClick={() => draft.trim() && submit.mutate(draft.trim())}
                disabled={!draft.trim() || submit.isPending}
                className="px-3 py-1.5 text-xs rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submit.isPending ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </div>

          {/* Past submissions — read-only */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {mineQuery.isLoading ? (
              <p className="text-xs text-[hsl(var(--text-muted))]">Loading…</p>
            ) : mine.length === 0 ? (
              <p className="text-xs text-[hsl(var(--text-muted))]">No submitted notes yet.</p>
            ) : (
              mine.map((f) => (
                <div key={f.id} className="rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] px-2.5 py-2">
                  <p className="text-xs text-[hsl(var(--text-primary))] whitespace-pre-wrap break-words">{f.content}</p>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">{relTime(f.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => taRef.current?.focus(), 50);
        }}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[hsl(var(--accent))] text-white text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
      >
        <span aria-hidden="true">💬</span>
        {open ? 'Hide' : 'Feedback'}
      </button>
    </div>
  );
}
