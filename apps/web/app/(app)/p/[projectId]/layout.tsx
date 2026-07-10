'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { CreateMeetingDialog } from '@/components/rooms/CreateMeetingDialog'

// ── Schemas ────────────────────────────────────────────────────────────────────

const HiredPersonaSchema = z.object({
  personaId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string().nullable(),
  accentColor: z.string().nullable(),
  avatarKey: z.string().nullable(),
  hiredAt: z.string(),
})

const RoomSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  archivedAt: z.string().nullable(),
})

// ── Types ──────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  icon: string
  href: string
  shortcut: string
  ariaLabel: string
}

type HiredPersona = z.infer<typeof HiredPersonaSchema>
type Room = z.infer<typeof RoomSchema>

// ── Static nav items (no Meetings — handled separately as expandable) ──────────

const STATIC_NAV: NavItem[] = [
  { label: 'Conference', icon: '🏛', href: 'conference', shortcut: 'c', ariaLabel: 'Conference room' },
  { label: "CEO's Office", icon: '💼', href: 'office', shortcut: 'o', ariaLabel: "CEO's Office" },
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

  const [meetingsOpen, setMeetingsOpen] = useState(true)
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false)

  // Fetch hired personas for the 1:1 Calls section
  const { data: personas = [] } = useQuery({
    queryKey: ['hired-personas', projectId],
    queryFn: () => api.get(`/projects/${projectId}/agents`, z.array(HiredPersonaSchema)),
    staleTime: 60 * 1000,
  })

  // Fetch meeting rooms for the expandable Meetings section
  const { data: meetingRooms = [], refetch: refetchMeetings } = useQuery({
    queryKey: ['rooms', projectId, 'meeting'],
    queryFn: () =>
      api.get(`/projects/${projectId}/rooms?type=meeting`, z.array(RoomSchema)),
    staleTime: 30 * 1000,
    enabled: meetingsOpen,
  })

  const activeMeetings = meetingRooms.filter((r: Room) => !r.archivedAt)
  const visibleMeetings = activeMeetings.slice(0, 5)
  const hasMoreMeetings = activeMeetings.length > 5

  // Build full nav items with absolute hrefs
  const navItems: NavItem[] = STATIC_NAV.map((item) => ({
    ...item,
    href: `/p/${projectId}/${item.href}`,
  }))

  // All navigable items for keyboard shortcuts (static + meetings + 1:1 calls)
  const allShortcutItems = useMemo(
    () => [
      ...navItems,
      { shortcut: 'm', href: `/p/${projectId}/meeting` },
      // 'gi' → first 1:1 persona
      ...(personas.length > 0 && personas[0]
        ? [{ shortcut: 'i', href: `/p/${projectId}/call/${personas[0].personaId}` }]
        : []),
    ],
    [navItems, projectId, personas],
  )

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

  const meetingsBasePath = `/p/${projectId}/meeting`
  const isMeetingsActive = pathname === meetingsBasePath || pathname.startsWith(meetingsBasePath + '/')

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

        <ul className="flex-1 space-y-1 p-2 overflow-y-auto" role="list">
          {/* Static nav items (Conference, CEO's Office, Storage, Graph, Settings) */}
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

          {/* ── Meetings — expandable section ─────────────────────────────── */}
          <li role="presentation">
            <div
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors',
                isMeetingsActive
                  ? 'text-accent-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {/* Toggle button */}
              <button
                type="button"
                onClick={() => setMeetingsOpen((o) => !o)}
                className="flex flex-1 items-center gap-2 hover:text-foreground transition-colors"
                aria-expanded={meetingsOpen}
                aria-label="Toggle meetings list"
              >
                <span aria-hidden="true">🗣</span>
                <span>Meetings</span>
                <span
                  className={cn(
                    'ml-1 text-xs transition-transform',
                    meetingsOpen ? 'rotate-90' : 'rotate-0',
                  )}
                  aria-hidden="true"
                >
                  ▶
                </span>
              </button>

              {/* New meeting button */}
              <button
                type="button"
                onClick={() => setCreateMeetingOpen(true)}
                className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label="New meeting"
                title="New meeting"
              >
                +
              </button>

              <kbd
                className="hidden text-xs text-muted-foreground/50 lg:block ml-1"
                aria-hidden="true"
              >
                gm
              </kbd>
            </div>

            {/* Expandable meeting list */}
            {meetingsOpen ? (
              <ul className="mt-1 space-y-0.5 pl-4" role="list">
                {visibleMeetings.length === 0 ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => setCreateMeetingOpen(true)}
                      className="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      + New meeting room
                    </button>
                  </li>
                ) : (
                  <>
                    {visibleMeetings.map((room: Room) => {
                      const href = `/p/${projectId}/meeting/${room.id}`
                      const isActive = pathname === href || pathname.startsWith(href + '/')
                      const displayName =
                        room.name.length > 20 ? room.name.slice(0, 20) + '…' : room.name
                      return (
                        <li key={room.id}>
                          <Link
                            href={href}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
                              isActive
                                ? 'bg-accent text-accent-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                            )}
                            title={room.name}
                          >
                            <span className="truncate">{displayName}</span>
                          </Link>
                        </li>
                      )
                    })}
                    {hasMoreMeetings ? (
                      <li>
                        <Link
                          href={`/p/${projectId}/meeting`}
                          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          See all →
                        </Link>
                      </li>
                    ) : null}
                  </>
                )}
              </ul>
            ) : null}
          </li>

          {/* ── 1:1 Calls section ────────────────────────────────────────── */}
          {personas.length > 0 ? (
            <>
              <li role="presentation">
                <Separator className="my-2" />
                <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  1:1 Calls
                </p>
              </li>
              {personas.map((persona: HiredPersona, idx: number) => {
                const href = `/p/${projectId}/call/${persona.personaId}`
                const isActive = pathname === href || pathname.startsWith(href + '/')
                return (
                  <li key={persona.personaId}>
                    <Link
                      href={href}
                      aria-label={`1:1 call with ${persona.name}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      {/* Presence / accent dot — static color dot using persona accentColor */}
                      <span
                        aria-hidden="true"
                        className="inline-block shrink-0 rounded-full"
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: persona.accentColor ?? 'hsl(var(--muted-foreground))',
                        }}
                      />
                      <span className="truncate">{persona.name}</span>
                      {persona.role ? (
                        <span className="ml-auto hidden text-xs text-muted-foreground/60 lg:block truncate max-w-[60px]">
                          {persona.role.split(' ').slice(-1)[0]}
                        </span>
                      ) : null}
                      {idx === 0 ? (
                        <kbd
                          className="hidden text-xs text-muted-foreground/50 lg:block shrink-0"
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

      {/* CreateMeetingDialog — mounted in layout so it's accessible from nav */}
      <CreateMeetingDialog
        projectId={projectId}
        open={createMeetingOpen}
        onClose={() => setCreateMeetingOpen(false)}
        onCreated={() => { void refetchMeetings() }}
      />
    </div>
  )
}
