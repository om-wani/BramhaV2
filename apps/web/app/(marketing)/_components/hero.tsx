import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      {/* Subtle gradient bg — no image, no external resource → good LCP */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" aria-hidden="true" />
      <div className="container relative mx-auto max-w-6xl px-4 text-center">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Your AI{' '}
            <span className="text-primary">C-Suite</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            Hire a full executive team of specialized AI agents — CEO, CTO, CMO, CFO and more.
            They collaborate, delegate, and remember everything so you can focus on what matters.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link href="/register">Get started free</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="#features">See how it works</Link>
            </Button>
          </div>
        </div>
        {/* Room metaphor illustration — SVG, inline, zero external requests */}
        <div className="mt-16 rounded-2xl border bg-card p-8 shadow-xl" aria-label="Workspace illustration">
          <RoomIllustration />
        </div>
      </div>
    </section>
  )
}

function RoomIllustration() {
  // Simplified room metaphor showing conference table with agent avatars
  const personas = [
    { label: 'CEO', color: '#3b82f6' },
    { label: 'CTO', color: '#8b5cf6' },
    { label: 'CMO', color: '#ec4899' },
    { label: 'CFO', color: '#14b8a6' },
    { label: 'COO', color: '#f59e0b' },
  ]
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-4"
      role="img"
      aria-label="AI C-Suite agents around a conference table"
    >
      {personas.map((p) => (
        <div key={p.label} className="flex flex-col items-center gap-2">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: p.color }}
            aria-label={p.label}
          >
            {p.label}
          </div>
          <span className="text-xs text-muted-foreground">{p.label}</span>
        </div>
      ))}
    </div>
  )
}
