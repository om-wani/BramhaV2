'use client'

import { useEffect, useMemo } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'

interface NavItem {
  label: string
  icon: string
  href: string
  shortcut: string
  ariaLabel: string
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const params = useParams<{ projectId: string }>()
  const pathname = usePathname()
  const projectId = params.projectId

  const navItems = useMemo<NavItem[]>(() => [
    { label: 'Conference', icon: '🏛', href: `/p/${projectId}/conference`, shortcut: 'c', ariaLabel: 'Conference room' },
    { label: "CEO's Office", icon: '💼', href: `/p/${projectId}/office`, shortcut: 'o', ariaLabel: "CEO's Office" },
    { label: 'Storage', icon: '🗄', href: `/p/${projectId}/storage`, shortcut: 's', ariaLabel: 'Storage room' },
    { label: 'Graph', icon: '🕸', href: `/p/${projectId}/graph`, shortcut: 'g', ariaLabel: 'Graph view' },
    { label: 'Settings', icon: '⚙', href: `/p/${projectId}/settings`, shortcut: '.', ariaLabel: 'Project settings' },
  ], [projectId])

  // Keyboard shortcuts: press 'g' then letter within 1s
  useEffect(() => {
    let gPressed = false
    let timer: ReturnType<typeof setTimeout>

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs or contenteditable elements
      if (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement).isContentEditable) return

      if (gPressed) {
        gPressed = false
        clearTimeout(timer)
        const item = navItems.find((n) => n.shortcut === e.key)
        if (item) {
          e.preventDefault()
          router.push(item.href)
        }
        return
      }

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        gPressed = true
        clearTimeout(timer)
        timer = setTimeout(() => { gPressed = false }, 1000)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [router, navItems])

  return (
    <div className="flex min-h-screen">
      {/* Left nav rail */}
      <nav
        className="flex w-56 shrink-0 flex-col border-r bg-card"
        aria-label="Workspace navigation"
      >
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
        <ul className="flex-1 space-y-1 p-2" role="list">
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
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                  <kbd className="ml-auto hidden text-xs text-muted-foreground/50 lg:block" aria-hidden="true">
                    g{item.shortcut}
                  </kbd>
                </Link>
              </li>
            )
          })}
        </ul>
        <Separator />
        <div className="p-3 text-xs text-muted-foreground">
          Press <kbd className="rounded border px-1">g</kbd> then a letter to navigate
        </div>
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
