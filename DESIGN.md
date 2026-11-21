# Chaperone — Design System (rebuild)

**Scope:** the vanilla-JS web app (`web/`). Companion to `design-system/chaperone/MASTER.md`
(the original token spec). This file documents the tokens as shipped, the unified
status vocabulary, the component rules, and the mobile-first layout contract added
in the red-team rebuild. Light theme only (`color-scheme: light`); every colour is a
CSS variable so a dark remap is a future token swap, not a rewrite.

**Benchmark:** Linear / Stripe / Things 3 / Arc. The product's one job: let a
non-technical owner answer *"what needs my yes?"* in seconds, on a phone, with the
reason and the evidence one tap away. Money and risk first; chrome never outranks a
decision.

---

## 1. Tokens

All tokens live in `:root` (`web/style.css`) and are duplicated in the inline
critical CSS (`web/index.html`) for the first paint. **Do not invent values outside
this scale.**

### Colour — surfaces & ink
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#F8FAFC` | page field |
| `--color-surface` | `#FFFFFF` | cards, header, rows |
| `--color-surface-sunken` | `#E8ECF1` | recessed fills, video letterbox, skeleton |
| `--color-border` / `--color-border-strong` | `#E2E8F0` / `#94A3B8` | hairline / interactive border |
| `--color-ink` / `-secondary` / `-muted` | `#0F172A` / `#334155` / `#475569` | text (17.06 / 9.90 / 7.24 : 1 on bg) |
| `--color-accent` / `-strong` / `-tint` | `#0369A1` / `#075985` / `#E1F1FC` | links, active tab, focus |
| `--color-primary` | `#0F172A` | primary button fill (white 17.85:1) |
| `--color-destructive-strong` | `#B42318` | "Say no" solid (white 6.57:1) |

### Colour — status (one hue = one meaning, app-wide)
Every status is **tint + border + icon + text label** — never colour alone.
| State | fg / bg / border | Icon | Solid |
|---|---|---|---|
| Done (ALLOW) | `#146C33` / `#E9F7EE` / `#A9D9B8` | `i-done` | `#146C33` |
| Waiting (HOLD) | `#8A5300` / `#FDF1D7` / `#E8C988` | `i-wait` | — |
| Stopped (BLOCK) | `#B42318` / `#FBEAE7` / `#EDA69C` | `i-stop` | `#B42318` |
| Needs a look (review) | `#075985` / `#E1F1FC` / `#9CC9E8` | `i-eye` | — |
| Wrong figure | `#9D174D` / `#FCE8F1` / `#EBAAC8` | `i-cross-circle` | — |
| Regulated data | `#3730A3` / `#E7E8FB` / `#ABAFE3` | `i-lock` | — |

File-sensitivity levels reuse these hues (public=green, internal=blue,
confidential=amber, regulated=indigo) so colour meaning never forks.

### Type
Self-hosted **WOFF2 subsets** (`web/fonts/*.woff2`, SIL OFL 1.1), `font-display:
optional` (no swap reflow), preloaded. Families: `--font-heading` Lexend,
`--font-body` Source Sans 3, `--font-mono` JetBrains Mono. Modular scale (16px base):
`--text-xs` 12 · `--text-sm` 14 · `--text-base` 16 · `--text-md` 18 · `--text-lg` 24 ·
`--text-xl` 32 · `--text-metric` 40. Weights 400/500/600/700. Line heights
1.15 / 1.25 / 1.4 / 1.5. `font-variant-numeric: tabular-nums` everywhere numbers align.
**Headline is responsive:** `h1 { font-size: clamp(1.625rem, 7vw, 2rem) }` below 768px.

### Spacing / layout / radii
4px base: `2xs` 2 · `xs` 4 · `sm` 8 · `md` 12 · `base` 16 · `lg` 24 · `xl` 32 ·
`2xl` 48 · `3xl` 64. Container `--container-max` 1240px; gutter 32px (≥1024) / 16px
(<768); prose `--measure` 70ch; tap target `--target-min` 44px; sidebar 380px.
Radii 6 / 10 / 14 / pill. Two elevations max (flat design). Focus ring 3px, offset 2px.
Motion 120 / 200 / 350ms, `prefers-reduced-motion` honoured globally.

---

## 2. Status vocabulary (D4 — unified)

The engine decides `ALLOW` / `HOLD_FOR_APPROVAL` / `BLOCK`. The owner **only ever
sees three words**, identical on every tab, pill, filter, stat and screen-reader
announcement:

| Engine | Owner-facing label | Meaning |
|---|---|---|
| `ALLOW` | **Done** | routine work went ahead without asking |
| `HOLD_FOR_APPROVAL` | **Waiting** | money / promises wait for your yes |
| `BLOCK` | **Stopped** | nobody may do this; stopped before it left |

"Held" is retired as a label (it was system-voice and forked from "Waiting"). The
expander keeps the plain phrase **"Why it was held"** as descriptive prose, not a
status label. Decision outcomes read **"You approved this"** / **"You said no"**.

---

## 3. Components

- **Approval card** — agent + time, money at stake (mono, nowrap), title,
  recommendation **badge** (amber "no" / blue "look closely"), the reason in line,
  split-payment maths when relevant, a **"Why it was held"** disclosure (evidence
  quotes with file + line), then the action row. Shown identically on Today and
  Approvals (Today is compact padding, not reduced content — U2).
- **Action row (U1)** — **fixed positions: "Say no" always left, "Approve" always
  right.** The recommendation never swaps order or promotes Approve. A "no"
  recommendation fills Say no (destructive solid); a "look closely" recommendation
  promotes neither (both secondary). One click decides; an 8s Undo window with a
  visible 6px drain bar in the status hue replaces a confirm dialog.
- **Stat cards** — waiting first (the only one that needs the owner), then stopped,
  file reads stopped, done. Amounts nowrap. 4-up desktop, 2×2 tablet, compact 2×2 mobile.
- **Log row** — time · agent · plain-English action · status pill(s) · chevron;
  expands to evidence, fact-check, injection-as-data, lineage, technical details.
- **Run picker (U3)** — the log is append-only; every demo run is archived and
  browsable read-only. "Already decided" keeps decisions across runs.
- **Scorecard (D5)** — desktop table; mobile collapses an all-pass scenario to one
  line ("S1 · 3/3 · all checks passed"), tap to expand. A failure always shows its
  labelled detail. Failure is the only state that deserves density.
- **Empty / error states** — illustration + plain-English why + CTA. A distinct
  offline banner ("Can't reach the server… Retry") replaces misleading "nothing
  happened yet" copy (F5). Filtered-empty is distinguished from true-empty.
- **Video** — reserved 16:9 box (`aspect-ratio` + width/height attrs), light
  letterbox, so showing it never shifts the page (F2).

---

## 4. Mobile-first rules (≤767px)

1. **Slim chrome (D1/D2):** header ≤150px. Tagline and "who" hidden; brand name
   takes its natural width and never collapses; the "Demo mode" pill is redundant
   with the demo disclosure (hidden); a live connection needs no chip (the error
   banner covers trouble). Tabs are one horizontally scrollable row of short labels.
2. **Decisions above the fold (U4):** `#todayBody` becomes a flex column with
   `display: contents` on the grid; order = waiting cards → stat strip → stopped →
   brief → done → sidebar. The first "Say no"/"Approve" sits within the first viewport.
3. **Money never splits (D3):** `#todayLead .money { white-space: nowrap }`; headline
   steps down via `clamp`.
4. **Full-width stacked buttons** (44px+), Say no on top, Approve below — same order
   as desktop left-to-right.
5. **First paint is server-rendered (F1):** headline, sub-line and stat cards are
   injected into the initial HTML from real server data; critical CSS is inline; the
   full sheet is preloaded and deferred; a height-matched skeleton reserves the card
   space. Text assets and `/api/state` are brotli/gzip-compressed; fonts are immutable.

---

## 5. Trust & safety invariants

- Never fake a gate decision; demo data is clearly the demo dataset; the gate stays
  DISARMED. Writes to the real engine (`/api/gate`, `/api/hook`) require owner auth;
  visitors are isolated in the sandbox (S1).
- Every figure traces to a file; no invented numbers. The owner token is never
  printed or embedded in the page.
- Accessibility is non-negotiable: 4.5:1 text, 3px focus rings, 44px targets, full
  keyboard operation, one polite live region, status never colour-alone.