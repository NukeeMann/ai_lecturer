# Widgets

This folder contains every widget the lesson stream can render. The MVP ships
six built-in types (`theory`, `quiz`, `code`, `demo`, `sandbox`, `histogram`)
plus a `custom` placeholder. Each widget is self-contained: a Zod data schema,
a React component, an editor form, and a registry entry — no other module
needs to know it exists.

This document explains the contract and walks through the five steps to add
your own widget type. The `Histogram/` folder is the working reference
implementation — copy it, rename, and adjust.

## File layout

```
src/widgets/
  registry.ts             — central registry mapping type → component/icon/label/accent
  Widget.tsx              — chrome (header, status badge, accent rail) used by every widget
  schemas/
    build.ts              — npm run build:schemas writes <type>.json next to this file
  <Name>/
    schema.ts             — Zod schema + inferred TS type
    <Name>Widget.tsx      — read/render component, props: { data: <Type>Data }
    <Name>Editor.tsx      — side-panel form, props: { initial, onCancel, onSave }
    sample.ts             — typed sample data (used by storybook-style fixtures, init skills)
```

## Steps to add a new widget type

The five steps below are mandatory in this order — skipping one will produce
a runtime error or break the schema build.

### 1. Add a CSS var `--widget-<name>` in `src/styles/tokens.css`

The widget header chrome paints a 1-px accent rail, an icon background tint,
and the "in progress" badge from this single CSS variable. Add a value in
both the light and dark theme blocks. Pick a tasteful muted colour distinct
from existing widget accents — they are intentionally low-saturation so the
content stays the focus, not the chrome.

```css
:root,
:root[data-theme="light"] {
  /* ... */
  --widget-histogram: #4e7a85;   /* muted teal */
}

:root[data-theme="dark"] {
  /* ... */
  --widget-histogram: #82b3bd;   /* lighter for dark backgrounds */
}
```

Existing accents (light theme) — avoid clashes:

| widget    | accent     |
| --------- | ---------- |
| theory    | `#56524a`  |
| demo      | `#2563eb`  |
| quiz      | `#6b3eaa`  |
| code      | `#0d7a5f`  |
| sandbox   | `#b45309`  |
| histogram | `#4e7a85`  |

### 2. Define the Zod data schema in `src/widgets/<Name>/schema.ts`

Schemas are the single source of truth: they drive runtime validation in
`/api/courses/.../lessons` route handlers, the editor form, and the JSON
Schema files emitted by `npm run build:schemas`.

Keep schemas minimal and concrete. Use `.refine()` for cross-field invariants
(e.g. `binEdges.length === counts.length + 1`). Export both the schema and
the inferred type so editor and widget can share the type without circular
imports.

```ts
// src/widgets/Histogram/schema.ts
import { z } from 'zod';

export const HistogramDataSchema = z
  .object({
    binEdges: z.array(z.number()).min(2),
    counts: z.array(z.number().nonnegative()).min(1),
  })
  .refine((d) => d.binEdges.length === d.counts.length + 1, {
    message: 'binEdges.length must equal counts.length + 1',
    path: ['binEdges'],
  });

export type HistogramData = z.infer<typeof HistogramDataSchema>;
```

Then add the schema to `src/widgets/schemas/build.ts` so `npm run
build:schemas` emits a JSON Schema file alongside the others:

```ts
import { HistogramDataSchema } from '@/widgets/Histogram/schema';

const widgets: Record<string, ZodSchema> = {
  // ... existing entries
  histogram: HistogramDataSchema,
};
```

After running `npm run build:schemas` a new `src/widgets/schemas/<name>.json`
file is committed alongside the others. Don't hand-edit those files — they
are regenerated.

### 3. Add an entry to `widgetRegistry`

`src/widgets/registry.ts` is what `Widget.tsx` reads to render the chrome
(icon, label, accent rail) and what `SectionRenderer` falls through to for
unknown section types.

```ts
// src/widgets/registry.ts
import { BarChart3 } from 'lucide-react';
import { HistogramWidget } from './Histogram/HistogramWidget';

export type WidgetType =
  | 'theory' | 'quiz' | 'code' | 'demo' | 'sandbox'
  | 'histogram'   // ← add to the union
  | 'custom';

export const widgetRegistry: Record<WidgetType, WidgetRegistryEntry> = {
  // ... existing entries
  histogram: {
    component: HistogramWidget as ComponentType<{ data?: unknown }>,
    label: 'Histogram',
    icon: BarChart3,                    // any lucide-react icon
    accentVar: '--widget-histogram',    // matches step 1
  },
};
```

Each entry needs all four fields:

- **`component`** — the read-mode React component. Receives `{ data }` typed
  as `unknown` (the registry erases the per-widget type so the registry can
  stay generic). Cast to the concrete type inside the component, or wrap in
  a typed adapter — `HistogramWidget` accepts `HistogramData` directly.
- **`label`** — the short human label shown in the widget header eyebrow
  ("HISTOGRAM · §3"). Keep it ≤ 16 chars.
- **`icon`** — a lucide-react icon component (default size 14, no need to
  pass it). See <https://lucide.dev/icons/> for options. Pick a glyph that
  makes the widget recognisable when scanning the lesson stream.
- **`accentVar`** — the CSS variable name (with leading `--`) that the chrome
  uses for the rail and icon tint. Must match step 1 exactly.

### 4. Add a per-widget editor form

The editor opens in a 320-px side panel when the user clicks the pencil
button on a section header (US-023 pattern). Each editor is a small
controlled form that:

1. Hydrates from `initial: <Type>Data`.
2. Tracks dirty state vs. `initial`.
3. Calls `<Type>DataSchema.safeParse` before saving and surfaces issues
   inline via `EditorFormSaveError` / per-field `errorTextStyle`.
4. Calls `onSave(next)` with the parsed data; the parent persists via
   `PUT /api/courses/<slug>/lessons/<lessonSlug>`.
5. Calls `onCancel()` to close without saving.

Use the helpers in `@/components/EditorForm` so every editor looks the same:

```tsx
// src/widgets/Histogram/HistogramEditor.tsx (excerpt)
import {
  EditorFormFooter, EditorFormSaveError,
  fieldStyle, formBodyStyle, inputStyle, labelStyle,
  errorTextStyle,
} from '@/components/EditorForm';

export function HistogramEditor({ initial, onCancel, onSave }) {
  // ... state, parse, dirty checks
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Bin edges (comma-separated)</span>
          <input style={inputStyle} ... />
        </label>
        {/* ...more fields... */}
      </div>
      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
```

Then wire it into the lesson page panel and the section renderer at
`src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx`:

- Import the editor at the top of the file.
- Add a branch inside `WidgetEditPanel` that renders the editor when
  `section?.type === '<name>'` and forwards `onCancel` / `onSave`.
- Add a branch inside `SectionRenderer` that wires the read-mode body and a
  pencil button so the user can open the panel from the widget header.

### 5. (Optional) Extend `SectionSchema`

Steps 1–4 only register the widget for rendering. To allow `<name>` sections
to live inside lesson JSON files (and thus survive a round-trip through the
PUT /api/courses/.../lessons handler) you also need to add a section variant
to the discriminated union in `src/lib/schemas/lesson.ts`:

```ts
import { HistogramDataSchema } from '@/widgets/Histogram/schema';

export const HistogramSectionSchema = z.object({
  ...sectionBase,
  type: z.literal('histogram'),
  data: HistogramDataSchema,
});

export const SectionSchema = z.discriminatedUnion('type', [
  // ... existing variants
  HistogramSectionSchema,
]);
```

Without this step, the section will still render at runtime (the registry
has no schema dependency) but lesson JSON containing it will be rejected by
the API on save / load. **Always add the union variant unless you have a
specific reason not to.**

## Quick checklist

When adding a new widget type, all of these must be true before commit:

- [ ] `--widget-<name>` defined in both light and dark theme blocks of `tokens.css`
- [ ] `src/widgets/<Name>/schema.ts` exports `<Name>DataSchema` + `<Name>Data`
- [ ] `src/widgets/<Name>/<Name>Widget.tsx` exports `<Name>Widget` taking `{ data }`
- [ ] `src/widgets/<Name>/<Name>Editor.tsx` exports `<Name>Editor` matching the contract
- [ ] `src/widgets/<Name>/sample.ts` exports a fixture for fixtures / init skills
- [ ] `widgetRegistry` has a `<name>` entry (component / label / icon / accentVar)
- [ ] `WidgetType` union includes `'<name>'`
- [ ] `src/widgets/schemas/build.ts` includes the schema; `npm run build:schemas` regenerates `<name>.json`
- [ ] `SectionSchema` discriminated union includes `<Name>SectionSchema` (see step 5)
- [ ] `WidgetEditPanel` and `SectionRenderer` in the lesson page render the new editor + pencil button
- [ ] `npm run typecheck` is clean

The Histogram widget added in US-030 follows every step above and is the
recommended copy-paste starting point for a new widget.
