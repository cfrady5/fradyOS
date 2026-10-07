# fradyOS design system — "Instrument"

A single dark theme built for daily work and personal finance. The system lives in three places:

| Layer | Where | What it owns |
|---|---|---|
| Tokens | `src/app/globals.css` (`:root` + `@theme inline`) | colors, type scale, spacing, radii, shadows, motion |
| Primitives | `src/components/ui/*` | buttons, inputs, badges, tabs, dialogs, sheets, tables, toasts |
| App components | `src/components/app/items.tsx`, `metric.tsx`, `filter-bar.tsx`, `finance/bits.tsx` | page/section headers, rows, metrics, filters, finance nav |

Raw hex values exist only in `globals.css`. Everything else references semantic names.

## Tokens

**Surfaces** — four steps from canvas to overlay. Panels are separated by hairlines, not shadows.

| Token | Use |
|---|---|
| `surface-0` `#0e1014` | page canvas, sidebar, header |
| `surface-1` `#14171d` | panels (`Card`), sheets, dialogs, inputs on hover |
| `surface-2` `#1a1e26` | raised chrome: secondary buttons, kbd, tags, active nav |
| `surface-3` `#21262f` | overlays: popovers, menus, toasts, tab indicator |
| `surface-hover` `#1c212a` | row hover |

**Text** — `text-1` warm off-white `#f2efe8` for titles and primary content, `text-2` `#a8adb6` for secondary copy, `text-3` `#767d8a` for metadata, eyebrows and indexes.

**Lines** — `line-1` hairline (panels, dividers), `line-2` strong (inputs, hover), `line-3` emphasized (completion circles, separators in eyebrows).

**Brand** — one electric blue: `brand` `#4f7dff` (primary buttons, active indicator bar, focus rings), `brand-hover`, `brand-active`, `brand-soft` `#9db6ff` for brand-coloured text and icons on dark.

**Status** (reserved, never used as chart series): `success`, `warning`, `danger`, `info`. Status always ships with a label or icon.

**Work areas** — the stored area colours are left untouched. `.area-text`, `.area-tint` and `.area-dot` derive readable text / tint / dot from `--area-color` with `color-mix`, so any saved colour reads on dark. Area labels always carry the name (`AreaTag`), never colour alone. Presets: `area-ari`, `area-nm`, `area-personal`.

**Type scale** (utilities): `text-display` 32/1.1/-0.022em 600 (page titles, desktop), `text-title` 22px (dialog titles, mobile page titles), `text-heading` 15px 600 (section headings, card titles), `text-body` 14px, `text-meta` 12px, `text-eyebrow` 11px. Helpers: `.eyebrow` (uppercase, 0.12em tracking, `text-3`), `.index` (mono two-digit counters "01"), `.nums` (tabular numerals — every money value, date and count).

**Radii** — `xs` 4, `sm` 6, `md` 8 (buttons, inputs, rows), `lg` 12 (panels), `xl` 16 (dialogs).

**Motion** — `--dur-fast` 140ms (hover, colour), `--dur-base` 200ms (tabs, popovers, rows), `--dur-slow` 280ms (page enter, dialogs). Only opacity and transform animate. Keyframes: `animate-page-in`, `animate-fade-in`, `animate-row-in`, `animate-check-pop`, `animate-shimmer`. `prefers-reduced-motion` collapses every animation and transition.

## Shell

- Sidebar (232px) with numbered groups: `01 Work`, `02 Money`, Settings pinned at the bottom. One brand bar slides to the active link; hover only lifts text. Each item reveals its `G`+key shortcut on hover.
- Compact account control (initials, name, timezone) opens a menu with Settings, Reminders and Sign out.
- Top bar: persistent search (`⌘K`), shortcuts help (`?`), notifications, `Add task` (`N`).
- Phones: bottom bar (Today, Tasks, Calendar, Finances, More), floating add button, left drawer with the same numbered navigation.
- Pages fade up once per route (`animate-page-in`, keyed by pathname; opening the detail sheet via `?task=` does not re-run it).

## Page anatomy

```
PageHeader   eyebrow "01 Work / Tasks" (auto from nav) · display title · one-line description · actions
             └ children: FilterBar (view switch + search + filters; phones get a bottom sheet with a count + Reset)
SectionHeader index "01" · heading · mono count · hint · action      (sits on a hairline)
RowList      hairline-divided rows (TaskRow / EventRow / SocialPostRow), hover fill, selected = brand tint
MetricStrip  2-up on phones, n-up on desktop; Metric = eyebrow label + tabular value + sub + optional tag
EmptyState   inline (dashed hairline row, one action) or page
```

Rules of thumb:

- Hairlines over shadows; no cards inside cards. Shadows only on popovers and dialogs.
- Titles are the dominant element in a row. Everything else is 12px `text-3` metadata.
- Zero values are `muted` (`text-3`), never coloured.
- Numbers in tables and tiles use `.nums` and right-align.
- Finance figures carry a tag where the basis matters: `Current`, `Projected`, `Target`, `Connected`, `Manual`.
- Essential actions (complete, open, add) are always visible; hover only reveals hints.
- Segmented `Tabs` switch views of one page; underline `FinanceNav` switches pages of a section.

## Accessibility

- Visible focus for everything: `focus-visible` ring in `brand/40`, or the global outline in `base`.
- Dialogs and sheets trap focus (Radix); the mobile filter sheet mirrors the desktop controls.
- Status and work-area meaning never rely on colour alone.
- Minimum 32px hit areas on row controls; 44px nav targets on phones.
