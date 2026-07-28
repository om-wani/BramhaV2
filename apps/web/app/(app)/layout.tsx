'use client';

import { useState, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { StatusBar } from '@/components/StatusBar';
import { ToastProvider } from '@/components/Toaster';
import { FeedbackWidget } from '@/components/FeedbackWidget';

interface Org {
  id: string;
  name: string;
  role: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function NewOrgDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (n: string) =>
      apiFetch('/backend/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create org.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-org-dialog-title"
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3
          id="new-org-dialog-title"
          className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4"
        >
          New organisation
        </h3>
        <input
          autoFocus
          type="text"
          aria-label="Organisation name"
          placeholder="Acme Corp"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && mutation.mutate(name.trim())}
          className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] text-sm mb-3"
        />
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate(name.trim())}
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({
  orgId,
  onClose,
}: {
  orgId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (n: string) =>
      apiFetch(`/backend/orgs/${orgId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', orgId] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create project.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-dialog-title"
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3
          id="new-project-dialog-title"
          className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4"
        >
          New project
        </h3>
        <input
          autoFocus
          type="text"
          aria-label="Project name"
          placeholder="Q3 Strategy"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && mutation.mutate(name.trim())}
          className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] text-sm mb-3"
        />
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate(name.trim())}
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const orgsQuery = useQuery<Org[]>({
    queryKey: ['orgs'],
    queryFn: () => apiFetch('/backend/orgs'),
    retry: 0,
  });

  const meQuery = useQuery<{ id: string; email: string; name: string; isAdmin: boolean }>({
    queryKey: ['me'],
    queryFn: () => apiFetch('/backend/auth/me'),
    retry: 0,
    staleTime: 300_000,
  });
  const isAdmin = meQuery.data?.isAdmin ?? false;

  const orgs = orgsQuery.data ?? [];
  const currentOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0] ?? null;
  const currentOrgId = currentOrg?.id ?? null;

  const projectsQuery = useQuery<Project[]>({
    queryKey: ['projects', currentOrgId],
    queryFn: () => apiFetch(`/backend/orgs/${currentOrgId}/projects`),
    enabled: currentOrgId !== null,
  });

  const projects = projectsQuery.data ?? [];

  async function handleLogout() {
    try {
      await apiFetch('/backend/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    qc.clear();
    router.push('/login');
  }

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] font-medium'
            : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--surface))]'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <ToastProvider>
    <div className="h-screen flex flex-col bg-[hsl(var(--canvas))]">
      <div className="flex flex-1 min-h-0">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <span className="font-bold text-base text-[hsl(var(--text-primary))]">Bramha</span>
          <FeedbackWidget />
        </div>

        {/* Org switcher */}
        <div className="px-3 py-3 border-b border-[hsl(var(--border))]">
          <p className="text-[10px] uppercase tracking-widest text-[hsl(var(--text-muted))] mb-2 px-1">
            Organisation
          </p>
          {orgsQuery.isLoading ? (
            <div className="h-8 rounded-lg bg-[hsl(var(--canvas))] animate-pulse" />
          ) : orgs.length === 0 ? (
            <button
              onClick={() => setShowNewOrg(true)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-[hsl(var(--accent))] hover:bg-[hsl(var(--canvas))] transition-colors"
            >
              + Create org
            </button>
          ) : (
            <>
              <select
                value={currentOrgId ?? ''}
                onChange={(e) => setActiveOrgId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowNewOrg(true)}
                className="w-full text-left px-3 py-1.5 mt-1 rounded-lg text-xs text-[hsl(var(--accent))] hover:bg-[hsl(var(--canvas))] transition-colors"
              >
                + New organisation
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navLink('/dashboard', 'Dashboard')}

          {/* Projects */}
          {currentOrgId && (
            <div className="pt-3">
              <p className="text-[10px] uppercase tracking-widest text-[hsl(var(--text-muted))] mb-2 px-1">
                Projects
              </p>
              {projectsQuery.isLoading ? (
                <div className="space-y-1">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-8 rounded-lg bg-[hsl(var(--canvas))] animate-pulse" />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <p className="text-xs text-[hsl(var(--text-muted))] px-3 py-2">No projects yet</p>
              ) : (
                projects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/p/${currentOrg ? slugify(currentOrg.name) : currentOrgId}/${slugify(p.name)}`}
                    className="block px-3 py-2 rounded-lg text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))] transition-colors truncate"
                  >
                    {p.name}
                  </Link>
                ))
              )}
              <button
                onClick={() => setShowNewProject(true)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-[hsl(var(--accent))] hover:bg-[hsl(var(--canvas))] transition-colors mt-1"
              >
                + New project
              </button>
            </div>
          )}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-3 border-t border-[hsl(var(--border))] space-y-1">
          {isAdmin && navLink('/admin', '⚡ Godmode')}
          {navLink('/settings', 'Settings')}
          {currentOrg && (
            <div className="px-3 py-1 text-xs text-[hsl(var(--text-muted))] truncate">
              {currentOrg.name} · {currentOrg.role}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-[hsl(var(--text-muted))] hover:text-red-400 hover:bg-[hsl(var(--canvas))] transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Status bar — always visible */}
      <StatusBar />

      {/* Dialogs */}
      {showNewOrg && <NewOrgDialog onClose={() => setShowNewOrg(false)} />}
      {showNewProject && currentOrgId && (
        <NewProjectDialog orgId={currentOrgId} onClose={() => setShowNewProject(false)} />
      )}
    </div>
    </ToastProvider>
  );
}
