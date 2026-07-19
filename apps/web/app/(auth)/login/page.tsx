import Link from 'next/link';

export default function LoginPage() {
  return (
    <div className="bg-surface border border-border rounded-xl p-8">
      <h1 className="text-2xl font-bold mb-6">Sign in</h1>
      <p className="text-text-muted mb-4">Login form coming in P1.</p>
      <Link href="/register" className="text-accent hover:underline text-sm">
        No account? Register →
      </Link>
    </div>
  );
}
