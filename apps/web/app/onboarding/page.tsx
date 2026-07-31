'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

// Must match the slug logic used to resolve /p/[org]/[project] routes.
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

interface Me {
  name: string | null;
  needsOnboarding: boolean;
  personalOrgId: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Gate: unauthenticated → /login; already onboarded → /dashboard.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await apiFetch<Me>('/backend/auth/me');
        if (!active) return;
        if (!me.needsOnboarding) {
          router.replace('/dashboard');
          return;
        }
        setOrgId(me.personalOrgId);
        if (me.name) {
          setName(me.name);
          setStep(2); // name already set — only the first project is missing
        }
        setReady(true);
      } catch {
        router.replace('/login');
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function submitName(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/backend/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      setStep(2);
    } catch {
      setError('Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitProject(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!project.trim() || !orgId) return;
    setBusy(true);
    try {
      const created = await apiFetch<{ id: string }>(`/backend/orgs/${orgId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: project.trim() }),
      });
      // Resolve the org name (renamed to "<name>'s Workspace") for the URL slug,
      // and the auto-seeded Council room to land directly in the chat.
      const orgs = await apiFetch<Array<{ id: string; name: string }>>('/backend/orgs');
      const org = orgs.find((o) => o.id === orgId);
      const rooms = await apiFetch<Array<{ id: string; kind: string }>>(
        `/backend/projects/${created.id}/rooms`,
      );
      const room = rooms.find((r) => r.kind === 'council') ?? rooms[0];
      if (org && room) {
        router.push(`/p/${slugify(org.name)}/${slugify(project.trim())}/r/${room.id}`);
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Could not create the project. Try again.');
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[hsl(var(--canvas))]">
        <Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--text-muted))]" aria-hidden="true" />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-[hsl(var(--canvas))]">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-[hsl(var(--text-primary))]">Bramha</span>
          <span className="text-xs text-[hsl(var(--text-muted))]">· step {step} of 2</span>
        </div>

        {step === 1 ? (
          <form onSubmit={submitName} className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))] mb-1">
                What should we call you?
              </h1>
              <p className="text-sm text-[hsl(var(--text-muted))]">Your display name across the workspace.</p>
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] transition text-sm"
            />
            {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="w-full py-2.5 px-4 rounded-lg bg-[hsl(var(--accent))] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              Continue <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>
        ) : (
          <form onSubmit={submitProject} className="space-y-5">
            <div>
              <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))] mb-1">
                Let&apos;s get you started.
              </h1>
              <p className="text-sm text-[hsl(var(--text-muted))]">
                Choose a name for your first project. We&apos;ll open a council room for you.
              </p>
            </div>
            <input
              autoFocus
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Q3 Strategy"
              maxLength={100}
              className="w-full px-3 py-2.5 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] transition text-sm"
            />
            {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={busy || !project.trim()}
              className="w-full py-2.5 px-4 rounded-lg bg-[hsl(var(--accent))] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Setting up…
                </>
              ) : (
                <>
                  Enter the council <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
