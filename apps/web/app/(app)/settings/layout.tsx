import Link from 'next/link'

const settingsNav = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/api-keys', label: 'API keys' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-6 flex gap-8">
        <nav className="w-48 shrink-0" aria-label="Settings navigation">
          <ul className="space-y-1">
            {settingsNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
