import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold">
          BramhaV2
        </Link>
        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main navigation">
          <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Features
          </Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Pricing
          </Link>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </div>
        {/* Mobile nav — CSS-only, no JS */}
        <details className="group md:hidden">
          <summary className="list-none cursor-pointer p-2 rounded-md hover:bg-accent" aria-label="Open menu">
            <span className="sr-only">Menu</span>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </summary>
          <div className="absolute left-0 right-0 top-16 border-b bg-background p-4 shadow-lg">
            <nav className="flex flex-col gap-3" aria-label="Mobile navigation">
              <Link href="#features" className="text-sm hover:text-primary">Features</Link>
              <Link href="/pricing" className="text-sm hover:text-primary">Pricing</Link>
              <Link href="/login" className="text-sm hover:text-primary">Sign in</Link>
              <Button size="sm" asChild className="w-full">
                <Link href="/register">Get started</Link>
              </Button>
            </nav>
          </div>
        </details>
      </div>
    </header>
  )
}
