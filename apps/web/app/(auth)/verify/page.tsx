import Link from 'next/link'
import { AuthCard } from '../_components/auth-card'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Verify your email — BramhaV2' }

export default function VerifyPage() {
  return (
    <AuthCard title="Check your email" description="We sent you a verification link.">
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          Click the link in your email to activate your account. Check your spam folder if you
          don&apos;t see it within a few minutes.
        </p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  )
}
