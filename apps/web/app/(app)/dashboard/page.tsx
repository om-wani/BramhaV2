'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Building2, Sparkles, ArrowRight } from 'lucide-react';

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

function CreateProjectDialog({
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
      qc.invalidateQueries({ queryKey: ['dashboard-projects', orgId] });
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
        aria-labelledby="create-project-dialog-title"
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3
          id="create-project-dialog-title"
          className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-1"
        >
          New project
        </h3>
        <p className="text-sm text-[hsl(var(--text-muted))] mb-4">
          Give your project a name to get started.
        </p>
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
            {mutation.isPending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateOrgDialog({ onClose }: { onClose: () => void }) {
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
      setError(err.message || 'Failed to create organisation.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-org-dialog-title"
        className="bg-[hsl(var(--surface))] border border-[hsl(var(--border))] rounded-xl p-6 w-full max-w-sm shadow-xl"
      >
        <h3
          id="create-org-dialog-title"
          className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-1"
        >
          New organisation
        </h3>
        <p className="text-sm text-[hsl(var(--text-muted))] mb-4">
          Create an org to group your projects and team.
        </p>
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
            {mutation.isPending ? 'Creating…' : 'Create org'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);

  // Incomplete accounts (no name / no first project) belong in onboarding.
  const meQuery = useQuery<{ needsOnboarding: boolean }>({
    queryKey: ['me'],
    queryFn: () => apiFetch('/backend/auth/me'),
    retry: 0,
  });
  useEffect(() => {
    if (meQuery.data?.needsOnboarding) router.replace('/onboarding');
  }, [meQuery.data, router]);

  const orgsQuery = useQuery<Org[]>({
    queryKey: ['orgs'],
    queryFn: () => apiFetch('/backend/orgs'),
    retry: 0,
  });

  const orgs = orgsQuery.data ?? [];
  const firstOrg = orgs[0] ?? null;

  const projectsQuery = useQuery<Project[]>({
    queryKey: ['dashboard-projects', firstOrg?.id],
    queryFn: () => apiFetch(`/backend/orgs/${firstOrg!.id}/projects`),
    enabled: firstOrg !== null,
  });

  const projects = projectsQuery.data ?? [];

  if (orgsQuery.isLoading || meQuery.isLoading || meQuery.data?.needsOnboarding) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 rounded-lg bg-[hsl(var(--surface))] animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (orgsQuery.isError) {
    return (
      <div className="p-8">
        <p className="text-red-400">Failed to load organisations. Please refresh.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))]">Dashboard</h1>
          <p className="text-[hsl(var(--text-muted))] text-sm mt-1">
            {firstOrg ? `${firstOrg.name} · ${firstOrg.role}` : 'Get started by creating an org'}
          </p>
        </div>
        <div className="flex gap-2">
          {!firstOrg && (
            <button
              onClick={() => setShowCreateOrg(true)}
              className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Create org
            </button>
          )}
          {firstOrg && (
            <>
              <button
                onClick={() => setShowCreateOrg(true)}
                className="px-4 py-2 text-sm rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] font-medium hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] transition-colors"
              >
                New org
              </button>
              <button
                onClick={() => setShowCreateProject(true)}
                className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
              >
                New project
              </button>
            </>
          )}
        </div>
      </div>

      {/* No org state */}
      {orgs.length === 0 && (
        <div className="border border-dashed border-[hsl(var(--border))] rounded-xl p-12 text-center">
          <h2 className="sr-only">No organisations</h2>
          <Building2 className="w-10 h-10 mx-auto mb-4 text-[hsl(var(--text-muted))]" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-2">
            No organisations yet
          </h3>
          <p className="text-[hsl(var(--text-muted))] text-sm mb-6 max-w-xs mx-auto">
            Create your first organisation to start working with your AI C-Suite.
          </p>
          <button
            onClick={() => setShowCreateOrg(true)}
            className="px-5 py-2.5 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Create organisation
          </button>
        </div>
      )}

      {/* Projects grid */}
      {firstOrg && (
        <section aria-label="Projects">
          <h2 className="sr-only">Projects</h2>
          {projectsQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 rounded-xl bg-[hsl(var(--surface))] animate-pulse border border-[hsl(var(--border))]"
                />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="border border-dashed border-[hsl(var(--border))] rounded-xl p-12 text-center">
              <Sparkles className="w-10 h-10 mx-auto mb-4 text-[hsl(var(--text-muted))]" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-2">
                No projects yet
              </h3>
              <p className="text-[hsl(var(--text-muted))] text-sm mb-6 max-w-xs mx-auto">
                Create your first project and bring your AI council to work.
              </p>
              <button
                onClick={() => setShowCreateProject(true)}
                className="px-5 py-2.5 text-sm rounded-lg bg-[hsl(var(--accent))] text-white font-medium hover:opacity-90 transition-opacity"
              >
                Create first project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="group flex flex-col justify-between p-5 rounded-xl bg-[hsl(var(--surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--accent)/0.4)] transition-colors"
                >
                  <div>
                    <h3 className="font-semibold text-[hsl(var(--text-primary))] mb-1 truncate">
                      {project.name}
                    </h3>
                    <p className="text-xs text-[hsl(var(--text-muted))]">
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="mt-4">
                    <Link
                      href={`/p/${slugify(firstOrg.name)}/${slugify(project.name)}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] transition-colors"
                    >
                      Open <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ))}
              {/* Create new project card */}
              <button
                onClick={() => setShowCreateProject(true)}
                className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--accent)/0.4)] hover:text-[hsl(var(--accent))] text-[hsl(var(--text-muted))] transition-colors text-sm"
              >
                <span className="text-2xl mb-2">+</span>
                New project
              </button>
            </div>
          )}
        </section>
      )}

      {/* Dialogs */}
      {showCreateProject && firstOrg && (
        <CreateProjectDialog orgId={firstOrg.id} onClose={() => setShowCreateProject(false)} />
      )}
      {showCreateOrg && <CreateOrgDialog onClose={() => setShowCreateOrg(false)} />}
    </div>
  );
}
