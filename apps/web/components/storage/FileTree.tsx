import { Folder, AlertTriangle, Archive, PlugZap } from 'lucide-react'
import { cn } from '@/lib/utils'

type FolderType = 'uploads' | 'quarantine' | 'sources'

interface FileTreeProps {
  selectedFolder: FolderType
  onSelectFolder: (folder: FolderType) => void
  uploadsCount: number
  quarantineCount: number
  sourcesCount?: number
}

export function FileTree({ selectedFolder, onSelectFolder, uploadsCount, quarantineCount, sourcesCount }: FileTreeProps) {
  const items: { id: FolderType | 'artifacts'; label: string; icon: React.ReactNode; count?: number; disabled?: boolean }[] = [
    {
      id: 'uploads' as FolderType,
      label: 'Uploads',
      icon: <Folder className="h-4 w-4" aria-hidden="true" />,
      count: uploadsCount,
    },
    {
      id: 'sources' as FolderType,
      label: 'Connected Sources',
      icon: <PlugZap className="h-4 w-4" aria-hidden="true" />,
      ...(sourcesCount !== undefined ? { count: sourcesCount } : {}),
    },
    {
      id: 'artifacts',
      label: 'Artifacts',
      icon: <Archive className="h-4 w-4" aria-hidden="true" />,
      disabled: true,
    },
    {
      id: 'quarantine' as FolderType,
      label: 'Quarantine',
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      count: quarantineCount,
    },
  ]

  return (
    <nav aria-label="Storage folders" className="p-2">
      <h2 className="sr-only">Folders</h2>
      <ul role="list" className="space-y-0.5">
        {items.map((item) => {
          const isActive = !item.disabled && selectedFolder === item.id
          return (
            <li key={item.id}>
              {item.disabled ? (
                <div className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground/50 cursor-not-allowed select-none">
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs text-muted-foreground/30">Phase 3</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectFolder(item.id as FolderType)}
                  aria-current={isActive ? 'location' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors text-left',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.count !== undefined && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-xs font-medium',
                        item.id === 'quarantine' && item.count > 0
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-muted text-muted-foreground',
                      )}
                      aria-label={`${item.count} files`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
