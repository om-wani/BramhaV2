import Link from 'next/link';

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-3 p-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-left">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">{title}</h3>
      <p className="text-sm text-[hsl(var(--text-muted))] leading-relaxed">{description}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center bg-[hsl(var(--canvas))]">
      <h1 className="text-5xl font-bold mb-4">Your AI C-suite is in session.</h1>
      <p className="text-xl text-text-muted max-w-2xl mb-8">
        Eight executive agents that know when to speak, remember what your company knows, and
        delegate to each other — in one room.
      </p>
      <Link
        href="/register"
        className="px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
      >
        Get started
      </Link>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl w-full mt-12">
        <FeatureCard
          icon="🎯"
          title="Council selectivity"
          description="Only the right agents speak. Silent members cost $0. Relevance scoring filters the room so you get signal, not noise."
        />
        <FeatureCard
          icon="⑂"
          title="Non-linear branching"
          description="Fork any message mid-thread. Explore diverging strategies without losing context. Switch branches and both lineages persist."
        />
        <FeatureCard
          icon="📎"
          title="Cited knowledge"
          description="Upload PDFs, docs, and data. Agents cite exact chunks in-line. Citations link to excerpts — no hallucinated sources."
        />
      </div>
    </main>
  );
}
