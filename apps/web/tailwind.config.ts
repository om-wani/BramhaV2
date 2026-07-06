import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Neutral dark-first palette
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Status colors (06-doc §9)
        status: {
          waiting: 'hsl(38 92% 50%)',     // amber
          error: 'hsl(0 84% 60%)',        // red
          thinking: 'hsl(271 81% 56%)',   // violet
          done: 'hsl(142 71% 45%)',       // green
        },
        // Persona accent palette — 8 accessible colors (AA on both themes)
        persona: {
          ceo:   'hsl(217 91% 60%)',  // blue
          cto:   'hsl(271 81% 56%)',  // violet
          cmo:   'hsl(338 75% 55%)',  // pink
          cfo:   'hsl(160 60% 45%)',  // teal
          coo:   'hsl(38 92% 50%)',   // amber
          chro:  'hsl(25 90% 55%)',   // orange
          cso:   'hsl(0 84% 60%)',    // red
          cdao:  'hsl(195 80% 50%)',  // cyan
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
