# Design Tokens

Canonical source: `source/tokens.css`. This document indexes everything in that file with rationale.

The system is built on **three orthogonal axes** controlled by data attributes on `<html>`:

| Attribute | Values | Default |
|---|---|---|
| `data-theme` | `light`, `dark` | `light` |
| `data-accent` | `default` (blue), `black`, `indigo`, `terracotta`, `emerald` | `default` |
| `data-density` | `compact`, `comfortable`, `spacious` | `comfortable` |

Production should expose theme + density in user settings; accent can be a per-course color or a personalization choice.

---

## Color — Light theme

**Backgrounds** (warm-leaning, not pure gray — closer to Notion than Linear)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#fdfcfa` | Page background. Slightly warm off-white. |
| `--bg-elevated` | `#ffffff` | Cards, widgets, the lesson stream. Pure white. |
| `--bg-subtle` | `#f6f4f0` | Sidebar, code blocks, hover states on subtle elements. |
| `--bg-hover` | `#f0ede7` | Hover background for list items. |
| `--bg-active` | `#e8e4dc` | Pressed state. |
| `--bg-inverse` | `#18171a` | Tooltip / inverse-surface background. |

**Borders**

| Token | Hex | Usage |
|---|---|---|
| `--border` | `#e8e4dc` | Default 1px hairline. |
| `--border-strong` | `#d4cec3` | Inputs, slightly heavier dividers. |
| `--border-focus` | `var(--accent)` | Focused inputs (paired with focus ring shadow). |

**Text**

| Token | Hex | Usage |
|---|---|---|
| `--text` | `#18171a` | Primary text. Near-black, slightly warm. |
| `--text-secondary` | `#56524a` | Body text, descriptions. |
| `--text-tertiary` | `#8a8479` | Labels, metadata, captions. |
| `--text-quaternary` | `#b3ad9f` | Disabled, placeholder. |
| `--text-inverse` | `#fdfcfa` | Text on dark surfaces. |
| `--text-on-accent` | `#ffffff` | Text on accent-filled buttons. |

**Accent (default = blue)**

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#2563eb` | Primary buttons, links, active TOC item. |
| `--accent-hover` | `#1d4fd7` | Button hover. |
| `--accent-active` | `#1a44b8` | Button pressed. |
| `--accent-subtle` | `#eaf0fd` | Tinted backgrounds (selected nav, info badges). |
| `--accent-subtle-hover` | `#dbe5fc` | Hover on subtle accent surfaces. |
| `--accent-border` | `#c2d2f8` | Tinted borders. |
| `--accent-text` | `#1d4fd7` | Accent-colored text (links). |

**Semantic**

| Tone | `--{tone}` | `--{tone}-subtle` | `--{tone}-border` | Usage |
|---|---|---|---|---|
| Success | `#0d7a5f` | `#e3f3ec` | `#b8dccb` | "Completed", passing tests, correct answers. |
| Warning | `#b45309` | `#fdf4e3` | `#f1d9a8` | Attention, autosave-in-progress, sandbox widget. |
| Danger | `#be3a3a` | `#fcebe9` | `#f1c0bb` | Errors, incorrect quiz, failing tests. |
| Insight | `#6b3eaa` | `#f1ebfa` | `#ddccf2` | Theory callouts ("aha moments"), quiz widget accent. |

**Widget rails** (per-type accent — used as a 1px hairline on the widget's left edge + the widget's icon color, nothing more — keeps the chrome calm)

| Widget | Token | Light hex |
|---|---|---|
| Theory | `--widget-theory` | `#56524a` (neutral) |
| Demo | `--widget-demo` | `#2563eb` (blue) |
| Quiz | `--widget-quiz` | `#6b3eaa` (purple) |
| Code | `--widget-code` | `#0d7a5f` (green) |
| Sandbox | `--widget-sandbox` | `#b45309` (amber) |

**Code block syntax** (light)

| Token | Hex |
|---|---|
| `--code-bg` | `#fafaf7` |
| `--code-text` | `#18171a` |
| `--code-keyword` | `#6b3eaa` |
| `--code-string` | `#0d7a5f` |
| `--code-comment` | `#8a8479` |
| `--code-fn` | `#2563eb` |
| `--code-number` | `#b45309` |

---

## Color — Dark theme

Dark uses the same token names with darker backgrounds and a slightly desaturated cooler accent. See `tokens.css` for exact values; key changes:

- `--bg: #0f0e11`, `--bg-elevated: #18171a`, `--bg-subtle: #1c1b1f`
- `--text: #f0ede7` (warm off-white, not pure white — reduces eye strain)
- `--accent: #4f8aff` (lighter, less saturated than light theme)
- All semantic colors lift in luminance to stay readable on dark surfaces.

---

## Accent variants

Production should ship **default (blue)** and let the user pick from {default, black, indigo, terracotta, emerald}. Each variant has its own light + dark branch in `tokens.css`. Apply via `<html data-accent="terracotta">`.

The accent affects: primary buttons, focused inputs, links, active nav items, the user-message bubble in LessonChat, the progress bar fill, and a few subtle accent-tinted backgrounds. It does **not** affect widget rails (those stay semantic by widget type).

---

## Spacing scale (density-aware)

The scale changes with `data-density`. Comfortable is the default.

| Token | Compact | Comfortable | Spacious |
|---|---|---|---|
| `--space-1` | 3px | 4px | 4px |
| `--space-2` | 6px | 8px | 10px |
| `--space-3` | 9px | 12px | 14px |
| `--space-4` | 12px | 16px | 20px |
| `--space-5` | 16px | 20px | 26px |
| `--space-6` | 20px | 24px | 32px |
| `--space-7` | 24px | 32px | 44px |
| `--space-8` | 32px | 40px | 56px |
| `--space-9` | 44px | 56px | 72px |
| `--space-10` | 64px | 80px | 96px |
| `--space-section` | 32px | 48px | 64px |
| `--line-height-prose` | 1.6 | 1.7 | 1.8 |

**Usage convention:** `space-3` for tight inline gaps, `space-4`–`space-5` for component internal padding, `space-6`–`space-7` for content padding inside widgets, `space-section` between major lesson sections.

---

## Border radii

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` | 3px | Inline pills, hover backgrounds. |
| `--radius-sm` | 5px | Small buttons, badges, kbd keys. |
| `--radius-md` | 7px | Inputs, default buttons, smaller cards. |
| `--radius-lg` | 10px | Widget containers, large cards. |
| `--radius-xl` | 14px | Modal dialogs. |
| `--radius-2xl` | 20px | Large hero cards. |
| `--radius-full` | 9999px | Avatars, status dots. |

Restraint: nothing is pill-shaped except status dots, avatars, and one round close button. Default to `radius-md` or `radius-lg`.

---

## Type scale

| Token | Size | Usage |
|---|---|---|
| `--fs-xs` | 11px | Eyebrow labels, metadata (uppercase, letter-spacing 0.06em, weight 600). |
| `--fs-sm` | 13px | Secondary text, button labels. |
| `--fs-base` | 14.5px | Body default. |
| `--fs-md` | 16px | Prose body in Theory widget. |
| `--fs-lg` | 18px | Section subheads. |
| `--fs-xl` | 22px | Card titles, lesson title in toolbar. |
| `--fs-2xl` | 28px | Page headings (Dashboard, Create flow). |
| `--fs-3xl` | 36px | Empty-state hero, lesson H1 in focus mode. |
| `--fs-4xl` | 48px | Hero numbers, splash. |
| `--fs-5xl` | 64px | Reserved — currently unused. |

**Prose-specific:** the Theory widget's body uses `--fs-md` (16px) with `--line-height-prose` (1.7) and `--font-prose`. Generous, readable, Distill-style. Max prose width should be ~720px in production for long-form text.

---

## Fonts

Three swappable font systems via `data-font`:

| Font key | Sans | Mono | Prose | Display |
|---|---|---|---|---|
| `geist` (default) | Geist | Geist Mono | Geist | Geist |
| `plex` | IBM Plex Sans | IBM Plex Mono | IBM Plex Sans | IBM Plex Sans |
| `serif` | Geist | Geist Mono | Source Serif 4 | Source Serif 4 |

The `serif` variant uses a serif for prose only (long-form text in Theory widgets) — gives a Distill/academic feel while keeping UI chrome clean.

**Font features enabled:** `'ss01'` (alternate digits), `'cv11'` (alternate `a`/`g` shapes for Geist). Apply on `body`. Also: `text-rendering: optimizeLegibility`, antialiasing on.

---

## Shadows

Subtle, never corporate. Use sparingly — most surfaces are flat with a 1px border.

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | hairline | hairline |
| `--shadow-sm` | card resting | card resting |
| `--shadow-md` | card hover, dropdowns | dropdowns |
| `--shadow-lg` | modals, focused tutor panel | modals |
| `--shadow-focus` | 3px accent-tinted ring | 3px accent-tinted ring |

The focus shadow is applied via `:focus-visible` on all interactive elements. **Do not remove or override it** — accessibility-critical.

---

## Transitions

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120ms cubic-bezier(0.16, 1, 0.3, 1) | Hover, focus, color changes. |
| `--t-base` | 180ms cubic-bezier(0.16, 1, 0.3, 1) | Panel slide, modal enter. |
| `--t-slow` | 280ms cubic-bezier(0.16, 1, 0.3, 1) | Page transitions, big layout shifts. |

The easing is a "back-out" curve — quick start, gentle settle. Feels responsive without being jarring.

---

## Scrollbars

Custom-styled (WebKit) — 10px wide, transparent track, `--border-strong` thumb with 2px transparent border (creates the "fat" effect), `--text-tertiary` on hover. See bottom of `tokens.css`.

---

## Focus ring

```css
:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: var(--radius-sm);
}
```

This is global. Every interactive element gets it. Tested against WCAG 2.1 contrast at AA.
