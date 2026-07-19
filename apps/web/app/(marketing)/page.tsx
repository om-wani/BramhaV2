import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
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
    </main>
  );
}
