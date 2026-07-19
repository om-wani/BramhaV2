export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: branding panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[hsl(var(--surface))] border-r border-[hsl(var(--border))]">
        <div>
          <span className="text-lg font-bold tracking-tight text-[hsl(var(--text-primary))]">
            Bramha
          </span>
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold leading-tight text-[hsl(var(--text-primary))]">
            Your AI C-Suite
            <br />
            is in session.
          </h1>
          <p className="text-[hsl(var(--text-muted))] text-lg leading-relaxed max-w-sm">
            Eight executive agents that know when to speak, remember what your company knows, and
            delegate to each other — in one room.
          </p>
        </div>
        <div className="flex gap-3">
          {['CEO', 'CTO', 'CMO', 'CFO', 'COO', 'CHRO', 'CSO', 'CDAO'].map((role) => (
            <span
              key={role}
              className="text-xs px-2 py-1 rounded-full bg-[hsl(var(--canvas))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]"
            >
              {role}
            </span>
          ))}
        </div>
      </div>

      {/* Right: form panel */}
      <div className="flex flex-col items-center justify-center px-6 py-12 bg-[hsl(var(--canvas))]">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
