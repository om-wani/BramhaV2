'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';

function strengthLabel(score: number): { label: string; color: string } {
  if (score <= 2) return { label: 'Weak', color: 'bg-red-500' };
  if (score === 3) return { label: 'Good', color: 'bg-yellow-400' };
  return { label: 'Strong', color: 'bg-green-500' };
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [strengthScore, setStrengthScore] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // zxcvbn dynamically imported ONLY in useEffect (CLAUDE.md bug #8)
  useEffect(() => {
    if (password.length === 0) {
      setStrengthScore(0);
      return;
    }
    import('zxcvbn').then((m) => {
      const zxcvbn = m.default ?? (m as unknown as (pw: string) => { score: number });
      setStrengthScore(zxcvbn(password).score);
    });
  }, [password]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (strengthScore < 3) {
      setError('Please choose a stronger password (Good or Strong).');
      return;
    }

    setLoading(true);
    try {
      // register() auto-logs-in and sets the session cookie on success.
      await apiFetch('/backend/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      // New account → onboarding (name + first project). If the email already
      // existed, register is a silent no-op and no session was set; the
      // onboarding guard bounces unauthenticated users back to /login.
      router.push('/onboarding');
    } catch {
      // Collapse all errors to a generic message (enumeration prevention).
      setError('Unable to sign up. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const showStrength = password.length > 0;
  const { label: strLabel, color: strColor } = strengthLabel(strengthScore);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] mb-1">Create your account</h2>
        <p className="text-[hsl(var(--text-muted))] text-sm">
          Email and a password — that&apos;s it. We&apos;ll set up the rest next.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium text-[hsl(var(--text-primary))]">
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
          <label htmlFor="password" className="block text-sm font-medium text-[hsl(var(--text-primary))]">
            Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={setPassword}
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

        <div className="space-y-1">
          <label htmlFor="confirm" className="block text-sm font-medium text-[hsl(var(--text-primary))]">
            Confirm password
          </label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={setConfirm}
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
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[hsl(var(--text-muted))]">
        Already have an account?{' '}
        <Link href="/login" className="inline-flex items-center gap-1 text-[hsl(var(--accent))] hover:underline font-medium">
          Sign in <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
