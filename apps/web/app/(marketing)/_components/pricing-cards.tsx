import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const plans = [
  {
    name: 'Starter',
    price: '$0',
    period: 'month',
    description: 'Explore your AI C-Suite.',
    badge: undefined,
    features: ['1 project', '3 agents', '100k tokens/day', 'Conference Room', 'Community support'],
    cta: 'Start free',
    href: '/register',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$49',
    period: 'month',
    description: 'For founders moving fast.',
    badge: 'Most popular',
    features: [
      '5 projects',
      'Full C-Suite (8 agents)',
      '2M tokens/day',
      'All rooms',
      "CEO's Office + Memory",
      'Email support',
    ],
    cta: 'Start Pro',
    href: '/register?plan=pro',
    highlighted: true,
  },
  {
    name: 'Scale',
    price: '$199',
    period: 'month',
    description: 'For growing teams.',
    badge: undefined,
    features: [
      'Unlimited projects',
      'Custom agents',
      '10M tokens/day',
      'Priority support',
      'SSO + audit logs',
      'SLA',
    ],
    cta: 'Contact sales',
    href: '/register?plan=scale',
    highlighted: false,
  },
]

interface PricingCardsProps {
  teaser?: boolean
}

export function PricingCards({ teaser = false }: PricingCardsProps) {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className={cn('py-24', teaser && 'bg-muted/30')}>
      <div className="container mx-auto max-w-6xl px-4">
        <h2 id="pricing-heading" className="sr-only">Pricing plans</h2>
        {teaser && (
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple pricing</h2>
            <p className="mt-4 text-muted-foreground">Start free. Scale when you need to.</p>
          </div>
        )}
        <div className={cn('grid gap-8 md:grid-cols-3', teaser && 'mt-16')}>
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={cn(
                'relative flex flex-col',
                plan.highlighted && 'border-primary shadow-lg shadow-primary/10'
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge>{plan.badge}</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">/{plan.period}</span>
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <span className="text-green-500" aria-hidden="true">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={plan.highlighted ? 'default' : 'outline'}
                  asChild
                >
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
