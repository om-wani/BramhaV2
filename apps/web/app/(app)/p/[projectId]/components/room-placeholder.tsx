interface RoomPlaceholderProps {
  name: string
  description: string
  icon: string
}

export function RoomPlaceholder({ name, description, icon }: RoomPlaceholderProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-6xl" aria-hidden="true">{icon}</div>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="max-w-md text-muted-foreground">{description}</p>
    </div>
  )
}
