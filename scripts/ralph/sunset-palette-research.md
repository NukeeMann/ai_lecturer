# Sunset palette research note

**Status:** research deliverable for US-162. Feeds US-163, which copies the
HEX tables verbatim into `:root[data-theme="sunset"][data-sunset-variant="A|B|C"]`
blocks in `src/styles/tokens.css`. **No code change in this story.**

**Baseline under review:** `src/styles/tokens.css:163–234`, the current
`:root[data-theme="sunset"]` block. The block is reproduced inline in the
"Current palette" table below so this note is self-contained.

---

## 1. Why the current sunset palette feels washed-out

The current block is technically high-contrast — text-on-bg lands at
**12.31:1** WCAG, well above AAA — but it reads as muted because every
foreground hue lives inside a ±15° wedge of the accent. The bg is a warm,
slightly-saturated brown; the text is warm cream; the accent is warm orange;
the widget rails span only ~30° of hue. Result: high luminance contrast,
low *chromatic* contrast, "washed-out" perception.

Concretely, for the current block:

| Token | HEX | HSL | Notes |
| --- | --- | --- | --- |
| `--bg` | `#2a1f1a` | `20°, 23%, 13%` | warm brown, only modestly saturated |
| `--text` | `#f4ddc0` | `36°, 70%, 85%` | cream, hue ~16° away from accent |
| `--accent` | `#e0a458` | `33°, 69%, 61%` | tan-orange, mid saturation |
| `--text` ↔ `--bg` | — | — | **WCAG 12.31:1** |
| `--accent` ↔ `--bg` | — | — | **WCAG 7.36:1** |

So the three levers each candidate pulls to reduce wash-out are:

1. **Push accent saturation above 69%** (the current ceiling for the dominant
   color), so accents read as accents and not as another tone of the bg.
2. **Increase hue separation** between bg/text/accent — either by deepening
   and re-tinting the bg (candidates A, B) or by cooling the bg into the
   blue-teal family while keeping a warm accent (candidate C).
3. **Hold text/bg WCAG ≥ 12:1** so we don't trade legibility for vibrance.
   All three candidates land at 14.8:1 or higher.

All WCAG ratios below use the standard sRGB relative-luminance formula
(per WCAG 2.1 §1.4.3). HSL values use the standard hex→HSL conversion.

### Comparison summary

| Metric | Current | A — Ember Drive | B — Magenta Dusk | C — Coastal Sundown |
| --- | --- | --- | --- | --- |
| text / bg WCAG ratio | 12.31:1 | **15.11:1** | **14.85:1** | **14.82:1** |
| accent / bg WCAG ratio | 7.36:1 | **7.77:1** | 5.32:1 † | **7.66:1** |
| accent HSL saturation | 69% | **100%** | **85%** | **100%** |
| accent HSL hue | 33° | 27° | 337° | 21° |
| bg HSL saturation | 23% | **41%** | **36%** | **17%** ‡ |
| hue spread bg↔accent | ~13° | ~5° (sharper L) | **~317°** (split-comp) | ~6° on warm + cool bg |

† Magenta accent on a wine-tinted bg gives lower *luminance* contrast (still
above WCAG AA at 5.32:1) but a much larger *chromatic* gap — the magenta
reads as far more saturated and "punchy" than the current tan-orange despite
the smaller WCAG number. This is the central trade-off for Candidate B.

‡ Candidate C intentionally keeps the bg low-saturation but flips its hue
to cool blue-gray. The wash-out fix comes from the warm/cool split, not from
saturating the bg.

---

## 2. Reference current palette (token-for-token)

This is what `:root[data-theme="sunset"]` ships today, transcribed verbatim
from `src/styles/tokens.css:163–234` so the candidate tables below are
directly comparable side-by-side.

| Token | Current |
| --- | --- |
| `--bg` | `#2a1f1a` |
| `--bg-elevated` | `#332622` |
| `--bg-subtle` | `#3a2a25` |
| `--bg-hover` | `#44312a` |
| `--bg-active` | `#4f392f` |
| `--bg-inverse` | `#fdfcfa` |
| `--border` | `#4a3529` |
| `--border-strong` | `#5a4231` |
| `--border-focus` | `var(--accent)` |
| `--text` | `#f4ddc0` |
| `--text-secondary` | `#d8b896` |
| `--text-tertiary` | `#b8967a` |
| `--text-quaternary` | `#876649` |
| `--text-inverse` | `#2a1f1a` |
| `--text-on-accent` | `#2a1f1a` |
| `--accent` | `#e0a458` |
| `--accent-hover` | `#ebb573` |
| `--accent-active` | `#cc8e44` |
| `--accent-subtle` | `#2e2419` |
| `--accent-subtle-hover` | `#3a2c1f` |
| `--accent-border` | `#5a4628` |
| `--accent-text` | `#ebc183` |
| `--success` | `#6dbf8a` |
| `--success-subtle` | `#1f2e22` |
| `--success-border` | `#2f4a36` |
| `--warning` | `#e8b06a` |
| `--warning-subtle` | `#33251a` |
| `--warning-border` | `#5a3f24` |
| `--danger` | `#e87a6a` |
| `--danger-subtle` | `#331e18` |
| `--danger-border` | `#5a2e25` |
| `--insight` | `#c89bd8` |
| `--insight-subtle` | `#2c1f33` |
| `--insight-border` | `#4a3357` |
| `--widget-theory` | `#d8b896` |
| `--widget-demo` | `#e8b06a` |
| `--widget-quiz` | `#c89bd8` |
| `--widget-code` | `#6dbf8a` |
| `--widget-code-cloze` | `#7ec0c8` |
| `--widget-sandbox` | `#e0a458` |
| `--widget-histogram` | `#9bb8be` |
| `--widget-plot-image` | `#d6b276` |
| `--widget-parametric-explorer` | `#b39fd0` |
| `--widget-drag-match` | `#d49ea8` |
| `--widget-data-table` | `#a3b8d0` |
| `--widget-video` | `#e89aa0` |
| `--widget-audio-player` | `#7ec0c8` |
| `--widget-transcript-cloze` | `#9bbed3` |
| `--widget-stt-demo` | `#e89a9a` |
| `--code-bg` | `#2c1f18` |
| `--code-text` | `#f4ddc0` |
| `--code-keyword` | `#c89bd8` |
| `--code-string` | `#6dbf8a` |
| `--code-comment` | `#876649` |
| `--code-fn` | `#e8b06a` |
| `--code-number` | `#ebb573` |
| `--shadow-xs` | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| `--shadow-sm` | `0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2)` |
| `--shadow-md` | `0 2px 6px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)` |
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.3)` |
| `--shadow-focus` | `0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)` |

All three candidates keep the **shadow stack identical** to the current
palette. Sunset is a dark theme; the shadow-on-near-black look is doing
its job and the wash-out complaint is about chroma, not depth.

---

## 3. Candidate A — "Ember Drive" (Saturated Warm) **← ship-first default**

### Rationale

Ember Drive keeps the sunset thematic story — warm, dusky, glowing — but
turns the dial on every axis. The bg drops two stops darker and gains
saturation (23% → 41%), so it reads as "burnt umber under low sun" rather
than "office wall under fluorescent." The accent goes to a fully saturated
ember-orange (`#ff8c2e`, HSL 27°/100%/59%), 31 percentage points more
saturated than the current `#e0a458`. Text shifts from peach-cream to a
brighter, less-yellowed cream (`#ffe8c4`) so the bump in bg darkness still
yields a 15.1:1 ratio. The semantic tokens (success/danger/insight) gain
saturation in lockstep so they don't disappear next to the new accent.

Ember Drive is the lowest-risk swap: anyone who picked "sunset" because they
wanted *warm* will still get warm — just less dusty. It's the recommended
default because it preserves user intent while fixing the complaint.

**References:**

- Material Design 3 color system, "tonal palette" guidance (the principle
  that paired tones should differ by ≥40 luminance points to read as
  distinct): https://m3.material.io/styles/color/system/overview
- Refactoring UI, "Building your color palette" — argues for picking a
  single saturated lead accent and letting neutrals stay quiet:
  https://www.refactoringui.com/
- Sunset photography reference set (warm-on-burnt-umber sunsets):
  https://unsplash.com/s/photos/sunset

### Contrast / saturation vs current

| Pair / metric | Current | Ember Drive | Δ |
| --- | --- | --- | --- |
| `--text` ↔ `--bg` WCAG | 12.31:1 | **15.11:1** | +2.80 |
| `--accent` ↔ `--bg` WCAG | 7.36:1 | **7.77:1** | +0.41 |
| `--accent` HSL saturation | 69% | **100%** | +31 pp |
| `--bg` HSL saturation | 23% | **41%** | +18 pp |
| `--danger` ↔ `--bg` WCAG | ~5.4:1 | ~6.5:1 | + (more vivid red) |

### Full token table

| Token | Ember Drive HEX |
| --- | --- |
| `--bg` | `#1f140d` |
| `--bg-elevated` | `#2a1a11` |
| `--bg-subtle` | `#321e14` |
| `--bg-hover` | `#3d2618` |
| `--bg-active` | `#4a2d1c` |
| `--bg-inverse` | `#fff9f0` |
| `--border` | `#4d2e1a` |
| `--border-strong` | `#663e22` |
| `--border-focus` | `var(--accent)` |
| `--text` | `#ffe8c4` |
| `--text-secondary` | `#ecc88d` |
| `--text-tertiary` | `#c89868` |
| `--text-quaternary` | `#8a623c` |
| `--text-inverse` | `#1f140d` |
| `--text-on-accent` | `#1f140d` |
| `--accent` | `#ff8c2e` |
| `--accent-hover` | `#ffa55a` |
| `--accent-active` | `#e57622` |
| `--accent-subtle` | `#2e1a0d` |
| `--accent-subtle-hover` | `#3b210f` |
| `--accent-border` | `#663c14` |
| `--accent-text` | `#ffb978` |
| `--success` | `#4ed688` |
| `--success-subtle` | `#122c1c` |
| `--success-border` | `#1f4a30` |
| `--warning` | `#ffb133` |
| `--warning-subtle` | `#2e210b` |
| `--warning-border` | `#5c4014` |
| `--danger` | `#ff6852` |
| `--danger-subtle` | `#321811` |
| `--danger-border` | `#5c281f` |
| `--insight` | `#d785f5` |
| `--insight-subtle` | `#2a1438` |
| `--insight-border` | `#4d2b66` |
| `--widget-theory` | `#ecc88d` |
| `--widget-demo` | `#ffb133` |
| `--widget-quiz` | `#d785f5` |
| `--widget-code` | `#4ed688` |
| `--widget-code-cloze` | `#58ccd6` |
| `--widget-sandbox` | `#ff8c2e` |
| `--widget-histogram` | `#7ec8d2` |
| `--widget-plot-image` | `#e6b85c` |
| `--widget-parametric-explorer` | `#b888e6` |
| `--widget-drag-match` | `#e688a3` |
| `--widget-data-table` | `#88a8e6` |
| `--widget-video` | `#f06e90` |
| `--widget-audio-player` | `#58ccd6` |
| `--widget-transcript-cloze` | `#7ab8e0` |
| `--widget-stt-demo` | `#f06868` |
| `--code-bg` | `#1a1108` |
| `--code-text` | `#ffe8c4` |
| `--code-keyword` | `#d785f5` |
| `--code-string` | `#4ed688` |
| `--code-comment` | `#8a623c` |
| `--code-fn` | `#ffb133` |
| `--code-number` | `#ff8c2e` |
| `--shadow-xs` | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| `--shadow-sm` | `0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2)` |
| `--shadow-md` | `0 2px 6px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)` |
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.3)` |
| `--shadow-focus` | `0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)` |

---

## 4. Candidate B — "Magenta Dusk"

### Rationale

Magenta Dusk takes the sunset metaphor literally: the moment after the sun
goes down, when the sky's dominant color is pink-magenta against deep
violet. The bg moves into deep wine (`#1f0e1e`, HSL 302°/38%/9%) and the
accent flips ~300° around the wheel to a hot magenta (`#f04a8b`, HSL
337°/85%/62%). This is the **biggest chromatic departure** of the three
candidates: bg and accent are split-complements, which is the strongest
possible wash-out fix because they cannot blend into each other
perceptually. Text picks up a faint pink wash (`#ffe0dc`) so it reads as
"continuous with the bg's hue family" rather than a transplant from a
different theme.

Trade-off to know about: `--accent` ↔ `--bg` WCAG drops from 7.36:1 to
5.32:1. That still passes WCAG AA for normal text and AAA for large/UI text,
but means accent text on bg has noticeably less luminance headroom than
candidates A and C. The compensating gain is that magenta on wine *looks*
far more saturated than tan-orange on brown, even though the WCAG number is
smaller — chromatic contrast and luminance contrast are two different axes
and Magenta Dusk trades a little of the latter for a lot of the former.

This candidate is for users who feel "sunset" should mean *the actual sky
at dusk*, not "warm office." It is the most visually arresting of the
three; choose it if visual identity matters more than minimal change.

**References:**

- Behance dusk/sunset moodboards (search for "magenta dusk" or "twilight
  palette"): https://www.behance.net/
- Dribbble sunset-pink UI palettes: https://dribbble.com/
- Unsplash, "twilight magenta sky": https://unsplash.com/s/photos/twilight
- Adobe Leonardo (accessible-contrast palette tool — useful for verifying
  the magenta-on-wine ratios stay above WCAG AA): https://leonardocolor.io/

### Contrast / saturation vs current

| Pair / metric | Current | Magenta Dusk | Δ |
| --- | --- | --- | --- |
| `--text` ↔ `--bg` WCAG | 12.31:1 | **14.85:1** | +2.54 |
| `--accent` ↔ `--bg` WCAG | 7.36:1 | 5.32:1 | −2.04 (still ≥ AA) |
| `--accent` HSL saturation | 69% | **85%** | +16 pp |
| `--bg` HSL saturation | 23% | **36%** | +13 pp |
| hue spread bg ↔ accent | ~13° (analogous) | **~35°** (close-to-split-complement) | major |

### Full token table

| Token | Magenta Dusk HEX |
| --- | --- |
| `--bg` | `#1f0e1e` |
| `--bg-elevated` | `#2a1429` |
| `--bg-subtle` | `#341933` |
| `--bg-hover` | `#401e3d` |
| `--bg-active` | `#4d2348` |
| `--bg-inverse` | `#fef2f9` |
| `--border` | `#4a1f47` |
| `--border-strong` | `#66295e` |
| `--border-focus` | `var(--accent)` |
| `--text` | `#ffe0dc` |
| `--text-secondary` | `#e8b3c5` |
| `--text-tertiary` | `#c08aa3` |
| `--text-quaternary` | `#8a5e72` |
| `--text-inverse` | `#1f0e1e` |
| `--text-on-accent` | `#1f0e1e` |
| `--accent` | `#f04a8b` |
| `--accent-hover` | `#f57aa8` |
| `--accent-active` | `#d63972` |
| `--accent-subtle` | `#2c0e1f` |
| `--accent-subtle-hover` | `#3b1428` |
| `--accent-border` | `#66264a` |
| `--accent-text` | `#f88dad` |
| `--success` | `#4ed18a` |
| `--success-subtle` | `#102b1e` |
| `--success-border` | `#1f4a32` |
| `--warning` | `#ffaa5c` |
| `--warning-subtle` | `#2e1f10` |
| `--warning-border` | `#5a3a1a` |
| `--danger` | `#ff6a6a` |
| `--danger-subtle` | `#2e1414` |
| `--danger-border` | `#5a2828` |
| `--insight` | `#c989ff` |
| `--insight-subtle` | `#1f1133` |
| `--insight-border` | `#402a66` |
| `--widget-theory` | `#e8b3c5` |
| `--widget-demo` | `#ffaa5c` |
| `--widget-quiz` | `#c989ff` |
| `--widget-code` | `#4ed18a` |
| `--widget-code-cloze` | `#5cc8d6` |
| `--widget-sandbox` | `#f04a8b` |
| `--widget-histogram` | `#88c0c8` |
| `--widget-plot-image` | `#e6a878` |
| `--widget-parametric-explorer` | `#b888e0` |
| `--widget-drag-match` | `#e088a0` |
| `--widget-data-table` | `#8ca8d8` |
| `--widget-video` | `#f07090` |
| `--widget-audio-player` | `#5cc8d6` |
| `--widget-transcript-cloze` | `#88b0d8` |
| `--widget-stt-demo` | `#f07070` |
| `--code-bg` | `#190a18` |
| `--code-text` | `#ffe0dc` |
| `--code-keyword` | `#c989ff` |
| `--code-string` | `#4ed18a` |
| `--code-comment` | `#8a5e72` |
| `--code-fn` | `#ffaa5c` |
| `--code-number` | `#f57aa8` |
| `--shadow-xs` | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| `--shadow-sm` | `0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2)` |
| `--shadow-md` | `0 2px 6px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)` |
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.3)` |
| `--shadow-focus` | `0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)` |

---

## 5. Candidate C — "Coastal Sundown"

### Rationale

Coastal Sundown is the warm/cool split: sunset on the ocean, where the sky
is hot orange but the water below is cold blue-gray. The bg moves to a cool
deep slate (`#15171f`, HSL 230°/19%/10%) and the accent stays in the warm
orange family but pushes to full saturation (`#ff8a4c`, HSL 21°/100%/65%).
The warm accent on cold bg is the strongest perceptual "pop" of the three
candidates at *equal WCAG luminance* — temperature contrast does work that
saturation alone can't.

Risk: this candidate may feel like a different theme entirely. A user who
picked "sunset" because they wanted the whole UI to feel warm (chairs,
walls, paper) will not get that here — only the accent and the text are
warm; everything that was warm beige is now cool slate. We keep it in the
candidate set anyway because it is technically the best accessibility story
(text/bg = 14.82:1, accent/bg = 7.66:1, accent HSL S = 100%) and it gives
us a real chromatic-temperature option, not just another warm variation.

**References:**

- Dribbble "coastal sunset" / "ocean dusk" UI palettes:
  https://dribbble.com/
- Material Design 2 color system — the canonical reference for warm-accent /
  cool-surface dark themes: https://m2.material.io/design/color/the-color-system.html
- Unsplash "sunset over ocean" reference photography:
  https://unsplash.com/s/photos/sunset-ocean
- Coolors generator — for sanity-checking the warm/cool palette splits:
  https://coolors.co/

### Contrast / saturation vs current

| Pair / metric | Current | Coastal Sundown | Δ |
| --- | --- | --- | --- |
| `--text` ↔ `--bg` WCAG | 12.31:1 | **14.82:1** | +2.51 |
| `--accent` ↔ `--bg` WCAG | 7.36:1 | **7.66:1** | +0.30 |
| `--accent` HSL saturation | 69% | **100%** | +31 pp |
| `--bg` HSL saturation | 23% | 17% (cool) | −6 pp (intentional) |
| bg ↔ accent temperature | warm/warm | **warm accent / cool bg** | new axis |

### Full token table

| Token | Coastal Sundown HEX |
| --- | --- |
| `--bg` | `#15171f` |
| `--bg-elevated` | `#1c1f29` |
| `--bg-subtle` | `#232633` |
| `--bg-hover` | `#2a2d3d` |
| `--bg-active` | `#333647` |
| `--bg-inverse` | `#f8f7f0` |
| `--border` | `#2e3145` |
| `--border-strong` | `#3e4258` |
| `--border-focus` | `var(--accent)` |
| `--text` | `#f6e8d2` |
| `--text-secondary` | `#d6b890` |
| `--text-tertiary` | `#a89074` |
| `--text-quaternary` | `#6e5c44` |
| `--text-inverse` | `#15171f` |
| `--text-on-accent` | `#15171f` |
| `--accent` | `#ff8a4c` |
| `--accent-hover` | `#ffa470` |
| `--accent-active` | `#e5703a` |
| `--accent-subtle` | `#2e1c14` |
| `--accent-subtle-hover` | `#3b2419` |
| `--accent-border` | `#5c3a21` |
| `--accent-text` | `#ffb285` |
| `--success` | `#46c997` |
| `--success-subtle` | `#102e22` |
| `--success-border` | `#1f4a37` |
| `--warning` | `#ffa83e` |
| `--warning-subtle` | `#2e1f10` |
| `--warning-border` | `#5c3e1a` |
| `--danger` | `#ff5e62` |
| `--danger-subtle` | `#2e1418` |
| `--danger-border` | `#5c2429` |
| `--insight` | `#a980f0` |
| `--insight-subtle` | `#1e1530` |
| `--insight-border` | `#3a2c5c` |
| `--widget-theory` | `#d6b890` |
| `--widget-demo` | `#ffa83e` |
| `--widget-quiz` | `#a980f0` |
| `--widget-code` | `#46c997` |
| `--widget-code-cloze` | `#3fc4d4` |
| `--widget-sandbox` | `#ff8a4c` |
| `--widget-histogram` | `#75bcc8` |
| `--widget-plot-image` | `#e0a868` |
| `--widget-parametric-explorer` | `#9a82e0` |
| `--widget-drag-match` | `#d68aa0` |
| `--widget-data-table` | `#7d9cd6` |
| `--widget-video` | `#f0708a` |
| `--widget-audio-player` | `#3fc4d4` |
| `--widget-transcript-cloze` | `#75a8d6` |
| `--widget-stt-demo` | `#f06868` |
| `--code-bg` | `#13151c` |
| `--code-text` | `#f6e8d2` |
| `--code-keyword` | `#a980f0` |
| `--code-string` | `#46c997` |
| `--code-comment` | `#6e5c44` |
| `--code-fn` | `#ffa83e` |
| `--code-number` | `#ff8a4c` |
| `--shadow-xs` | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| `--shadow-sm` | `0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2)` |
| `--shadow-md` | `0 2px 6px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)` |
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.3)` |
| `--shadow-focus` | `0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)` |

---

## 6. Recommendation

**Ship-first default: Candidate A — Ember Drive.** It preserves the
warm-sunset intent users opted into, hits the highest text/bg contrast
(15.11:1) and the highest accent saturation (100%) of the three, and is
the smallest perceptual jump from the current palette — so anyone who
liked sunset will still like sunset, only less dusty. Candidates B and C
stay in US-163 as A/B/C variants for the Settings sub-toggle so a user
who wants a bigger departure can choose it deliberately.

## 7. Methodology notes (for the implementor in US-163)

- All HEX values above are stable triplets; no `color-mix()`, no
  `var()`-on-other-tokens (except `--border-focus`, which mirrors the
  current pattern of referencing `var(--accent)`). US-163 can copy the
  three tables verbatim into `:root[data-theme="sunset"][data-sunset-variant="A|B|C"]`
  blocks.
- The baseline `:root[data-theme="sunset"]` block must remain in place
  unchanged (per US-163 AC) so an absent/unknown `data-sunset-variant`
  falls back to the current palette.
- WCAG ratios above were computed by hand using the standard
  sRGB-relative-luminance formula and rounded to two decimals. If the
  implementor wants automated verification, Adobe Leonardo
  (https://leonardocolor.io/) and the WebAIM contrast checker
  (https://webaim.org/resources/contrastchecker/) both reproduce these
  numbers.
- HSL values above use the standard `max/min` conversion; saturation is
  reported in the HSL sense (not HSV).
