import { PricingCards } from '../_components/pricing-cards'

export const metadata = {
  title: 'Pricing — BramhaV2',
  description: 'Simple pricing. Start free, scale when you need to.',
}

export default function PricingPage() {
  return (
    <div className="py-16">
      <div className="container mx-auto max-w-6xl px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Pricing</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free. Upgrade when your team grows.
        </p>
      </div>
      <PricingCards />
    </div>
  )
}
