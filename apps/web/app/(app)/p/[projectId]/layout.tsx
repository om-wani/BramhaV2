'use client'

import { useEffect } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { PersonaBioCard } from '@/components/rooms/PersonaBioCard'

// ── Schemas ────────────────────────────────────────────────────────────────────

const HiredPersonaSchema = z.object({
  personaId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string().nullable(),
  accentColor: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hiredAt: z.string(),
})

// ── Types ──────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  icon: string
  href: string
  shortcut: string
  ariaLabel: string
}

// ── Static nav items ────────────────────────────────────────────────────────────

const STATIC_NAV: NavItem[] = [
  { label: 'Conference', icon: '🏛', href: 'conference', shortcut: 'c', ariaLabel: 'Conference room' },
  { label: "CEO's Office", icon: '💼', href: 'office', shortcut: 'o', ariaLabel: "CEO's Office" },
  { label: 'Meetings', icon: '🗣', href: 'meeting', shortcut: 'm', ariaLabel: 'Meetings' },
  { label: 'Storage', icon: '🗄', href: 'storage', shortcut: 's', ariaLabel: 'Storage room' },
  { label: 'Graph', icon: '🕸', href: 'graph', shortcut: 'g', ariaLabel: 'Graph view' },
  { label: 'Settings', icon: '⚙', href: 'settings', shortcut: '.', ariaLabel: 'Project settings' },
]

// ── Component ──────────────────────────────────────────────────────────────────

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const params = useParams<{ projectId: string }>()
  const pathname = usePathname()
  const projectId = params.projectId

  // Fetch hired personas for the 1:1 Calls section
  const { data: personas = [] } = useQuery({
    queryKey: ['hired-personas', projectId],
    queryFn: () => api.get(`/projects/${projectId}/agents`, z.array(HiredPersonaSchema)),
    staleTime: 60 * 1000,
  })

  // Build full nav items with absolute hrefs
  const navItems: NavItem[] = STATIC_NAV.map((item) => ({
    ...item,
    href: `/p/${projectId}/${item.href}`,
  }))

  // All navigable items (static + 1:1 calls per persona) for keyboard shortcuts
  const allShortcutItems: Array<{ shortcut: string; href: string }> = [
    ...navItems,
    // 'gi' → first 1:1 persona
    ...(personas.length > 0 && personas[0]
      ? [{ shortcut: 'i', href: `/p/${projectId}/call/${personas[0].personaId}` }]
      : []),
  ]

  // Keyboard shortcuts: press 'g' then letter within 1s
  useEffect(() => {
    let gPressed = false
    let timer: ReturnType<typeof setTimeout>

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs or contenteditable elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      )
        return

      if (gPressed) {
        gPressed = false
        clearTimeout(timer)
        const item = allShortcutItems.find((n) => n.shortcut === e.key)
        if (item) {
          e.preventDefault()
          router.push(item.href)
        }
        return
      }

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        gPressed = true
        clearTimeout(timer)
        timer = setTimeout(() => {
          gPressed = false
        }, 1000)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [router, allShortcutItems])

  return (
    <div className="flex min-h-screen">
      {/* Left nav rail */}
      <nav className="flex w-56 shrink-0 flex-col border-r bg-card" aria-label="Workspace navigation">
        <div className="p-4">
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to dashboard"
          >
            ← Dashboard
          </Link>
        </div>
        <Separator />

        {/* Main nav items */}
        <ul className="flex-1 space-y-1 p-2 overflow-y-auto" role="list">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-label={item.ariaLabel}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                  <kbd
                    className="ml-auto hidden text-xs text-muted-foreground/50 lg:block"
                    aria-hidden="true"
                  >
                    g{item.shortcut}
                  </kbd>
                </Link>
              </li>
            )
          })}

          {/* 1:1 Calls section */}
          {personas.length > 0 ? (
            <>
              <li role="presentation">
                <Separator className="my-2" />
                <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  1:1 Calls
                </p>
              </li>
              {personas.map((persona, idx) => {
                const href = `/p/${projectId}/call/${persona.personaId}`
                const isActive = pathname === href || pathname.startsWith(href + '/')
                return (
                  <li key={persona.personaId}>
                    <Link
                      href={href}
                      aria-label={`1:1 call with ${persona.name}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      <PersonaBioCard persona={persona} size="sm" />
                      {idx === 0 ? (
                        <kbd
                          className="ml-auto hidden text-xs text-muted-foreground/50 lg:block"
                          aria-hidden="true"
                        >
                          gi
                        </kbd>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </>
          ) : null}
        </ul>

        <Separator />
        <div className="p-3 text-xs text-muted-foreground">
          Press <kbd className="rounded border px-1">g</kbd> then a letter to navigate
        </div>
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}
