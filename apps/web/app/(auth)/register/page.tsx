'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

function strengthLabel(score: number): { label: string; color: string } {
  if (score <= 2) return { label: 'Weak', color: 'bg-red-500' };
  if (score === 3) return { label: 'Good', color: 'bg-yellow-400' };
  return { label: 'Strong', color: 'bg-green-500' };
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [strengthScore, setStrengthScore] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // CORRECT: zxcvbn dynamically imported ONLY in useEffect (CLAUDE.md bug #8)
  useEffect(() => {
    if (password.length === 0) {
      setStrengthScore(0);
      return;
    }
    import('zxcvbn').then((m) => {
      const zxcvbn = m.default ?? (m as unknown as (pw: string) => { score: number });
      const result = zxcvbn(password);
      setStrengthScore(result.score);
    });
  }, [password]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (strengthScore >= 0 && strengthScore < 3) {
      setError('Please choose a stronger password (Good or Strong).');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/backend/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      router.push('/dashboard');
    } catch (err: unknown) {
      // Collapse all errors to generic message to prevent enumeration
      void err;
      setError('Unable to register. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const showStrength = password.length > 0 && strengthScore >= 0;
  const { label: strLabel, color: strColor } = strengthLabel(strengthScore);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] mb-1">Create account</h2>
        <p className="text-[hsl(var(--text-muted))] text-sm">
          Get your AI C-Suite up and running in seconds.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label
            htmlFor="name"
            className="block text-sm font-medium text-[hsl(var(--text-primary))]"
          >
            Full name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] focus:border-transparent transition text-sm"
          />
        </div>

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
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] focus:border-transparent transition text-sm"
          />
          {showStrength && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-1 h-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-full transition-all duration-300 ${
                      i <= strengthScore ? strColor : 'bg-[hsl(var(--border))]'
                    }`}
                  />
                ))}
              </div>
              <p
                className={`text-xs ${
                  strengthScore <= 2
                    ? 'text-red-400'
                    : strengthScore === 3
                      ? 'text-yellow-400'
                      : 'text-green-400'
                }`}
              >
                {strLabel} — {strengthScore < 3 ? 'choose a stronger password' : 'looks good!'}
              </p>
            </div>
          )}
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
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[hsl(var(--text-muted))]">
        Already have an account?{' '}
        <Link href="/login" className="text-[hsl(var(--accent))] hover:underline font-medium">
          Sign in →
        </Link>
      </p>
    </div>
  );
}
