'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { StatusBar } from '@/components/StatusBar';
import { ToastProvider } from '@/components/Toaster';
import {
  Zap,
  PanelLeftClose,
  PanelLeft,
  LayoutDashboard,
  Plus,
  User,
  Settings as SettingsIcon,
  LogOut,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react';

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

interface Me {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}

const COLLAPSE_KEY = 'bramha_sidebar_collapsed';

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function initialsOf(me: Me | undefined): string {
  const src = me?.name?.trim() || me?.email || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return src.slice(0, 1).toUpperCase();
}

function NewProjectDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
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
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-2xl squircle p-6 w-full max-w-sm shadow-xl"
      >
        <h3 id="new-project-dialog-title" className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">
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

/** Bottom-of-sidebar profile avatar with an expand/collapse menu. */
function ProfileMenu({
  me,
  org,
  collapsed,
  onLogout,
}: {
  me: Me | undefined;
  org: Org | null;
  collapsed: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const displayName = me?.name?.trim() || me?.email || 'You';

  const item =
    'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))] transition-colors';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={displayName}
        className={`flex items-center gap-2 w-full rounded-lg px-2 py-2 hover:bg-[hsl(var(--canvas))] transition-colors ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full bg-[hsl(var(--accent))] text-white text-xs font-semibold">
          {initialsOf(me)}
        </span>
        {!collapsed && (
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-sm text-[hsl(var(--text-primary))] truncate">{displayName}</span>
            {org && (
              <span className="block text-[11px] text-[hsl(var(--text-muted))] truncate">{org.name}</span>
            )}
          </span>
        )}
        {!collapsed && <ChevronUp className={`w-4 h-4 shrink-0 text-[hsl(var(--text-muted))] transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden="true" />}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute bottom-full mb-2 z-50 w-56 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-2xl overflow-hidden ${
            collapsed ? 'left-0' : 'left-0 right-0'
          }`}
        >
          <div className="px-3 py-3 border-b border-[hsl(var(--border))]">
            <p className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">{displayName}</p>
            {me?.email && <p className="text-[11px] text-[hsl(var(--text-muted))] truncate">{me.email}</p>}
            {org && (
              <p className="text-[11px] text-[hsl(var(--text-muted))] truncate mt-1">
                {org.name} · {org.role}
              </p>
            )}
          </div>
          <div className="p-1">
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <User className="w-4 h-4" aria-hidden="true" /> View profile
            </Link>
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <SettingsIcon className="w-4 h-4" aria-hidden="true" /> Settings
            </Link>
            {me?.isAdmin && (
              <Link href="/admin" role="menuitem" onClick={() => setOpen(false)} className={item}>
                <Zap className="w-4 h-4" aria-hidden="true" /> Godmode
              </Link>
            )}
          </div>
          <div className="p-1 border-t border-[hsl(var(--border))]">
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              role="menuitem"
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[hsl(var(--text-muted))] hover:text-red-400 hover:bg-[hsl(var(--canvas))] transition-colors"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  // Restore collapsed preference after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === '1') {
      setCollapsed(true);
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      if (typeof window !== 'undefined') window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const orgsQuery = useQuery<Org[]>({
    queryKey: ['orgs'],
    queryFn: () => apiFetch('/backend/orgs'),
    retry: 0,
  });

  const meQuery = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => apiFetch('/backend/auth/me'),
    retry: 0,
    staleTime: 300_000,
  });

  const orgs = orgsQuery.data ?? [];
  // Personal org — the first (and usually only) org the user belongs to.
  const currentOrg = orgs[0] ?? null;
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

  const navLink = (href: string, label: string, Icon: LucideIcon) => {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          collapsed ? 'justify-center' : ''
        } ${
          active
            ? 'bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] font-medium'
            : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))]'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {!collapsed && label}
      </Link>
    );
  };

  return (
    <ToastProvider>
      <div className="h-screen flex flex-col bg-[hsl(var(--canvas))]">
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <aside
            className={`${collapsed ? 'w-14' : 'w-60'} shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface))] transition-[width] duration-200`}
          >
            {/* Logo + collapse toggle */}
            <div className="px-3 py-4 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
              {!collapsed && <span className="font-bold text-base text-[hsl(var(--text-primary))] pl-1">Bramha</span>}
              <button
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={`p-1.5 rounded-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--canvas))] transition-colors ${
                  collapsed ? 'mx-auto' : ''
                }`}
              >
                {collapsed ? <PanelLeft className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
              {navLink('/dashboard', 'Dashboard', LayoutDashboard)}

              {!collapsed && currentOrgId && (
                <div className="pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-[hsl(var(--text-muted))] mb-2 px-2">
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
                    className="flex items-center gap-1 w-full text-left px-3 py-2 rounded-lg text-xs text-[hsl(var(--accent))] hover:bg-[hsl(var(--canvas))] transition-colors mt-1"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New project
                  </button>
                </div>
              )}
            </nav>

            {/* Bottom: profile menu */}
            <div className="px-2 py-3 border-t border-[hsl(var(--border))]">
              <ProfileMenu me={meQuery.data} org={currentOrg} collapsed={collapsed} onLogout={handleLogout} />
            </div>
          </aside>

          {/* Main */}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>

        {/* Status bar — always visible (feedback lives in its center) */}
        <StatusBar />

        {/* Dialogs */}
        {showNewProject && currentOrgId && (
          <NewProjectDialog orgId={currentOrgId} onClose={() => setShowNewProject(false)} />
        )}
      </div>
    </ToastProvider>
  );
}
