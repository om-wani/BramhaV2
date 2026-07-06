import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/dashboard" className="font-semibold">BramhaV2</Link>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/profile">Settings</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
