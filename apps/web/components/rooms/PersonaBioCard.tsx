'use client'

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface PersonaBioCardPersona {
  personaId: string
  name: string
  role: string | null
  accentColor: string | null
  /** Raw S3 key. Only rendered as an image when it starts with 'http'. */
  avatarKey: string | null
}

interface PersonaBioCardProps {
  persona: PersonaBioCardPersona
  size?: 'sm' | 'md'
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function PersonaBioCard({ persona, size = 'md' }: PersonaBioCardProps) {
  const isSm = size === 'sm'

  return (
    <div className={cn('flex items-center gap-3', isSm ? 'py-1' : 'py-2')}>
      <Avatar className={cn(isSm ? 'h-8 w-8' : 'h-10 w-10')}>
        {persona.avatarKey?.startsWith('http') ? (
          <AvatarImage src={persona.avatarKey} alt={persona.name} />
        ) : null}
        <AvatarFallback
          style={
            persona.accentColor ? { backgroundColor: persona.accentColor, color: '#fff' } : {}
          }
          className={cn('text-xs font-semibold', isSm ? 'text-xs' : 'text-sm')}
        >
          {getInitials(persona.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span
          className={cn('font-semibold leading-tight', isSm ? 'text-sm' : 'text-base')}
          style={persona.accentColor ? { color: persona.accentColor } : {}}
        >
          {persona.name}
        </span>
        {persona.role ? (
          <span className={cn('text-muted-foreground', isSm ? 'text-xs' : 'text-sm')}>
            {persona.role}
          </span>
        ) : null}
      </div>
    </div>
  )
}
