import { Hero } from './_components/hero'
import { Features } from './_components/features'
import { PricingCards } from './_components/pricing-cards'

export const metadata = {
  title: 'BramhaV2 — Your AI C-Suite',
  description:
    'Hire a full executive team of specialized AI agents. Collaborate, delegate, and remember everything.',
  openGraph: {
    title: 'BramhaV2 — Your AI C-Suite',
    description: 'Multi-agent AI orchestration platform for founders and operators.',
    type: 'website',
  },
}

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <PricingCards teaser />
    </>
  )
}
