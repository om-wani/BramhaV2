# DESIGN.md — BramhaV2 UI System

Practical design system for the web app. Grounded in our real tokens
(`apps/web/app/globals.css`, `apps/web/tailwind.config.ts`) and Tailwind. Dark-first,
premium, low-eye-strain. Follow this for every new/edited component.

> Philosophy (distilled, not dogma): premium feel = **muted chroma + soft curvature +
> generous whitespace + physical motion**. Prefer calm over contrast, organic over
> mechanical. Skip effects that don't survive on a real screen at 100% zoom.

---

## 1. Tokens (source of truth)

All colors are CSS vars in `:root` (HSL triplets, used as `hsl(var(--x))` / `hsl(var(--x)/α)`).
**Never hardcode hex in components** — use the token.

| Token | HSL | Role |
|-------|-----|------|
| `--canvas` | `220 14% 5%` | app background (near-black, faint cool tint — not pure `#000`) |
| `--surface` | `220 12% 9%` | cards, panels, inputs, sidebar |
| `--border` | `220 10% 16%` | hairlines, dividers, input borders |
| `--text-primary` | `220 10% 92%` | body/headings (off-white, **never pure white**) |
| `--text-muted` | `220 8% 55%` | secondary text, labels, placeholders |
| `--accent` | `239 84% 67%` | primary actions, focus, links (indigo) |
| `--persona-*` | see globals | 8 agent identity accents (ceo/cto/…/cdao) |

Semantic (use Tailwind palette, muted tiers — not neon):
- **Success** → `emerald-400/500` (confirmations, "ready"). Reward color; use *after* a completed action.
- **Warning** → `yellow-400`. Rare, transient.
- **Destructive** → `red-400`. Only real destructive/error states (delete, failed). Never structural/ambient.

Rule: warm/long-wavelength (red/orange) = alerts only. Indigo/slate = structure + focus.
Green = success payoff. Keep brand accents desaturated in dark mode.

---

## 2. Curvature (G1 / G2 / G3 → radius tiers)

Softer, continuous corners read as premium. Map continuity intent to concrete radii:

| Tier | Use | Class |
|------|-----|-------|
| **G1** (functional) | checkboxes, badges, chips, inline code, tags | `rounded` / `rounded-md` (4–6px) |
| **G2** (interactive) | buttons, inputs, cards, list rows, toasts, menus | `rounded-lg` / `rounded-xl` (8–12px) |
| **G3** (foundational) | modals, side panels, hero/landing cards, artifact frames | `rounded-2xl`+ (16px+) |

- Default interactive surfaces to **`rounded-lg`**; step up to `rounded-xl`/`2xl` as the
  container grows. Consistency within a tier matters more than the exact px.
- **Squircle (optional, progressive enhancement):** for large G3 surfaces, `corner-shape: superellipse(1.8)`
  (a.k.a. squircle) where supported; fall back to `rounded-2xl`. Don't block on it — the radius tiers
  above are the baseline.
- Don't mix a sharp child inside a rounded parent flush to the corner (visible kink). Inset it, or match radii.

---

## 3. Contrast & legibility (WCAG)

- Body copy: aim **≥ 7:1** against its background (AAA). `--text-primary` on `--canvas`/`--surface` clears this.
- Large/bold text (≥18px or bold ≥14px): **≥ 4.5:1**. `--text-muted` is for *secondary* text only — never body copy on `--surface`.
- Interactive borders + focus rings: **≥ 3:1** vs their surface.
- Focus: always visible — `focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]`. Never remove focus without a replacement.
- Avoid pure-black-on-pure-white or pure-white-on-black (halation). We already don't.

---

## 4. Typography

- **Scale:** ≤ 4 sizes per view. Ours: `text-xs` (labels/meta), `text-sm` (body/UI), `text-lg`/`xl` (section), `text-2xl`/`4xl`/`5xl` (page/hero).
- **Weight (semantic):**
  - Buttons/links → `font-semibold` (600) or `font-medium` (500) — "pressable".
  - Labels → `font-medium` (500), optionally `tracking-wide` for all-caps micro-labels.
  - Body/narrative → `font-normal` (400).
  - On dark, avoid `font-light` for body — thin text washes out.
- **Line height:** body → `leading-relaxed` (~1.5–1.6). Display/headings → `leading-tight`/`leading-none` (~1.1–1.2). Micro-copy → `leading-4`.

---

## 5. Spacing & layout

- **8px grid.** Use Tailwind's default scale (multiples of 4/8). Don't invent arbitrary px.
- Padding tiers: component interiors `p-3`–`p-4`; grouped sections `p-6`–`p-8`; desktop shell gaps `gap-12`–`gap-16`.
- Whitespace over borders — prefer breathing room to dividers for grouping.
- Max content widths: forms `max-w-sm`, dashboards/lists `max-w-5xl`.

---

## 6. Motion

- **Never `transition-linear`** — looks synthetic.
- Micro-interactions (hover, toggle, color): `transition-* duration-150/200` with ease `cubic-bezier(0.4,0,0.2,1)` (Tailwind `ease-out` / `ease-in-out`).
- Panel/disclosure expansion: soft settle `cubic-bezier(0.34,1.56,0.64,1)`.
- **No teleporting / no CLS:** elements that appear must transition in; reserve space with height-matched skeletons (`animate-pulse`) so data mount doesn't shift layout. (We already use pulse skeletons on dashboard/files/rooms.)
- Existing keyframes live in `globals.css` (`toast-in`, `thinking-dot`, `caret`) — reuse, don't re-invent.

---

## 7. UX / retention principles

- **Zeigarnik (open loops):** show progress/incomplete state for multi-step flows (onboarding steps, ingestion status, delegation pending) — the brain returns to close them.
- **Endowment:** let users shape their space (collapse sidebar, per-project settings, custom rooms). Investment → ownership.
- **Spatial continuity / cognitive map:** things emerge from where they belong (menus open from their trigger, panels from their edge). The profile menu opens from the avatar; feedback from the status bar. Keep it literal.
- **Selective attention:** silent agents, minimal chrome, one primary action per view. Signal over noise (mirrors the council's own relevance philosophy).

---

## 8. Current state & how to apply

We already do: dark-first muted tokens, off-white text, persona palette, focus rings, pulse skeletons,
`ease-out` motion, `rounded-lg`/`xl` on most surfaces.

Known gaps to close incrementally (don't big-bang refactor):
- Radius consistency — some surfaces are `rounded-lg` where G3 (modals, hero, artifact iframe) should be `rounded-2xl`.
- A couple of muted-text-as-body spots to promote to `--text-primary`.
- Squircle enhancement on landing/hero + modals (optional).

When building or editing a component: pick the **radius tier** (§2), use **tokens** (§1), hit **contrast** (§3),
match **type/spacing** (§4–5), add **eased motion + no CLS** (§6). Reference this file in PRs that touch UI.
