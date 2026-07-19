export default function SettingsPage() {
  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[hsl(var(--text-primary))]">Settings</h1>
        <p className="text-[hsl(var(--text-muted))] text-sm mt-1">Manage your account preferences.</p>
      </div>

      {/* Profile section */}
      <section aria-label="Profile" className="mb-8">
        <h2 className="text-base font-semibold text-[hsl(var(--text-primary))] mb-4 pb-2 border-b border-[hsl(var(--border))]">
          Profile
        </h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="display-name"
              className="block text-sm font-medium text-[hsl(var(--text-primary))]"
            >
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              disabled
              placeholder="Your name"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] text-sm cursor-not-allowed opacity-60"
            />
            <p className="text-xs text-[hsl(var(--text-muted))]">
              Name changes are not yet available — coming soon.
            </p>
          </div>
          <button
            disabled
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] cursor-not-allowed opacity-60"
          >
            Save name
          </button>
        </div>
      </section>

      {/* Password section */}
      <section aria-label="Password" className="mb-8">
        <h2 className="text-base font-semibold text-[hsl(var(--text-primary))] mb-4 pb-2 border-b border-[hsl(var(--border))]">
          Password
        </h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-[hsl(var(--text-primary))]"
            >
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              disabled
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] text-sm cursor-not-allowed opacity-60"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-[hsl(var(--text-primary))]"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              disabled
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-lg bg-[hsl(var(--canvas))] border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] text-sm cursor-not-allowed opacity-60"
            />
          </div>
          <p className="text-xs text-[hsl(var(--text-muted))]">
            Password changes are not yet available — coming soon.
          </p>
          <button
            disabled
            className="px-4 py-2 text-sm rounded-lg bg-[hsl(var(--surface))] border border-[hsl(var(--border))] text-[hsl(var(--text-muted))] cursor-not-allowed opacity-60"
          >
            Change password
          </button>
        </div>
      </section>

    </div>
  );
}
