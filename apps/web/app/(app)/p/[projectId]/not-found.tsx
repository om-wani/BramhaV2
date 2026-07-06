import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ProjectNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Project not found</h1>
      <p className="text-muted-foreground">This project doesn&apos;t exist or you don&apos;t have access.</p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  )
}
