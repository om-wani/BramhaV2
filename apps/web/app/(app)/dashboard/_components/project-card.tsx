import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface ProjectCardProps {
  project: {
    id: string
    name: string
    slug: string
    description: string | null
    memberCount: number
    createdAt: string
  }
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{project.name}</CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {project.memberCount} {project.memberCount === 1 ? 'member' : 'members'}
          </Badge>
        </div>
        {project.description && (
          <CardDescription className="line-clamp-2">{project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-xs text-muted-foreground">
          Created {new Date(project.createdAt).toLocaleDateString()}
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button asChild size="sm" className="flex-1">
          <Link href={`/p/${project.id}`}>Open</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/p/${project.id}/settings`}>Settings</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
