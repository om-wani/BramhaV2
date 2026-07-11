import Link from 'next/link'

const NAV_LINKS = [
  { href: '/admin/users',       label: 'Users' },
  { href: '/admin/personas',    label: 'Personas' },
  { href: '/admin/connectors',  label: 'Connectors' },
  { href: '/admin/diagnostics', label: 'Diagnostics' },
  { href: '/admin/audit-log',   label: 'Audit Log' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Admin top bar */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/admin" className="text-sm font-bold text-foreground">
            BramhaV2 Admin
          </Link>
          <span className="text-border">|</span>
          <nav className="flex items-center gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}
