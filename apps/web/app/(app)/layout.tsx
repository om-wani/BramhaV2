import { AppHeader } from './_components/app-header'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main>{children}</main>
    </div>
  )
}
