# Chaperone Design System — MASTER

**Version 1.0 · 19 Nov 2026 · Owner: product design · Implementer: web engineer**

Two files form this system:

| File | Role |
|---|---|
| `design-system/chaperone/MASTER.md` | This spec. Principles, tokens tables, component anatomy, states, a11y rules. |
| `design-system/chaperone/tokens.css` | Copy-pasteable `:root` tokens + Google Fonts `@import` + base resets + reduced-motion block. Replace the `:root` and base sections of `web/style.css` with it, then build components below on top. |

**Who this is for.** Mei Tan, non-technical owner of Lumen Studio. She opens Chaperone once each morning and must answer, in seconds: *what did my agents do, what was stopped, what needs my yes/no, did anyone state a false figure.* Every rule below serves that scan.

**Ground rules for the engineer.** Reuse the existing DOM ids/classes from `web/index.html` (mapping table in §12). Do not invent new hues, sizes or shadows outside these tokens. If a value is not in this document, stop and ask — do not guess.

---

## 1. Design principles

1. **Money and risk first.** The most consequential number on screen (SGD at stake, actions stopped) is the largest, highest-contrast thing in its region. Greetings and chrome never outrank a decision.
2. **Plain words in the reading path; rule IDs in details.** Mei reads "Stopped — client list is regulated". `R01`, `R15`, scope-creep dumps and injection traces live only inside collapsed `<details>` disclosures.
3. **Never colour alone.** Every status is colour **+ icon + text label**, always. A status that is only a dot, only a tint, or only a red word is a defect (High severity).
4. **One decision per glance.** Each screen has exactly one primary CTA. Each approval card presents exactly two choices (Approve / Say no) and, once decided, becomes visually historical and non-interactive.
5. **Evidence is a quotation, not a claim.** Every decision can be opened to show the exact file path (monospace), line number, and the quoted source line. If it can't be traced to a file, it doesn't ship.
6. **Calm, flat, governmental.** This is a trust tool: white cards on a cool grey field, hairline borders, two elevation levels max, no gradients, no glass, no decorative colour, no motion that doesn't explain state.
7. **Accessible by default.** 4.5:1 minimum for all text (computed, not asserted), 3px visible focus rings, 44px targets, full keyboard operation, one atomic live region, `prefers-reduced-motion` honoured everywhere.

---

## 2. Fonts

### 2.1 Loading

Put in `web/index.html` `<head>` (preferred — preconnect avoids the `@import` round-trip):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

`tokens.css` already contains the equivalent `@import` as first line — keep exactly one of the two mechanisms, never both. If the `@import` is kept, the `<link rel="preconnect">` tags should still be added.

### 2.2 Roles

| Token | Family | Used for |
|---|---|---|
| `--font-heading` | **Lexend** (400/500/600/700) | All headings h1–h3, brand wordmark, stat numbers, button labels, empty-state titles. Lexend is designed for reading proficiency — the whole point of this app. |
| `--font-body` | **Source Sans 3** (400/500/600/700, italic 400) | All body copy, table text, disclosures, form text. |
| `--font-mono` | **JetBrains Mono** (400/500/700) | **Timestamps, file paths, SGD amounts, rule IDs, counts, scenario IDs** — anything that must align vertically when scanned. This is non-negotiable; proportional numerals in the log were the biggest scanning failure of the old UI. |

**The editorial serif is retired.** No serif anywhere. Iowan/Palatino/Georgia are removed from the stack entirely.

### 2.3 Modular type scale (root = 16px)

| Token | px | rem | Weight | Line-height | Letter-spacing | Use |
|---|---|---|---|---|---|---|
| `--text-xs` | 12 | 0.75 | 500 | `--leading-snug` (1.4) | `--tracking-wide` | Meta labels ("AGENT", "SCENARIO"), badge numerals, fine print, rule-ID lines |
| `--text-sm` | 14 | 0.875 | 400/600 | `--leading-snug` | normal | Pills, table cells, secondary text, timestamps |
| `--text-base` | 16 | 1 | 400 | `--leading-body` (1.5) | normal | Body copy, log action text, buttons, inputs. **16px minimum everywhere** — nothing interactive or informational is smaller than 12px and nothing meant to be read is smaller than 14px |
| `--text-md` | 18 | 1.125 | 600 | `--leading-snug` | normal | Card titles (`.card-title`, `.fact-title`), h3 |
| `--text-lg` | 24 | 1.5 | 600 | `--leading-heading` (1.25) | `--tracking-tight` | Section h2, empty-state titles |
| `--text-xl` | 32 | 2 | 600 | `--leading-tight` (1.15) | `--tracking-tight` | Page h1, briefing headline |
| `--text-metric` | 40 | 2.5 | 600 | `--leading-tight` | `--tracking-tight` | Stat-card hero numbers (Lexend, `tabular-nums`) |

No size outside this scale may appear. The old `html { font-size: 18px }` root and the 17px mobile root are **removed** — root is 16px at every breakpoint; responsiveness comes from layout, not from rescaling type.

### 2.4 Numerals & formatting rules

- `font-variant-numeric: tabular-nums` is set on `body` (tokens.css) and repeated on `.u-mono`, `time`, `pre` — all amounts, counts and timestamps align in columns.
- **Money:** `SGD 10,260` — currency code prefix, thousands separators, no decimals unless non-integer (then exactly 2). Rendered in `--font-mono`, weight 500. In approval cards the amount is right-aligned in its own grid column so amounts stack and compare vertically.
- **Counts:** thousands separators (`10,260` never `10260`).
- **Time:** 24-hour `HH:MM:SS` (`new Date(ts).toLocaleTimeString('en-GB', { hour12: false })`), `--font-mono`, so the seconds column aligns in the log.
- **Prose measure:** paragraphs, `.sub`, `.lead`, evidence quotes and empty-state body text cap at `max-width: var(--measure)` (70ch). Headings cap at 46ch.

---

## 3. Colour system

### 3.1 Core palette (Government/Public-Service high-contrast direction)

| Token | Hex | Purpose | Key contrast (computed) |
|---|---|---|---|
| `--color-bg` | `#F8FAFC` | Page background | — |
| `--color-surface` | `#FFFFFF` | Cards, header, rows, inputs | — |
| `--color-surface-sunken` | `#E8ECF1` | Recessed fills: neutral chips, code chips, hover wash, disabled button fill | ink on it = **15.05:1**; muted-fg on it = **6.39:1** |
| `--color-border` | `#E2E8F0` | Hairline borders on cards/rows/tables (decorative — never a sole indicator) | — |
| `--color-border-strong` | `#94A3B8` | 1.5px borders on interactive outlined controls | — |
| `--color-ink` | `#0F172A` | Primary text & headings; primary button fill | **17.06:1** on bg · **17.85:1** on white |
| `--color-ink-secondary` | `#334155` | Secondary text; primary-button hover fill | **9.90:1** on bg · **10.35:1** on white |
| `--color-ink-muted` | `#475569` | Tertiary/meta text (timestamps, captions) | **7.24:1** on bg · **7.58:1** on white |
| `--color-inverse` | `#FFFFFF` | Text on dark fills | 17.85:1 on `--color-primary` |
| `--color-accent` | `#0369A1` | Links, active-tab indicator, focus ring, progress strip accents | **5.93:1** on white · **5.67:1** on bg · 5.67:1 vs white as UI shape (≥3:1 ✓) |
| `--color-accent-strong` | `#075985` | Accent hover; text on accent tint | 6.55:1 on `--color-accent-tint` |
| `--color-accent-tint` | `#E1F1FC` | Progress-strip fill, selected-filter wash | — |
| `--color-primary` | `#0F172A` | Primary button fill | white on it = **17.85:1** |
| `--color-primary-hover` | `#1E293B` | Primary hover | white on it > 15:1 (darker than slate) |
| `--color-primary-active` | `#0B1120` | Primary press | — |
| `--color-destructive` | `#DC2626` | Destructive **text/icons on white only** (never as a fill behind white text at small sizes) | **4.83:1** on white |
| `--color-destructive-strong` | `#B42318` | Danger outlined-button text/border; danger solid fill | **6.57:1** on white · white on it = **6.57:1** |
| `--color-destructive-hover` | `#931B12` | Danger solid hover | higher than 6.57:1 (darker) |
| `--color-badge-amber` | `#F2B544` | Approvals count-badge fill only | ink on it = **9.75:1** |

The old palette (`--pine`, `--ground` beige, muddy gold `--wait-mark`, rust `--stop`, ochre recommendation text) is **fully retired**. Every colour above has exactly one job; there are no decorative colours.

### 3.2 Semantic status scale

Six statuses. Each is a triple (fg / tint / border) **plus a mandatory icon and text label**. All ratios computed with the WCAG 2.1 luminance formula:

| # | Status | Class | Label (exact copy) | Icon (§8) | FG | BG tint | Border | **FG-on-tint** | FG-on-white |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Allowed / done | `.pill-status-done` | "Done" | `#i-done` | `#146C33` | `#E9F7EE` | `#A9D9B8` | **5.90:1** ✓ | 6.52:1 |
| 2 | Waiting for owner | `.pill-status-waiting` | "Waiting for you" | `#i-wait` | `#8A5300` | `#FDF1D7` | `#E8C988` | **5.65:1** ✓ | 6.33:1 |
| 3 | Held / needs a look | `.pill-status-held` | "Needs a look" | `#i-eye` | `#075985` | `#E1F1FC` | `#9CC9E8` | **6.55:1** ✓ | 8.06:1 |
| 4 | Blocked / stopped | `.pill-status-blocked` | "Stopped" | `#i-stop` | `#B42318` | `#FBEAE7` | `#EDA69C` | **5.64:1** ✓ | 6.57:1 |
| 5 | Fabricated fact | `.pill-status-fabricated` | "Figure not on file" | `#i-cross-circle` | `#9D174D` | `#FCE8F1` | `#EBAAC8` | **6.74:1** ✓ | 7.88:1 |
| 6 | Regulated data | `.pill-status-regulated` | "Regulated data" | `#i-lock` | `#3730A3` | `#E7E8FB` | `#ABAFE3` | **8.20:1** ✓ | 9.93:1 |

All ≥ 4.5:1 (WCAG AA normal text). Tint backgrounds behind **body** text always use `--color-ink` (≥ 15:1 on every tint — computed: 16.16 / 15.93 / 15.32 on done / waiting / blocked tints).

**Solid-button variants** (only two exist): Approve = `--color-status-done-solid` `#146C33` (white on it = **6.52:1**), danger-solid = `--color-status-blocked-solid` `#B42318` (white on it = **6.57:1**).

### 3.3 File-sensitivity levels (lineage ladder)

Levels deliberately reuse status hues so one colour never means two things:

| Level | Class | FG | BG | FG-on-white |
|---|---|---|---|---|
| Public | `.pill-level-public` | `#3F7A52` | `#E9F7EE` | **5.10:1** ✓ |
| Studio only (internal) | `.pill-level-internal` | `#0369A1` | `#E1F1FC` | **5.93:1** ✓ |
| Client confidential | `.pill-level-confidential` | `#8A5300` | `#FDF1D7` | **6.33:1** ✓ |
| Personal or regulated | `.pill-level-regulated` | `#3730A3` | `#E7E8FB` | **9.93:1** ✓ |

The ladder meters (`.meter i`) fill with the level FG colour; unfilled segments are `--color-border`. The ladder always shows the level **word** next to the meter (colour+shape+text again).

### 3.4 Colourblind safety (why icon+label is mandatory)

Under **deuteranopia** (the most common form, ~6% of males), the green "Done" (`#146C33`) and the amber "Waiting" (`#8A5300`) collapse toward the same muddy yellow-brown, and green vs red is the classic failure pair — "Done" and "Stopped" pills become indistinguishable by hue. Under tritanopia, blue and indigo converge. **Hue is therefore never the carrier of meaning.** The carrier is the *icon shape* (circle-check vs circle-pause vs octagon vs eye vs circle-cross vs padlock — all geometrically distinct at 16px) *plus the text label*. The tint and border are redundant reinforcement for sighted scanning only. Any future status added to this system must ship with a distinct silhouette, not just a distinct hue. The pill border tints sit at 1.58–2.11:1 against white — below the 3:1 UI threshold — which is acceptable **only because** the border is decorative; the text and icon inside always pass.

---

## 4. Spacing, layout & surfaces

### 4.1 Spacing scale

`--space-2xs` 2 · `--space-xs` 4 · `--space-sm` 8 · `--space-md` 12 · `--space-base` 16 · `--space-lg` 24 · `--space-xl` 32 · `--space-2xl` 48 · `--space-3xl` 64. **No value outside this scale** in margins, paddings or gaps.

### 4.2 Page frame

- Container: `max-width: var(--container-max)` (1240px), centred, side padding `--gutter` (32px) / `--gutter-sm` (16px) below 768px.
- Main vertical rhythm: sections separated by `--space-2xl` (48px); blocks inside a section by `--space-lg` (24px); stacked cards/rows by `--space-base` (16px).
- `html { scroll-padding-top: 170px }` (sticky header). Below 900px the header un-sticks (`position: static`) and scroll-padding drops to 16px.

### 4.3 Card anatomy (`.card`, `.block` panels, `.fact`, `.chain`)

| Property | Value |
|---|---|
| Background | `--color-surface` |
| Border | `1px solid var(--color-border)` |
| Radius | `--radius-lg` (14px) |
| Padding | `--space-lg` (24px) all round; 16px below 768px |
| Elevation | `--elevation-1` (`0 1px 2px rgba(15,23,42,.06)`) |
| Internal gaps | `--space-md`/`--space-base` |

**Two elevations exist, period:** `--elevation-1` for cards/row containers; `--elevation-2` (`0 4px 12px rgba(15,23,42,.10)`) for the sticky header and toasts. Nothing else casts a shadow. No blur, no inner glow, no layered "hero" shadows.

### 4.4 Breakpoints — 375 / 768 / 1024 / 1440

| Width | What changes |
|---|---|
| **≥ 1440** | Container stays 1240px and centres — content does **not** stretch further (line length discipline). Nothing else changes; no type upscaling. |
| **1024–1439** | Default desktop layout. Today = 2-col grid `minmax(0,1fr) var(--sidebar-width)` (380px side). Log row = full 5-column grid. Lineage chain = horizontal 3-node grid. Gutter 32px. |
| **768–1023** | Today collapses to 1 column: `.col-main` first, `.col-side` below it as a 2-column grid (video + agents side by side). Lineage chain stacks vertically (`.link-step .ic.h` hidden, `.ic.v` shown). Scorecard table stays a table. Tabs keep long labels, horizontally scrollable (`overflow-x: auto`, no wrapping). Levels grid 2×2. |
| **375–767** | Gutter 16px. Tabs become a 3×2 grid of short-label buttons (`.long` hidden, `.short` shown; active = navy fill + white text instead of underline). Log row re-flows to 2 lines (§6.6). Approval card: stake moves above title, left-aligned; action buttons go full-width stacked. Fact-check row stacks (claimed → arrow → real). Scorecard table becomes a card list (`td::before` labels). Legend stacks to 1 column. All primary controls ≥ 44px tall, full-width where stacked. |

The old breakpoints (1100/900/720) are replaced by these four.

---

## 5. Iconography

### 5.1 Sprite rules

- One inline `<svg>` sprite at top of `<body>` (already exists in `index.html` lines 17–29 — keep the mechanism).
- **One stroke width: 2px on a 24×24 viewBox**, `fill="none"`, `stroke="currentColor"`, round caps/joins. (The two legacy 1.8px symbols `#i-file` and `#i-mail` are redrawn at 2px — see §5.3.)
- Icons inherit `color` from their context (pill fg, button label colour). They are never given a colour of their own.
- Decorative icons: `aria-hidden="true"` (+ `focusable="false"` on the sprite root). An icon is *never* the only carrier of meaning (§3.4).
- Sizing: 16px inside pills, 20px inside buttons/rows, 24px in legends/empty states — always `flex: none`, aligned with flexbox (`align-items: center`), **never** with `vertical-align` hacks (that was the cause of the misaligned play icon).
- **No emoji, ever.** The scorecard's `✓`/`✗` text glyphs are replaced with sprite icons + "Pass"/"Fail" words.

### 5.2 Status icon map (exact)

| Status | Symbol id | Silhouette | Exists? |
|---|---|---|---|
| Done | `#i-done` | circle + check | yes — keep |
| Waiting for you | `#i-wait` | circle + two pause bars | yes — keep |
| Needs a look | `#i-eye` | eye | **new** |
| Stopped | `#i-stop` | octagon + minus bar | yes — keep |
| Figure not on file | `#i-cross-circle` | circle + X | **new** |
| Regulated data | `#i-lock` | padlock | **new** |
| Pass (scorecard) | `#i-done` | circle + check | reuse |
| Fail (scorecard) | `#i-cross` | bare X | yes — keep |
| Disclosure marker | `#i-chev` | chevron right, rotates 90° on open | yes — keep |
| File reference | `#i-file` | document | yes — redraw at 2px |
| Run demo | `#i-play` | filled triangle (only filled icon; reads as "play" universally) | yes — keep |
| Links/arrows | `#i-arrow`, `#i-down`, `#i-mail` | as-is (`#i-mail` redraw at 2px) | yes |

### 5.3 New symbols — exact markup to append to the sprite

```html
<symbol id="i-eye" viewBox="0 0 24 24">
  <path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
</symbol>
<symbol id="i-cross-circle" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M9 9l6 6M15 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</symbol>
<symbol id="i-lock" viewBox="0 0 24 24">
  <rect x="5.25" y="10.5" width="13.5" height="9.75" rx="2"
        fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M8.5 10.5V7.9a3.5 3.5 0 0 1 7 0v2.6"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</symbol>
```

Redraws at 2px stroke: `#i-file` (`stroke-width="2"` on both paths), `#i-mail` (`stroke-width="2"` on rect and flap).

---

## 6. Component specifications

All CSS below uses tokens from `tokens.css` exclusively. Class names match `web/index.html` where they exist; renames are flagged and listed in §12.

### 6.1 App header + brand mark

**Purpose.** Persistent identity + the single global primary CTA ("Run the demo") + section tabs + demo progress. Sticky so the CTA and Approvals badge are always one click away.

**Anatomy** (existing DOM): `header.top > .top-inner > (.brand > svg.mark + .brand-text > .name/.who) + (.top-actions > button#runDemo.btn.btn-primary.run + #demoStatus.sr-only)`, then `nav.tabs`, then `#progress`.

```css
.top {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--elevation-2);
  position: sticky; top: 0; z-index: var(--z-header);
}
.top-inner {
  max-width: var(--container-max); margin: 0 auto;
  padding: var(--space-md) var(--gutter);
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-base);
}
.brand { display: flex; align-items: center; gap: var(--space-md); min-width: 0; }
.mark { width: 40px; height: 40px; color: var(--color-primary); flex: none; }
.brand .name {
  font-family: var(--font-heading); font-size: var(--text-md); font-weight: var(--font-semibold);
  line-height: var(--leading-snug); letter-spacing: var(--tracking-normal); color: var(--color-ink);
}
.brand .who { font-size: var(--text-sm); color: var(--color-ink-muted); }
```

**Brand mark recolour:** the shield SVG keeps its geometry; `fill` becomes `currentColor` resolving to `--color-primary` (navy `#0F172A`) instead of pine green. Update `<meta name="theme-color">` to `#F8FAFC` and recolour the inline favicon rect to `#0F172A`.

**Progress strip** (`#progress`, visible only during a demo run):

```css
.progress { background: var(--color-accent-tint); border-top: 1px solid var(--color-accent); }
.progress-text { color: var(--color-accent-strong); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.pulse { width: 10px; height: 10px; border-radius: var(--radius-pill); background: var(--color-accent);
         animation: pulse 1.4s var(--ease-standard) infinite; }
.segs li { width: 26px; height: 8px; border-radius: var(--radius-sm); background: var(--color-border); }
.segs li.run, .segs li.ok { background: var(--color-accent); }
.segs li.part { background: var(--color-badge-amber); }
```

`#progress` keeps `role="status"` **but** its text is only rewritten at phase boundaries (start / each scenario / finish) — see §9 live-region rules; per-event announcements go through `#announcer` alone.

**A11y.** Skip link (`.skip`) is the first focusable element: navy fill, white text, appears at `top: 12px` on focus. `#runDemo` is a real `<button>` with `aria-busy="true"` while running (spinner replaces the play icon; spinner is `aria-hidden`). Header must not trap focus; tabs are in the natural order brand → run → tabs.

### 6.2 Tab bar

**Purpose.** Switch the six sections. Existing DOM: `nav.tabs > .tabs-inner#tabs[role="tablist"] > button[role="tab"]#tabbtn-*`, panels `section.tab#tab-*[role="tabpanel"]`.

```css
.tabs-inner { display: flex; gap: var(--space-xs); max-width: var(--container-max);
              margin: 0 auto; padding: 0 var(--gutter); }
.tabs button {
  position: relative; display: inline-flex; align-items: center; gap: var(--space-sm);
  min-height: var(--target-min); padding: var(--space-md) var(--space-base);
  border: 0; background: none; cursor: pointer; white-space: nowrap;
  font-family: var(--font-body); font-size: var(--text-base); font-weight: var(--font-medium);
  color: var(--color-ink-secondary); border-radius: var(--radius-md) var(--radius-md) 0 0;
  transition: color var(--duration-fast) var(--ease-standard),
              background-color var(--duration-fast) var(--ease-standard);
}
.tabs button:hover { color: var(--color-ink); background: var(--color-bg); }
.tabs button[aria-selected="true"] { color: var(--color-ink); font-weight: var(--font-semibold); }
.tabs button::after {           /* active indicator */
  content: ""; position: absolute; left: var(--space-base); right: var(--space-base);
  bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: var(--color-accent);
  transform: scaleX(0); transition: transform var(--duration-base) var(--ease-out);
}
.tabs button[aria-selected="true"]::after { transform: scaleX(1); }
```

**Count badges.** `#logCount` (neutral): bg `--color-surface-sunken`, text `--color-ink-secondary`, `--font-mono` 12px/700, min 24×24px, `--radius-pill`. `#queueBadge` (action-needed): bg `--color-badge-amber`, text `--color-ink` (9.75:1), same metrics. Both hidden via `.hidden` at zero; the tab label additionally carries the count for screen readers: `aria-label="Approvals, 3 waiting"` updated by JS whenever the badge changes (the visual badge itself is `aria-hidden="true"` — no double announcement).

**Keyboard (currently missing — must implement).** Roving tabindex per APG tabs pattern: `←/→` move focus and activate (activation follows focus); `Home/End` jump to first/last; only the selected tab is in the tab sequence (`tabindex="0"`, others `-1`); `↑/↓` do nothing. Selecting a tab moves DOM focus **no further** — the panel (`tabindex="-1"`) is not auto-focused; screen-reader users get the panel via its `aria-labelledby`. `.active` class is kept in sync with `aria-selected` for CSS, but `aria-selected` is the source of truth.

**States.** default / hover (above) / active-selected (indicator + semibold) / focus-visible (3px ring, `outline-offset: -3px` inside the bar so the ring isn't clipped) / disabled: none — tabs are never disabled.

**Mobile (< 768px).** `display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-xs);` short labels only; selected = `background: var(--color-primary); color: var(--color-inverse); border-radius: var(--radius-md);` underline indicator hidden; badges invert (`background: rgba(255,255,255,.2); color: #fff` — text remains ≥ 4.5:1 because it is white on navy).

### 6.3 Buttons

Three variants + sizes. All: `min-height: 44px` (`--target-min`), `--radius-md` (10px — deliberately *not* pill-shaped, so buttons never confuse with status pills), label `--text-base`/600 `--font-body`, icon 20px flex-aligned, `gap: var(--space-sm)`, `padding: var(--space-md) var(--space-lg)`, `cursor: pointer`, `transition: background-color/border-color/color var(--duration-fast) var(--ease-standard), transform var(--duration-fast)`.

```css
.btn { display: inline-flex; align-items: center; justify-content: center;
       gap: var(--space-sm); min-height: var(--target-min);
       padding: var(--space-md) var(--space-lg); border-radius: var(--radius-md);
       border: var(--border-w-strong) solid transparent;
       font-family: var(--font-body); font-size: var(--text-base); font-weight: var(--font-semibold);
       line-height: 1.2; text-decoration: none; cursor: pointer;
       transition: background-color var(--duration-fast) var(--ease-standard),
                   border-color var(--duration-fast) var(--ease-standard),
                   color var(--duration-fast) var(--ease-standard),
                   transform var(--duration-fast) var(--ease-standard); }
.btn .ic { width: 20px; height: 20px; flex: none; }            /* fixes the misaligned play icon */
.btn:active:not(:disabled) { transform: translateY(1px); }

.btn-primary { background: var(--color-primary); color: var(--color-inverse); }
.btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); }
.btn-primary:active:not(:disabled) { background: var(--color-primary-active); }

.btn-secondary { background: var(--color-surface); color: var(--color-ink);
                 border-color: var(--color-border-strong); }
.btn-secondary:hover:not(:disabled) { background: var(--color-surface-sunken);
                                      border-color: var(--color-ink-muted); }

.btn-danger { background: var(--color-surface); color: var(--color-destructive-strong);
              border-color: var(--color-destructive-strong); }
.btn-danger:hover:not(:disabled) { background: var(--color-status-blocked-bg); }

.btn-approve { background: var(--color-status-done-solid); color: var(--color-inverse); }
.btn-approve:hover:not(:disabled) { background: var(--color-status-done-solid-hover); }

.btn-lg { min-height: 52px; padding: var(--space-base) var(--space-xl); }

.btn:disabled { cursor: default; background: var(--color-surface-sunken);
                color: var(--color-ink-muted); border-color: var(--color-border); }
                /* #475569 on #E8ECF1 = 6.39:1 — disabled state still legible */
```

- `.btn-quiet` is **renamed** `.btn-secondary` (same role, new name — §12).
- `.btn-approve` is a scoped primary (green solid, white on `#146C33` = 6.52:1) used **only** on approval cards.
- **One primary per view:** header `#runDemo` is the only `.btn-primary` on any screen. The Today intro CTA (`[data-run]` inside `#todayIntro`) and empty-state CTAs render as `.btn-secondary` with the same `data-run` behaviour. (Fixes the two-competing-CTAs defect.)
- Link-button `.link` (e.g. "All approvals →"): accent-coloured, underlined on hover, **min-height 44px via padding** (`padding: 12px 0`), `font-weight: 600`, `color: var(--color-accent)` (5.93:1).
- **A11y:** real `<button type="button">` elements only; never a styled `<div>`/`<a href="#">`. Focus ring per tokens. `aria-busy` on the running demo button. Destructive confirmations use the undo-toast pattern (§6.13), not `window.alert`/`window.confirm` — the two `alert()` calls in `app.js` (queue decide failure, demo already running) are replaced by error toasts.

### 6.4 Status pill — the core reusable component

**Purpose.** One component carries every status in the app: decisions in the log, queue states, fact-check verdicts, sensitivity levels, scorecard pass/fail. Colour + icon + label always together.

**Anatomy.** `<span class="pill pill-status-blocked"><svg class="ic" aria-hidden="true"><use href="#i-stop"/></svg>Stopped</span>`

```css
.pill {
  display: inline-flex; align-items: center; gap: var(--space-xs);
  min-height: 24px; padding: var(--space-2xs) var(--space-md);
  border-radius: var(--radius-pill); border: 1px solid;
  font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: var(--leading-snug);
  white-space: nowrap;
}
.pill .ic { width: 16px; height: 16px; flex: none; }

.pill-status-done       { color: var(--color-status-done-fg);       background: var(--color-status-done-bg);       border-color: var(--color-status-done-border); }
.pill-status-waiting    { color: var(--color-status-waiting-fg);    background: var(--color-status-waiting-bg);    border-color: var(--color-status-waiting-border); }
.pill-status-held       { color: var(--color-status-held-fg);       background: var(--color-status-held-bg);       border-color: var(--color-status-held-border); }
.pill-status-blocked    { color: var(--color-status-blocked-fg);    background: var(--color-status-blocked-bg);    border-color: var(--color-status-blocked-border); }
.pill-status-fabricated { color: var(--color-status-fabricated-fg); background: var(--color-status-fabricated-bg); border-color: var(--color-status-fabricated-border); }
.pill-status-regulated  { color: var(--color-status-regulated-fg);  background: var(--color-status-regulated-bg);  border-color: var(--color-status-regulated-border); }

.pill-level-public       { color: var(--color-level-public);       background: var(--color-level-public-bg);       border-color: var(--color-status-done-border); }
.pill-level-internal     { color: var(--color-level-internal);     background: var(--color-level-internal-bg);     border-color: var(--color-status-held-border); }
.pill-level-confidential { color: var(--color-level-confidential); background: var(--color-level-confidential-bg); border-color: var(--color-status-waiting-border); }
.pill-level-regulated    { color: var(--color-level-regulated);    background: var(--color-level-regulated-bg);    border-color: var(--color-status-regulated-border); }

/* neutral pills: agent name, scenario id */
.pill-agent    { color: var(--color-ink-secondary); background: var(--color-surface-sunken);
                 border-color: var(--color-border); font-weight: var(--font-medium); }
.pill-scenario { color: var(--color-ink-muted); background: var(--color-surface);
                 border-color: var(--color-border); font-family: var(--font-mono);
                 font-size: var(--text-xs); font-weight: var(--font-medium); }
```

**Decision → pill map (JS):** `ALLOW` → `pill-status-done` "Done"; `HOLD_FOR_APPROVAL` → `pill-status-waiting` "Waiting for you"; `BLOCK` → `pill-status-blocked` "Stopped"; a log entry whose `fact_check` contains `status !== 'ok'` additionally gets `pill-status-fabricated` "Figure not on file"; `data_level === 'regulated'` additionally gets `pill-status-regulated` "Regulated data". A row may show at most: decision pill + one qualifier pill + level pill + agent pill + scenario pill, in that order.

**Scenario chip fix:** the bare "S1"/"S2" strings become `<span class="pill pill-scenario" title="Demo scenario S1 — see Scorecard"><span class="sr-only">Scenario </span>S1</span>` — visually "S1" in mono with an sr-only "Scenario" prefix and a tooltip; the Live-log `.sub` sentence mentions that rows are tagged with their demo-scenario id. No more orphan badges that look like typos.

**States.** Pills are non-interactive (no hover/active). If a pill is ever made clickable it must grow to 44px and gain a focus ring — none are in this app.

**A11y.** The label text *is* the accessible name; icon `aria-hidden`. Never render the icon-only variant, at any breakpoint. On mobile the label may shorten ("Waiting" for "Waiting for you") via a second `<span class="short">` + CSS, keeping the full label in `sr-only`.

### 6.5 Metric / stat card

**Purpose.** The morning glance: how many stopped, how many waiting (and how much money), how many done, how many to know about.

**Anatomy.** `<div class="stat stat-blocked"><span class="stat-ic">…#i-stop…</span><span class="stat-n">6</span><span class="stat-l">risky actions stopped</span></div>` inside `.figures` (a flex/grid row). Used in `#scoreStats` and in the Today stats row the engineer adds at the top of `#todayBody` (id `#statrow`, class `figures` — see §12; `app.js` already renders `#statrow` with `.stat .n/.l` markup).

```css
.figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
           gap: var(--space-base); margin-bottom: var(--space-xl); }
.stat {
  display: grid; grid-template-columns: auto minmax(0,1fr); grid-template-rows: auto auto;
  gap: var(--space-xs) var(--space-md); align-items: center;
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); box-shadow: var(--elevation-1);
  padding: var(--space-base) var(--space-lg); min-height: 96px;
}
.stat-ic { grid-row: 1 / span 2; width: 40px; height: 40px; border-radius: var(--radius-pill);
           display: flex; align-items: center; justify-content: center; }
.stat-ic .ic { width: 20px; height: 20px; }
.stat-n { font-family: var(--font-heading); font-size: var(--text-metric); font-weight: var(--font-semibold);
          line-height: var(--leading-tight); letter-spacing: var(--tracking-tight);
          font-variant-numeric: tabular-nums; color: var(--color-ink); }
.stat-l { font-size: var(--text-sm); color: var(--color-ink-secondary); line-height: var(--leading-snug); }

.stat-blocked .stat-ic { background: var(--color-status-blocked-bg);  color: var(--color-status-blocked-fg); }
.stat-waiting .stat-ic { background: var(--color-status-waiting-bg);  color: var(--color-status-waiting-fg); }
.stat-done    .stat-ic { background: var(--color-status-done-bg);     color: var(--color-status-done-fg); }
.stat-held    .stat-ic { background: var(--color-status-held-bg);     color: var(--color-status-held-fg); }
```

Rules: the number is Lexend (hero display) with `tabular-nums`; **inline** counts elsewhere (badges, tables, lane counts) are JetBrains Mono. Money inside `.stat-l` renders as `· SGD 12,400` in `--font-mono`. All four cards are **equal width** (`repeat(4, 1fr)`) with tops aligned by the grid — fixes the uneven trio defect. Order is fixed: **Stopped → Waiting → Done → Needs a look** (risk first). At < 768px: `grid-template-columns: repeat(2, 1fr)`; at 375px keep 2×2 (cards are compact enough) — never a 1-column stack of four.

**A11y.** Each card is plain text in DOM order (icon aria-hidden); the whole row is summarised once by `#announcer` after the briefing arrives (§9) — cards themselves are not live regions.

### 6.6 Log row

**Purpose.** The Live log's unit: one gated action, scannable in vertical columns, expandable to evidence. Fixes the "wall of monochrome text" defect.

**Anatomy** — a `<details class="row d-BLOCK">` (decision class kept for the arrival flash):

```html
<details class="row d-BLOCK" id="log-17">
  <summary>
    <time class="row-time" datetime="2026-11-19T09:14:02">09:14:02</time>
    <span class="pill pill-agent">Marketing</span>
    <span class="row-action">
      <span class="row-text">Tried to upload the client list to sparkmail.example</span>
      <span class="row-files u-mono">admin/client_list.csv</span>
    </span>
    <span class="row-status">
      <span class="pill pill-status-blocked"><svg class="ic" aria-hidden="true"><use href="#i-stop"/></svg>Stopped</span>
      <span class="pill pill-level-regulated">…Regulated data</span>  <!-- only when applicable -->
    </span>
    <span class="pill pill-scenario" title="Demo scenario S1"><span class="sr-only">Scenario </span>S1</span>
    <svg class="ic chev" aria-hidden="true"><use href="#i-chev"/></svg>
  </summary>
  <div class="row-body"> …evidence quote blocks (§6.7), notes, .tech details with rule IDs… </div>
</details>
```

```css
.rows { background: var(--color-surface); border: 1px solid var(--color-border);
        border-radius: var(--radius-lg); box-shadow: var(--elevation-1); overflow: hidden; }
.row + .row { border-top: 1px solid var(--color-border); }
.row > summary {
  display: grid; align-items: center; gap: var(--space-md);
  grid-template-columns: 5.5rem 7.5rem minmax(0,1fr) auto 4.5rem 1.25rem; /* time|agent|action|status|scenario|chev */
  padding: var(--space-md) var(--space-lg); min-height: var(--target-min);
  list-style: none; cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);
}
.row > summary::-webkit-details-marker { display: none; }
.row > summary:hover { background: var(--color-bg); }
.row[open] > summary { background: var(--color-bg); }
.row-time { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--color-ink-muted);
            font-variant-numeric: tabular-nums; }
.row-text { display: block; font-size: var(--text-base); color: var(--color-ink); overflow-wrap: anywhere; }
.row-files { display: block; font-size: var(--text-xs); color: var(--color-ink-muted);
             margin-top: var(--space-2xs); overflow-wrap: anywhere; }
.row-status { display: flex; gap: var(--space-xs); flex-wrap: wrap; justify-content: flex-start; }
.row .chev { width: 20px; height: 20px; color: var(--color-ink-muted);
             transition: transform var(--duration-base) var(--ease-out); }
.row[open] > summary .chev { transform: rotate(90deg); }
.row-body { padding: var(--space-xs) var(--space-lg) var(--space-lg) calc(var(--space-lg) + 5.5rem + var(--space-md));
            background: var(--color-bg); border-top: 1px solid var(--color-border); }
```

- **Vertical scanning:** time, files, scenario are mono + tabular, in fixed columns — the eye gets a clean left edge.
- **Summary vs details:** summary = 16px ink action text; everything else (owner line, rules `R01, R15`, scope-creep list, injection trace) goes in `.row-body` at `--text-sm`, with rule IDs in a `.tech` line (`--text-xs`, `--font-mono`, `--color-ink-muted`).
- **Disclosure affordance:** the whole summary row is the click target (min-height 44px), hover wash + rotating chevron + `[open]` background give three state cues. `summary:focus-visible` uses `outline-offset: -3px` (ring inside, not clipped by `.rows` overflow).
- **Arrival:** a newly streamed row gets `.fresh` → `animation: arrive var(--duration-slow) var(--ease-out)` (opacity 0→1, translateY(-8px)→0) plus a one-shot `flash` of its decision tint behind the summary (`--flash: var(--color-status-blocked-bg)` etc., `var(--duration-flash)`, ease-out, to transparent).
- **Mobile (< 768px):** `grid-template-columns: auto minmax(0,1fr) 1.25rem; grid-template-areas: "time status chev" "agent agent chev" "action action chev";` — time + pills on line 1, agent line 2, action line 3; scenario pill moves next to the time; `.row-body` left padding collapses to `--space-lg`.
- **A11y.** `<details>/<summary>` gives free keyboard + screen-reader disclosure semantics; summary's accessible name is the concatenation of its text (time, agent, action, status labels, scenario) — meaningful without the chevron. Never put interactive elements inside `<summary>`. Row container `#logList` is **not** a live region; arrivals are announced in aggregate via `#announcer` (§9).

### 6.7 Evidence quote block

**Purpose.** The trust payload: the exact line in Mei's own file that caused the decision.

**Anatomy** (inside `.row-body`, `.why-held` disclosures, fact cards):

```html
<figure class="quote">
  <ul class="why"><li>Why this was stopped:</li></ul>
  <blockquote><p>The client list contains NRIC numbers and is marked regulated.</p></blockquote>
  <figcaption>
    <span class="fileref">
      <svg class="ic" aria-hidden="true"><use href="#i-file"/></svg>
      <span class="path u-mono">admin/client_list.csv</span>
      <span class="ln u-mono">line 3</span>
    </span>
  </figcaption>
</figure>
```

```css
.quote { margin: 0; background: var(--color-surface); border: 1px solid var(--color-border);
         border-left: 3px solid var(--color-accent); border-radius: var(--radius-md);
         padding: var(--space-md) var(--space-base); }
.quote .why { list-style: none; margin: 0 0 var(--space-sm); padding: 0;
              font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--color-ink-secondary); }
.quote blockquote { margin: 0; padding: 0; }
.quote blockquote p { font-size: var(--text-base); line-height: var(--leading-body);
                      color: var(--color-ink); max-width: var(--measure); overflow-wrap: anywhere; }
.quote figcaption { margin-top: var(--space-sm); }
.fileref { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-xs);
           font-size: var(--text-xs); color: var(--color-ink-muted); }
.fileref .path { color: var(--color-ink-secondary); font-weight: var(--font-medium); overflow-wrap: anywhere; }
.fileref .ln { white-space: nowrap; }
```

The serif quotation-mark glyph and serif quote text are **removed** — quotes are Source Sans 3, distinguished by the accent left-border and the file chip. `.path`/`.ln` are always `--font-mono`. The old `app.js` evidence markup (`.evidence li .q/.src`) is replaced by this figure; `.src` string `file:line — why` is split into the three chip parts.

**A11y.** `<figure>/<figcaption>/<blockquote>` semantics; the file reference reads as "admin/client_list.csv, line 3" (comma inserted via `.ln::before { content: "· " }` or literal text — never rely on CSS-generated content for meaning: put the separator in the DOM as `<span class="sr-only">, </span>`).

### 6.8 Approval card

**Purpose.** The only place Mei says yes or no. Pending items must be unmissable; decided items must read as history.

**Anatomy** (replaces `app.js` `.qitem`; container `#queueList.cards`):

```html
<article class="card card-pending" id="q-Q1" aria-labelledby="q-Q1-title">
  <div class="card-top">
    <div class="card-who">
      <span class="pill pill-agent">Finance</span>
      <span class="card-when u-mono">09:14:07</span>
    </div>
    <p class="stake"><span class="amt u-mono">SGD 750</span><span class="lbl">at stake</span></p>
  </div>
  <h3 class="card-title" id="q-Q1-title">Pay QuickPrint SG against invoice 2026-038</h3>
  <p class="rec rec-deny">
    <svg class="ic" aria-hidden="true"><use href="#i-cross-circle"/></svg>
    <span><strong>Chaperone recommends: no.</strong> The same invoice was already paid this morning.</span>
  </p>
  <details class="why-held">
    <summary><svg class="ic chev" aria-hidden="true"><use href="#i-chev"/></svg>Why this is waiting</summary>
    <div class="why-body"> …quote blocks (§6.7), rule IDs in .tech… </div>
  </details>
  <div class="card-actions">
    <button type="button" class="btn btn-approve" data-q="Q1" data-d="approve">Approve</button>
    <button type="button" class="btn btn-danger"  data-q="Q1" data-d="deny">Say no</button>
  </div>
  <p class="card-err" role="alert" hidden>Could not record that. Try again.</p>
</article>
```

```css
.cards { display: grid; gap: var(--space-base); }
.card-pending { border-left: 4px solid var(--color-status-waiting-fg); }
.card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-base); }
.card-who { display: flex; align-items: center; gap: var(--space-sm); }
.card-when { font-size: var(--text-xs); color: var(--color-ink-muted); }
.card-title { font-size: var(--text-md); font-weight: var(--font-semibold); font-family: var(--font-body);
              line-height: var(--leading-snug); margin-top: var(--space-sm); overflow-wrap: anywhere;
              max-width: var(--measure); }
.stake { margin: 0; text-align: right; flex: none; }
.stake .amt { display: block; font-family: var(--font-mono); font-size: var(--text-lg);
              font-weight: var(--font-bold); line-height: var(--leading-tight); color: var(--color-ink);
              font-variant-numeric: tabular-nums; white-space: nowrap; }
.stake .lbl { font-size: var(--text-xs); color: var(--color-ink-muted); letter-spacing: var(--tracking-wide); }

.rec { display: flex; align-items: flex-start; gap: var(--space-sm);
       margin-top: var(--space-md); padding: var(--space-md) var(--space-base);
       border-radius: var(--radius-md); font-size: var(--text-base); line-height: var(--leading-snug); }
.rec .ic { width: 20px; height: 20px; flex: none; margin-top: 2px; }
.rec-deny   { background: var(--color-status-blocked-bg); color: var(--color-status-blocked-fg); }
.rec-review { background: var(--color-status-waiting-bg); color: var(--color-status-waiting-fg); }
.rec strong { font-weight: var(--font-bold); }

.card-actions { display: flex; gap: var(--space-md); margin-top: var(--space-lg); }
.card-actions .btn { flex: 0 1 auto; min-width: 140px; }
.card-err { color: var(--color-destructive-strong); font-size: var(--text-sm);
            font-weight: var(--font-semibold); margin-top: var(--space-md); }
```

**Pending vs decided — two visually distinct states:**

- **Pending:** white card, amber left border (4px), recommendation banner, live buttons. Sorted newest-first; the newest pending card gets `.fresh` arrival animation (§6.6).
- **Decided:** the card is re-rendered as history — `.card-decided`: `background: var(--color-surface-sunken)` wash **removed in favour of**: white card, `border-color: var(--color-border)`, no left accent, **no buttons in the DOM** (not disabled — absent), replaced by one resolved line: `<p class="decided-line"><svg class="ic">…</svg><span class="pill pill-status-done">You approved this</span> <time class="u-mono">09:20:41</time></p>` (or `pill-status-blocked` "You said no" — label states the *owner's* decision, icon+text as always). Decided cards move out of `#queueList` into `#decidedList` (`#decidedWrap` un-hidden) — the pending list only ever contains actionable items. `opacity` stays 1 (decided ≠ disabled; it must remain readable).
- The interim "just decided" moment uses the toast + undo bar (§6.13) before the card re-renders as decided.

**Money discipline.** `.amt` is mono, bold, 24px, right-aligned in a fixed column — amounts across stacked cards align vertically and are comparable at a glance. On < 768px `.card-top` becomes `column-reverse` and `.stake` left-aligns above the title (money first on mobile).

**Recommendation prominence.** `.rec` is a full-width tinted banner directly under the title — never buried in a paragraph. Copy is exactly "Chaperone recommends: no." or "Chaperone recommends: look closely." followed by one plain-language reason sentence.

**A11y.** `<article aria-labelledby>` per card; buttons carry `data-q`/`data-d`; on click the button disables (`aria-busy` on the pair's container) and an inline error (`role="alert"`) replaces `alert()`. After a decision, focus moves to the toast's Undo button (§6.13) so keyboard users can reverse instantly. The queue badge + tab `aria-label` update together.

### 6.9 Fact-check comparison row

**Purpose.** Show a claimed figure next to the truth on file, so a lie is obvious in one second.

**Anatomy** (container `#factList`; replaces `.factcard/.factrow/.factcell`):

```html
<article class="fact" aria-labelledby="fact-17-title">
  <div class="fact-head">
    <div>
      <span class="pill pill-agent">Finance</span>
      <h3 class="fact-title" id="fact-17-title">Blocked: reply to Aisha quoted figures that don't match any file</h3>
    </div>
    <span class="pill pill-status-fabricated"><svg class="ic" aria-hidden="true"><use href="#i-cross-circle"/></svg>Figure not on file</span>
  </div>
  <p class="draft"><span class="draft-lbl">What the agent tried to send</span>
    <blockquote>…body with <mark class="bad">25%</mark> and <mark class="ok">5,250</mark>…</blockquote></p>
  <div class="fact-table" role="table">
    <div class="fact-hdr" role="row"><span role="columnheader">Agent claimed</span><span></span><span role="columnheader">Actually on file</span></div>
    <div class="fact-row bad" role="row">
      <div class="claimed" role="cell"><span class="val u-mono">30%</span><span class="state">✕ no source — use icon</span></div>
      <div class="vs" role="cell"><svg class="ic" aria-hidden="true"><use href="#i-arrow"/></svg></div>
      <div class="real" role="cell"><span class="val u-mono">25%</span>
        <figure class="quote">…§6.7 quote of finance/invoice…:line…</figure></div>
    </div>
  </div>
</article>
```

```css
.fact { background: var(--color-surface); border: 1px solid var(--color-border);
        border-radius: var(--radius-lg); box-shadow: var(--elevation-1);
        padding: var(--space-lg); margin-bottom: var(--space-base); }
.fact-head { display: flex; justify-content: space-between; align-items: flex-start;
             gap: var(--space-base); margin-bottom: var(--space-base); }
.fact-title { font-family: var(--font-body); font-size: var(--text-md); font-weight: var(--font-semibold);
              margin-top: var(--space-sm); max-width: var(--measure); }
.draft { background: var(--color-bg); border-radius: var(--radius-md);
         padding: var(--space-md) var(--space-base); margin-bottom: var(--space-lg); }
.draft-lbl { display: block; font-size: var(--text-xs); font-weight: var(--font-semibold);
             letter-spacing: var(--tracking-caps); text-transform: uppercase;
             color: var(--color-ink-muted); margin-bottom: var(--space-xs); }
.draft blockquote { margin: 0; font-size: var(--text-base); line-height: var(--leading-body); overflow-wrap: anywhere; }
mark { background: none; color: inherit; padding: 0 2px; border-radius: var(--radius-sm); }
mark.bad { background: var(--color-status-fabricated-bg); color: var(--color-status-fabricated-fg);
           text-decoration: line-through; text-decoration-thickness: 2px; font-weight: var(--font-semibold); }
mark.ok  { background: var(--color-status-done-bg); color: var(--color-status-done-fg); font-weight: var(--font-semibold); }
.fact-table { display: grid; grid-template-columns: minmax(8rem, .55fr) 2.5rem minmax(0, 2fr); }
.fact-row { display: contents; }
.fact-row > div { padding: var(--space-base) 0; border-top: 1px solid var(--color-border); }
.claimed .val, .real .val { font-family: var(--font-mono); font-size: var(--text-lg);
                            font-weight: var(--font-bold); line-height: var(--leading-tight);
                            font-variant-numeric: tabular-nums; display: block; }
.bad .claimed .val { color: var(--color-status-fabricated-fg); text-decoration: line-through;
                     text-decoration-thickness: 2px; }
.real .val { color: var(--color-status-done-fg); }
.claimed .state { display: flex; align-items: center; gap: var(--space-xs);
                  font-size: var(--text-xs); font-weight: var(--font-semibold); margin-top: var(--space-xs); }
.bad .claimed .state { color: var(--color-status-fabricated-fg); }
.ok  .claimed .state { color: var(--color-status-done-fg); }
.claimed .state .ic, .vs .ic { width: 16px; height: 16px; }
.vs { display: flex; justify-content: center; color: var(--color-ink-muted); }
```

Rules: claimed and real values are **mono, same size, vertically aligned** in fixed columns so discrepancies pop; the fabricated value is struck through *and* tinted *and* icon-tagged ("no source" state uses `#i-cross-circle` + words, never a bare ✕). "No file supports this figure." renders in `.real .none` with `pill-status-fabricated`. Mobile: `.fact-table` collapses to one column (claimed → vs rotated 90° → real), per the existing 720px pattern but with the values kept (remove the old `display:none` on `.real .val`).

**A11y.** `role="table"` grid keeps header associations; `<mark>` is exposed to AT as highlighted text — the strike-through meaning is duplicated by the `.state` text. Draft blockquote is labelled by `.draft-lbl` (real text, not CSS content).

### 6.10 Lineage chain

**Purpose.** Show that a derived file is exactly as sensitive as its most sensitive ancestor, and what was attempted with it.

**Anatomy** (container `#lineageList`; replaces `app.js` `.chain/.node/.arrow` markup; keep class names `.chain`, `.node`, rename connector `.arrow` → `.link-step` to match `index.html`'s CSS-era naming):

```html
<article class="chain">
  <h3 class="chain-title">notes/ferro_summary.md — where it came from, where it was going</h3>
  <ol class="chain-steps">
    <li><div class="node lv-client-confidential">
          <span class="node-k">Source file</span>
          <span class="node-id u-mono">clients/proposal_ferro_logistics.md</span>
          <span class="pill pill-level-confidential">Client confidential</span>
        </div></li>
    <li class="link-step"><svg class="ic h" aria-hidden="true"><use href="#i-arrow"/></svg>
        <svg class="ic v" aria-hidden="true"><use href="#i-down"/></svg>
        <span class="link-lbl">summarised into</span></li>
    <li><div class="node lv-client-confidential">
          <span class="node-k">Derived output</span>
          <span class="node-id u-mono">notes/ferro_summary.md</span>
          <span class="pill pill-level-confidential">Client confidential</span>
          <span class="inherit">Inherited from clients/proposal_ferro_logistics.md — rewording never lowers sensitivity.</span>
          <span class="flag"><svg class="ic" aria-hidden="true"><use href="#i-know"/></svg>Carries unannounced client news</span>
        </div></li>
    <li class="link-step">…<span class="link-lbl">then tried to</span></li>
    <li><div class="node act d-BLOCK">
          <span class="node-k">Attempted action</span>
          <span class="dec"><span class="pill pill-status-blocked">…Stopped</span></span>
          <span class="node-text">Upload to slidedck-ai.example</span>
        </div></li>
  </ol>
</article>
```

```css
.chain { background: var(--color-surface); border: 1px solid var(--color-border);
         border-radius: var(--radius-lg); box-shadow: var(--elevation-1);
         padding: var(--space-lg); margin-bottom: var(--space-base); }
.chain-title { font-family: var(--font-body); font-size: var(--text-md); font-weight: var(--font-semibold);
               margin-bottom: var(--space-base); overflow-wrap: anywhere; }
.chain-steps { list-style: none; margin: 0; padding: 0; display: grid;
               grid-template-columns: minmax(0,1fr) 7.5rem minmax(0,1fr) 7.5rem minmax(0,1fr);
               align-items: stretch; }
.node { height: 100%; display: flex; flex-direction: column; gap: var(--space-sm);
        background: var(--color-bg); border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-border-strong);
        border-radius: var(--radius-md); padding: var(--space-base); }
.node.lv-public           { border-left-color: var(--color-level-public); }
.node.lv-internal         { border-left-color: var(--color-level-internal); }
.node.lv-client-confidential { border-left-color: var(--color-level-confidential); }
.node.lv-regulated        { border-left-color: var(--color-level-regulated); }
.node-k { font-size: var(--text-xs); font-weight: var(--font-semibold); letter-spacing: var(--tracking-caps);
          text-transform: uppercase; color: var(--color-ink-muted); }
.node-id { font-size: var(--text-sm); color: var(--color-ink); overflow-wrap: anywhere; }
.node .inherit { font-size: var(--text-xs); color: var(--color-ink-secondary); line-height: var(--leading-snug); }
.flag { display: inline-flex; align-self: flex-start; align-items: center; gap: var(--space-xs);
        font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--color-status-waiting-fg);
        background: var(--color-status-waiting-bg); border: 1px solid var(--color-status-waiting-border);
        border-radius: var(--radius-pill); padding: var(--space-2xs) var(--space-md); }
.link-step { display: flex; flex-direction: column; align-items: center; justify-content: center;
             gap: var(--space-xs); color: var(--color-ink-muted); font-size: var(--text-xs); padding: 0 var(--space-xs); }
.link-step .ic { width: 24px; height: 24px; }
.link-step .ic.v { display: none; }
.node.act { background: var(--color-surface); }
.node.act.d-BLOCK { background: var(--color-status-blocked-bg); border-color: var(--color-status-blocked-border);
                    border-left-color: var(--color-status-blocked-fg); }
.node.act.d-HOLD_FOR_APPROVAL { background: var(--color-status-waiting-bg); border-color: var(--color-status-waiting-border);
                                border-left-color: var(--color-status-waiting-fg); }
.node.act.d-ALLOW { background: var(--color-status-done-bg); border-color: var(--color-status-done-border);
                    border-left-color: var(--color-status-done-fg); }
```

Sensitivity is encoded **three ways**: left-border colour, level pill (icon-less pills are forbidden → level pills carry the level *word*, which they do), and the ladder position in `.ladder` legend at page top (keep existing `.ladder` markup; recolour meters with `--color-level-*`). `< 1024px`: single column, `.ic.h` hidden / `.ic.v` shown, connectors become horizontal rows (existing pattern). The `.levels` file inventory (`#filesByLevel`) keeps its 4-column grid (2-col at 768, 1-col at 375) with `h3` per level using the level pill + count in mono.

**A11y.** `<ol>` conveys sequence; each node's text is self-describing in DOM order ("Source file … Client confidential"). Connector labels ("summarised into", "then tried to") are real text. `.ladder` keeps its `aria-label`.

### 6.11 Scorecard grid

**Purpose.** Prove the oversight works: 10 scenarios × 3 checks, live.

**Structure.** Replace the `role="table"` div soup with a **real `<table class="score">`** inside `#scoreGrid` (drop `role="table"` — native semantics are better):

```html
<table class="score">
  <caption class="sr-only">Ten demo scenarios, each checked for correct decision, correct rule and cited evidence</caption>
  <thead><tr><th scope="col">Scenario</th><th scope="col">Decision</th><th scope="col">Rule</th>
           <th scope="col">Evidence</th><th scope="col" class="num">Checks passed</th></tr></thead>
  <tbody>
    <tr>
      <th scope="row" class="sit"><strong>Client list to a newsletter tool</strong>
          <span class="sid u-mono"><span class="sr-only">Scenario </span>S1</span></th>
      <td class="chk pass"><svg class="ic" aria-hidden="true"><use href="#i-done"/></svg>Pass · BLOCK</td>
      <td class="chk pass"><svg class="ic" aria-hidden="true"><use href="#i-done"/></svg>Pass</td>
      <td class="chk fail"><svg class="ic" aria-hidden="true"><use href="#i-cross"/></svg>Fail
          <span class="miss">missing: bank_details citation</span></td>
      <td class="num u-mono">2/3</td>
    </tr>…
```

```css
table.score { width: 100%; border-collapse: collapse; background: var(--color-surface);
              border: 1px solid var(--color-border); border-radius: var(--radius-lg);
              box-shadow: var(--elevation-1); overflow: hidden; }
table.score th { text-align: left; font-family: var(--font-body); font-size: var(--text-xs);
                 font-weight: var(--font-semibold); letter-spacing: var(--tracking-wide);
                 text-transform: uppercase; color: var(--color-ink-muted);
                 padding: var(--space-md) var(--space-base); border-bottom: 1px solid var(--color-border); }
table.score td, table.score th.sit { padding: var(--space-md) var(--space-base);
                 border-top: 1px solid var(--color-border); vertical-align: top; font-size: var(--text-sm); }
table.score .sit strong { display: block; font-size: var(--text-base); font-weight: var(--font-semibold); }
table.score .sid { font-size: var(--text-xs); color: var(--color-ink-muted); }
table.score .num { text-align: right; white-space: nowrap; font-size: var(--text-base); font-weight: var(--font-bold); }
.chk { white-space: nowrap; font-weight: var(--font-semibold); }
.chk .ic { width: 18px; height: 18px; vertical-align: -4px; margin-right: var(--space-xs); }
.chk.pass { color: var(--color-status-done-fg); }
.chk.fail { color: var(--color-status-blocked-fg); }
.miss { display: block; font-size: var(--text-xs); font-weight: var(--font-regular);
        color: var(--color-ink-secondary); margin-top: var(--space-xs); white-space: normal; }
table.score tr.fresh td { animation: flash var(--duration-flash) ease-out; --flash: var(--color-accent-tint); }
```

`✓`/`✗` characters are **banned** — icon + "Pass"/"Fail" words always. `#scoreStats` uses the stat cards of §6.5 (2-up: classifier accuracy, scenario checks). The `30/30` figure renders `n/total` in mono. Mobile < 768px: the existing card-ification pattern (`display:block` rows, `td::before` labels "Decision / Rule / Evidence") is kept — it works; just restyle to tokens.

### 6.12 Empty state

**Purpose.** Never a dead end: explain what will appear here, and give the one action that fills it.

**Anatomy** (existing `.empty` containers `#logEmpty`, `#queueEmpty`, `#factEmpty`, `#lineageEmpty`, `#scoreEmpty`, `#logNone`):

```css
.empty { display: flex; flex-direction: column; align-items: center; text-align: center;
         gap: var(--space-md); max-width: 34rem; margin: 0 auto;
         padding: var(--space-3xl) var(--space-lg); color: var(--color-ink-secondary); }
.empty-illus { width: 96px; height: 96px; border-radius: var(--radius-pill);
               background: var(--color-accent-tint); color: var(--color-accent-strong);
               display: flex; align-items: center; justify-content: center; }
.empty-illus .ic { width: 40px; height: 40px; }
.empty-title { font-family: var(--font-heading); font-size: var(--text-lg);
               font-weight: var(--font-semibold); color: var(--color-ink); }
.empty p { max-width: var(--measure); font-size: var(--text-base); }
.empty .btn { margin-top: var(--space-sm); }
```

**Illustration guidance:** no raster images, no cartoons. The illustration is a 96px tinted circle containing the relevant 40px sprite icon (log → `#i-file`, queue → `#i-wait`, facts → `#i-cross-circle`, lineage → `#i-arrow`, scorecard → `#i-done`). Inline SVG only; `aria-hidden="true"`.

**Scorecard empty state (the lazy one) — exact replacement copy + treatment:**

```html
<div id="scoreEmpty" class="empty">
  <span class="empty-illus" aria-hidden="true"><svg class="ic"><use href="#i-done"/></svg></span>
  <p class="empty-title">Nothing scored yet.</p>
  <p>Run the demo to watch Chaperone catch ten scripted mistakes — a fake price, a fabricated
     figure, a regulated file about to leave the studio — and score itself live on every one.</p>
  <button type="button" class="btn btn-secondary" data-run>
    <svg class="ic" aria-hidden="true"><use href="#i-play"/></svg> Run the demo
  </button>
  <p class="fine">Takes about 30 seconds. Nothing is sent anywhere — it replays the studio's own files.</p>
</div>
```

The CTA is a real, visible `.btn-secondary` (never the old near-invisible white-on-beige `.btn-quiet` look), and the copy now says **why** to run it. `#logNone` (filter miss) keeps its "Show everything" `.link` but at 44px min-height.

### 6.13 Toast / inline confirmation for owner decisions

**Purpose.** Confirm the decision instantly, and make it reversible for 8 seconds — that reversibility *is* the "confirm before destructive" mechanism for Say-no/Approve (no modal dialog interrupting flow).

**Anatomy.** One container, appended before `</body>`: `<div id="toasts" class="toasts" aria-hidden="true"></div>` — toasts are visual duplicates of what `#announcer` speaks; interactive Undo is focusable, so the container drops `aria-hidden` whenever a toast with a button is present.

```html
<div class="toast toast-decision">
  <svg class="ic" aria-hidden="true"><use href="#i-stop"/></svg>
  <p class="toast-text">You said no to paying QuickPrint SGD 750.</p>
  <div class="undo">
    <button type="button" class="btn-link-undo" data-undo="Q1">Undo</button>
    <span class="undo-bar" aria-hidden="true"><i style="--from:1"></i></span>
  </div>
</div>
```

```css
.toasts { position: fixed; right: var(--space-lg); bottom: var(--space-lg); z-index: var(--z-toast);
          display: grid; gap: var(--space-md); max-width: 420px; }
.toast { display: grid; grid-template-columns: auto minmax(0,1fr); gap: var(--space-sm) var(--space-md);
         background: var(--color-surface); border: 1px solid var(--color-border);
         border-left: 4px solid var(--color-status-blocked-fg);
         border-radius: var(--radius-md); box-shadow: var(--elevation-2);
         padding: var(--space-base); animation: toast-in var(--duration-base) var(--ease-out); }
.toast.approved { border-left-color: var(--color-status-done-fg); }
.toast > .ic { width: 20px; height: 20px; margin-top: 2px; color: var(--color-ink-secondary); }
.toast-text { font-size: var(--text-base); font-weight: var(--font-semibold); color: var(--color-ink); }
.undo { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--space-md); }
.btn-link-undo { min-height: var(--target-min); padding: var(--space-md) 0; background: none; border: 0;
                 color: var(--color-accent); font-size: var(--text-base); font-weight: var(--font-semibold);
                 text-decoration: underline; text-underline-offset: 4px; cursor: pointer; }
.undo-bar { flex: 1 1 auto; height: 6px; border-radius: var(--radius-sm);
            background: var(--color-surface-sunken); overflow: hidden; }
.undo-bar i { display: block; height: 100%; background: var(--color-accent);
              transform-origin: left; animation: drain 8s linear forwards; }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes drain { from { transform: scaleX(var(--from, 1)); } to { transform: scaleX(0); } }
```

Behaviour: toast appears on decision, lives 8s (the drain bar is the visible countdown), Undo restores `status: 'pending'` via the existing queue API and re-renders the card as pending. Focus moves to the Undo button when the toast appears; on dismiss/timeout focus returns to the decided card (or the next pending card). At < 768px `.toasts` becomes `left/right/bottom: var(--space-base)`, full width. Under reduced motion the toast appears instantly and the drain bar is replaced by a static full bar (the 8s timer still runs — time-based behaviour is not motion).

---

## 7. Screen-level composition notes (fixing the critique)

**Today's briefing.** The 40px greeting is demoted: `#greeting` becomes a 14px uppercase overline (`--tracking-caps`, `--color-ink-muted`) reading "Thursday 19 November · Good morning, Mei"; the `h1` role moves to `#todayLead`, which carries the headline sentence at `--text-xl` (e.g. "6 risky actions stopped. 3 waiting for your yes — SGD 12,400 in total." with money in `.money` mono, `--color-status-waiting-fg`). Order inside `#todayBody`: `#statrow` (§6.5) → "Waiting for your yes" (`#todayQueue`) → "Stopped…" (`#todayStopped`) → `#briefSections` → disclosures. The intro card (`#todayIntro`) shows only before the first run; its legend becomes three **equal** grid cards (icon in a 40px tinted circle like `.stat-ic`, label bold 16px, description 14px — tops aligned by grid, fixing the uneven trio), and its CTA is `.btn-secondary` (§6.3 one-primary rule).

**Live log.** Filters (`.seg` toggle buttons) restyle: 44px min-height, `--radius-pill`, unselected = white + `--color-border-strong` outline, selected (`aria-pressed="true"`) = navy fill + white text; each filter button contains the status **icon** so filtering is colourblind-safe. Rows per §6.6. `#filters` gets a visible label row ("Show by outcome" / "Show by agent" as `--text-xs` uppercase captions — the `aria-label`s already exist).

**Approvals.** Pending first, newest first; decided items live only in `#decidedWrap` ("Already decided") as compact rows: icon + what + your decision pill + mono time, on `--color-surface-sunken`-free white with hairline separators (the old `.decided` list, restyled). No decided item ever shows buttons.

**Where files went / Fact-check / Scorecard** per §6.9–6.11.

---

## 8. Motion

### 8.1 Token table

| Token | Value | Used for |
|---|---|---|
| `--duration-fast` | 120ms | hover/press colour changes, button transform |
| `--duration-base` | 200ms | chevron rotation, tab indicator, toast in/out, disclosure |
| `--duration-slow` | 350ms | list-item & card entrance (inside the verified 300–450ms band) |
| `--duration-flash` | 2400ms | one-shot background flash on a newly arrived row |
| `--duration-stagger` | 60ms | per-child delay in staggered entrances |
| `--ease-out` | `cubic-bezier(0.33,1,0.68,1)` | entrances (power2.out-class) |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | state changes, hovers, indicator |

### 8.2 Stagger spec ("Stagger List", Standard tier)

When a tab panel activates or a list first renders (`#logList`, `#queueList`, `#factList`, `#lineageList`, `.figures`, scorecard rows): children animate `opacity 0→1`, `translateY(8px)→0`, duration `--duration-slow`, easing `--ease-out`, delay `index × 60ms`, **max 8 staggered children** — items 9+ render in their final state immediately (no delay). Implement with one CSS animation + `style="--i:{index}"` and `animation-delay: calc(var(--i) * var(--duration-stagger))`, capped: `--i: min(index, 7)`.

### 8.3 What animates / what never does

**Animates:** list entrances (stagger), new-row arrival + tint flash, chevrons, tab indicator, toast in/out + undo drain, button hover/press, pulse dot and progress segments during a demo run, pip `pop` when a lane mark lands.

**Never animates:** text content changes (no typewriter), colour of status semantics (a pill never transitions from one status to another — it re-renders), layout reflow of the whole page, parallax, anything on scroll, any decorative loop (the only infinite animations are the demo-running pulse/segments, which stop when the run ends). No animation exceeds 2400ms except the undo drain (8s, functional countdown — exempt as a timer visualisation, and static under reduced motion).

### 8.4 `prefers-reduced-motion: reduce` — exact behaviour

The global block in `tokens.css` collapses every animation/transition to 0.01ms, which renders **final states immediately**: staggered items appear at once, flashes are invisible, toasts pop in with no slide, chevrons snap. Additionally: the undo drain bar renders static-full (JS checks `matchMedia('(prefers-reduced-motion: reduce)')` and skips the animation, keeping the 8s timer), the pulse dot and progress segments render solid (no blinking), and `scroll-behavior` is auto. **No functionality is gated behind motion** — every state is fully perceivable with animation disabled.

---

## 9. Live regions & announcements

**Exactly one polite live region for dynamic content: `#announcer`** (`class="sr-only" aria-live="polite" aria-atomic="true"` — change the current `aria-atomic="false"` to `true`). Rules:

1. Every user-visible dynamic event produces **one** whole-sentence announcement with context — never a bare number, never per-row spam.
2. `#demoStatus` loses its `aria-live` attribute (it becomes a plain sr-only mirror for the header button state); `#progress` keeps `role="status"` but is only updated at phase boundaries, so at most one region speaks at a time. No other `aria-live`/`role="status"`/`role="alert"` may be added except the inline `.card-err[role="alert"]` (assertive by nature, appears only on failure).
3. Streaming log updates are announced **in aggregate**, debounced 1.5s: e.g. `<span role="status" aria-atomic="true">6 risky actions stopped</span>` — the canonical example. On demo finish: "Demo complete. 6 risky actions stopped, 3 waiting for your yes, 12,400 Singapore dollars in total, 14 routine actions done."
4. Owner decisions announce outcome + reversibility: "You said no to paying QuickPrint 750 dollars. Undo available for 8 seconds."
5. Money is spoken in words-friendly form ("12,400 Singapore dollars"), rule IDs are never announced.

---

## 10. Accessibility conformance checklist (engineer must satisfy all)

- [ ] **Contrast:** every text pair ≥ 4.5:1 as computed in §3 (spot-check with a contrast tool after build); UI shape boundaries (focus ring, selected filter, active indicator) ≥ 3:1 against adjacent colours.
- [ ] **Focus:** `:focus-visible` 3px `--color-accent` ring, 2px offset, on every interactive element; never `outline: none` without a replacement; focus never trapped; focus order = DOM order; after any decision, focus moves to the toast Undo, then back to the list.
- [ ] **Keyboard:** tabs implement the full APG tablist pattern (arrows/Home/End, roving tabindex, `aria-selected`); all disclosures are native `<details>`; all actions are native `<button>`; skip link first in order; the app is 100% operable without a mouse.
- [ ] **Live regions:** exactly one atomic polite region (`#announcer`), aggregate contextual sentences only (§9); no bare numbers; no competing regions.
- [ ] **Target size:** all primary controls (buttons, tabs, filter chips, summary rows, undo) ≥ 44×44 CSS px hit area; inline `.link` buttons pad to 44px height.
- [ ] **Semantic HTML:** native `<table>` for the scorecard, `<details>/<summary>` for disclosures, `<figure>/<blockquote>/<figcaption>` for evidence, `<article>` for cards, `<time datetime>` for timestamps, one `<h1>` per panel, no heading-level skips, no div-soup roles where a native element exists.
- [ ] **No colour-alone:** every status = colour + icon + text (§3.2/§3.4); filters carry icons; scorecard checks carry words.
- [ ] **Reduced motion:** §8.4 verified with the OS setting on.
- [ ] **Numbers:** `tabular-nums` + mono for amounts/counts/timestamps/paths/rule IDs; thousands separators everywhere.
- [ ] **Confirm-before-destructive:** Say-no/Approve are reversible for 8s via toast Undo; no `window.alert`/`confirm` anywhere; errors are inline `role="alert"` or error toasts.
- [ ] **Empty states:** every empty container = illustration + explanation + working action (§6.12).
- [ ] **Images/icons:** all decorative SVG `aria-hidden="true"`; sprite root `focusable="false"`; no emoji.
- [ ] **Language & copy:** `lang="en"`; UI strings are plain words; rule IDs only inside details disclosures.

---

## 11. Anti-patterns — banned in this project

1. Status conveyed by colour alone (dots, tinted text, red/green pairs) — High-severity defect.
2. Serif/display fonts, font mixes beyond the three families, any size outside the §2.3 scale.
3. Gradients, glassmorphism/blur, inner glows, shadows beyond the two elevation tokens, skeuomorphism.
4. AI-marketing purple/pink gradients; any decorative colour not in §3.
5. Emoji or text glyphs (✓ ✕ →) as status carriers.
6. Rule IDs (`R01`…), raw JSON, stack traces or scope-creep dumps in the primary reading path — details disclosures only.
7. Multiple `aria-live` regions, bare-number announcements, per-row announcements during streaming.
8. More than one primary CTA per view; a "Run the demo" button styled primary anywhere except the header.
9. Browser-default controls: `alert()`, `confirm()`, unstyled `<button>`, native `<details>` marker triangle.
10. Proportional-width numerals for money, times, counts, paths; amounts without separators.
11. Disabled-looking or blank empty states; empty states without an action.
12. Decided approvals that still render active buttons; disabled buttons as a substitute for "resolved" state.
13. `outline: none` without a visible replacement; click targets under 44px for primary controls.
14. Motion over 450ms for entrances, stagger beyond 8 children, infinite decorative animation, motion not killed by `prefers-reduced-motion`.
15. Breaking the token system: hardcoded hex/px values in component CSS, one-off radii, magic-number spacing.

---

## 12. DOM mapping, renames & known drift

**Reuse these existing ids/classes unchanged:** `.top`, `.top-inner`, `.brand`, `.mark`, `.brand-text`, `.top-actions`, `#runDemo`, `#demoStatus`, `nav.tabs`, `#tabs`, `#tabbtn-*`, `#tab-*` panels, `#logCount`, `#queueBadge`, `#progress`, `#progressText`, `#progressSegs`, `#announcer`, `.skip`, `#main`, `#greeting`, `#todayLead`, `#todaySub`, `#todayIntro`, `.legend`, `#todayBody`, `.today-grid`, `.col-main`, `.col-side`, `#todayQueue`, `#todayStopped`, `#briefSections`, `#doneMore`, `#rawBrief`, `#briefText`, `#videoWrap`, `#lanes`, `.keyline`, `.pip`, `#decFilter`, `#agentFilter`, `.seg`, `#logList`, `.rows`, `.row`, `#logNone`, `#logEmpty`, `#queueList`, `.cards`, `.card`, `#queueEmpty`, `#decidedWrap`, `#decidedList`, `#factList`, `#factEmpty`, `.ladder`, `.lv-*`, `.meter`, `#lineageList`, `#lineageEmpty`, `#filesWrap`, `#filesByLevel`, `.levels`, `#scoreWrap`, `#scoreStats`, `#scoreGrid`, `#scoreEmpty`, `.empty`, `.btn`, `.btn-primary`, `.btn-lg`, `.link`, `.hidden`, `.sr-only`, `.more`, `.plainlist`, `.quote`, `.fileref`, `.chain`, `.node`, `.stat`, `.figures`, `.fresh`, `.chip`→(see renames).

**Explicit renames (old → new):**

| Old (file) | New | Why |
|---|---|---|
| `.chip` (app.js) / `.tag` (style.css) | `.pill` + variants §6.4 | one status component, one name |
| `.btn-quiet` (style.css) | `.btn-secondary` | "quiet" described the defect (near-invisible), not the role |
| `.qitem` (app.js) | `.card.card-pending` / `.card.card-decided` | approvals are cards; states are classes |
| `.item` + `.loghead` (app.js) | `.row` + `<summary>` grid §6.6 | log rows are disclosures, not divs |
| `.factcard`/`.factrow`/`.factcell` (app.js) | `.fact`/`.fact-row`/`.claimed`+`.real` §6.9 | match style.css-era naming |
| `.scorecard` (app.js) | `<table class="score">` rows §6.11 | native table semantics |
| `.arrow` (app.js lineage) | `.link-step` | matches index.html CSS vocabulary |
| `.d-know` legend class | `.pill-status-held` usage | "Needs a look" status name |

**Known drift the engineer must fix (flagged, owned by them):** `web/app.js` is stale against `web/index.html` — it still queries `#briefEmpty`, `#briefWrap`, `#statrow` which the redesigned HTML no longer contains (the new Today markup uses `#todayBody`, `#todayQueue`, `#todayStopped`, `#lanes`), and it renders the legacy component markup above. The rebuild must: add `#statrow` markup inside `#todayBody` per §7 (or render stats into a new `.figures` container at the top of `.col-main`), replace `renderLog/renderQueue/renderFacts/renderLineage/renderScore` output with the §6 components, add tablist arrow-key handling (§6.2), flip `#announcer` to `aria-atomic="true"` and remove `aria-live` from `#demoStatus` (§9), replace both `alert()` calls with toasts (§6.13), and switch timestamps to 24h mono per §2.4.

---

*End of MASTER. Build from tokens.css + this document + the existing HTML; anything unspecified is a question for design, not a decision for the implementer.*
