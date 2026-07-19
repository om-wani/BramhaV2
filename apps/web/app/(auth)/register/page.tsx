import Link from 'next/link';

export default function RegisterPage() {
  return (
    <div className="bg-surface border border-border rounded-xl p-8">
      <h1 className="text-2xl font-bold mb-6">Create account</h1>
      <p className="text-text-muted mb-4">Registration form coming in P1.</p>
      <Link href="/login" className="text-accent hover:underline text-sm">
        Have an account? Sign in →
      </Link>
    </div>
  );
}
