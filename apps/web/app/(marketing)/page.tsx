import Link from 'next/link';
import { Target, GitFork, Paperclip, Mail, type LucideIcon } from 'lucide-react';

function FeatureCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-3 p-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-left">
      <Icon className="w-7 h-7 text-[hsl(var(--accent))]" aria-hidden="true" />
      <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">{title}</h3>
      <p className="text-sm text-[hsl(var(--text-muted))] leading-relaxed">{description}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col bg-[hsl(var(--canvas))]">
      {/* Top nav */}
      <nav className="flex items-center justify-between px-6 sm:px-10 h-16 border-b border-[hsl(var(--border))]">
        <span className="text-lg font-bold tracking-tight text-[hsl(var(--text-primary))]">Bramha</span>
        <Link
          href="/login"
          className="text-sm font-medium text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
        >
          Sign in
        </Link>
      </nav>

      {/* Hero: auth entry left, visual right (claude.com structure).
          Fills the viewport below the h-16 nav so the first screen is all hero. */}
      <section className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2">
        {/* Left — headline + auth entry */}
        <div className="flex flex-col justify-center px-6 sm:px-10 lg:px-16 py-16">
          <div className="max-w-md">
            <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-[hsl(var(--text-primary))] mb-4">
              Your AI C-suite
              <br />
              is in session.
            </h1>
            <p className="text-lg text-[hsl(var(--text-muted))] leading-relaxed mb-8">
              Eight executive agents that know when to speak, remember what your company knows, and
              delegate to each other — in one room.
            </p>

            <div className="space-y-3">
              {/* Google — coming soon (email-first launch) */}
              <button
                type="button"
                disabled
                title="Google sign-in coming soon"
                className="w-full py-2.5 px-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--text-muted))] font-medium text-sm inline-flex items-center justify-center gap-2 cursor-not-allowed opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M12 11v3.5h4.9c-.2 1.2-1.5 3.6-4.9 3.6-2.9 0-5.3-2.4-5.3-5.4S9.1 6.9 12 6.9c1.7 0 2.8.7 3.4 1.3l2.3-2.2C16.3 4.6 14.4 3.8 12 3.8 6.9 3.8 2.9 7.9 2.9 12.7S6.9 21.6 12 21.6c5 0 8.3-3.5 8.3-8.4 0-.6-.1-1-.2-1.5H12z" />
                </svg>
                Continue with Google
                <span className="text-[10px] uppercase tracking-wide">soon</span>
              </button>

              <Link
                href="/login"
                className="w-full py-2.5 px-4 rounded-lg bg-[hsl(var(--accent))] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                <Mail className="w-4 h-4" aria-hidden="true" />
                Continue with email
              </Link>
            </div>

            <p className="mt-4 text-xs text-[hsl(var(--text-muted))]">
              New here?{' '}
              <Link href="/signup" className="text-[hsl(var(--accent))] hover:underline font-medium">
                Create an account
              </Link>
            </p>
          </div>
        </div>

        {/* Right — branded gradient placeholder (promo asset slot) */}
        <div className="hidden lg:flex items-center justify-center p-10 bg-gradient-to-br from-[hsl(var(--accent))]/25 via-[hsl(var(--surface))] to-[hsl(var(--canvas))] border-l border-[hsl(var(--border))]">
          <div className="text-center max-w-sm">
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {['CEO', 'CTO', 'CMO', 'CFO', 'COO', 'CHRO', 'CSO', 'CDAO'].map((role) => (
                <span
                  key={role}
                  className="text-xs px-2.5 py-1 rounded-full bg-[hsl(var(--canvas))]/70 text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                >
                  {role}
                </span>
              ))}
            </div>
            <p className="text-sm text-[hsl(var(--text-muted))]">
              One council. Non-linear threads. Cited knowledge. Delegation between agents.
            </p>
          </div>
        </div>
      </section>

      {/* Feature strip */}
      <section className="px-6 sm:px-10 lg:px-16 py-16 border-t border-[hsl(var(--border))]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-5xl mx-auto">
          <FeatureCard
            icon={Target}
            title="Council selectivity"
            description="Only the right agents speak. Silent members cost $0. Relevance scoring filters the room so you get signal, not noise."
          />
          <FeatureCard
            icon={GitFork}
            title="Non-linear branching"
            description="Fork any message mid-thread. Explore diverging strategies without losing context. Switch branches and both lineages persist."
          />
          <FeatureCard
            icon={Paperclip}
            title="Cited knowledge"
            description="Upload PDFs, docs, and data. Agents cite exact chunks in-line. Citations link to excerpts — no hallucinated sources."
          />
        </div>
      </section>
    </main>
  );
}
