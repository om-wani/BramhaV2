'use client';

import { Suspense, useState, FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/backend/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      // Incomplete accounts (no name/first project) go through onboarding.
      const me = await apiFetch<{ needsOnboarding: boolean }>('/backend/auth/me');
      if (me.needsOnboarding) {
        router.push('/onboarding');
        return;
      }
      const next = searchParams.get('next') ?? '';
      const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
      router.push(dest);
    } catch {
      // Generic error — no specific message to prevent enumeration
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] mb-1">Sign in</h2>
        <p className="text-[hsl(var(--text-muted))] text-sm">
          Welcome back. Enter your credentials to continue.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-[hsl(var(--text-primary))]"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] focus:border-transparent transition text-sm"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-[hsl(var(--text-primary))]"
          >
            Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
        </div>

        {error && (
          <p role="alert" className="text-red-400 text-sm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-lg bg-[hsl(var(--accent))] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[hsl(var(--text-muted))]">
        Don&apos;t have an account yet?{' '}
        <Link href="/signup" className="inline-flex items-center gap-1 text-[hsl(var(--accent))] hover:underline font-medium">
          Sign up <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
