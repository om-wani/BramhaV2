import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const features = [
  {
    icon: '🏛',
    title: 'Council',
    description:
      'Your full C-Suite meets in a shared conference room. Each executive brings their domain expertise — strategy, tech, marketing, finance. They debate, align, and execute together.',
  },
  {
    icon: '🤝',
    title: 'Delegation',
    description:
      'Executives spawn sub-agents, invoke tools, and hand off tasks across the org — all with human-in-the-loop approval gates. Nothing happens without your oversight.',
  },
  {
    icon: '🧠',
    title: 'Memory',
    description:
      'Every decision, document, and conversation is indexed into a knowledge graph. Agents remember context across sessions so you never repeat yourself.',
  },
]

export function Features() {
  return (
    <section id="features" className="py-24">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Three pillars of your AI organization
          </h2>
          <p className="mt-4 text-muted-foreground">
            Built for founders and operators who need executive-level thinking at startup speed.
          </p>
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="relative overflow-hidden">
              <CardHeader>
                <div className="mb-3 text-4xl" aria-hidden="true">{f.icon}</div>
                <CardTitle className="text-xl">{f.title}</CardTitle>
                <CardDescription className="text-base leading-relaxed">{f.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
