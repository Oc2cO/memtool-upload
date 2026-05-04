# MemTool — Cosmic Dark Theme Accessibility Audit

**Last reviewed:** May 3, 2026 (Task #349 — in-code tokens re-aligned to
the BRAND.md cosmic palette: navy `#0A0F1E`, brand cyan `#00E5FF`, brand
purple `#9B7AE8`).
**Standard:** WCAG 2.1 AA — 4.5:1 for normal text, 3:1 for large text (≥18pt
or ≥14pt bold) and non-text UI components (icons, focus rings, control
edges).

This is the canonical record of every foreground / background pairing in
use across the cosmic dark theme, the contrast ratio measured against the
**actual rendered surface** (not just the token's nominal background), and
the decision applied. The next person doing a colour pass should start
here, not from scratch.

The "High Contrast" toggle in Settings (Task #339) does **not** rebrand
the app — it merges the `darkHighContrast` overrides in
`constants/colors.ts` on top of the base palette via `useColors()`. The
overrides only nudge values that sit close to the AA floor on
glassmorphic surfaces; the cosmic identity (deep navy, brand purple,
accent teal, warm amber for Sagous) is preserved.

---

## Method

Ratios were computed using the standard WCAG sRGB relative luminance
formula:

```
L = 0.2126*R + 0.7152*G + 0.0722*B   (linearised sRGB channels)
ratio = (L_lighter + 0.05) / (L_darker + 0.05)
```

For glassmorphic surfaces (`rgba(180, 122, 255, 0.10)` etc.) the
**effective** background is computed by alpha-compositing the glass over
the deepest surface it can ever sit on — `background #0A0F1E` — which is
the worst case for the foreground colour. Any pairing that passes against
the worst-case effective background passes everywhere it appears.

---

## Base palette (no High Contrast)

| # | Foreground | Effective bg | Ratio | Use | Result |
|---|---|---|---|---|---|
| 1 | `foreground` `#f5f3ff` | `background` `#0A0F1E` | **17.1:1** | Body text on root surface | ✅ AA / AAA |
| 2 | `foreground` `#f5f3ff` | `card` `#15102a` | **15.4:1** | Body text on cards (Settings, Recap, Archive) | ✅ AA / AAA |
| 3 | `mutedForeground` `#9ca0c2` | `background` `#0A0F1E` | **7.3:1** | Subtitle / helper text | ✅ AA |
| 4 | `mutedForeground` `#9ca0c2` | `card` `#15102a` | **6.6:1** | Subtitle on cards | ✅ AA |
| 5 | `primary` `#9B7AE8` | `background` `#0A0F1E` | **5.7:1** | Brand purple icon / link on root | ✅ AA |
| 6 | `primary` `#9B7AE8` | `card` `#15102a` | **5.6:1** | Brand purple icon / link on cards | ✅ AA |
| 7 | `accent` `#00E5FF` | `background` `#0A0F1E` | **12.2:1** | Cyan "Mem" highlights, success states | ✅ AA / AAA |
| 8 | `accent` `#00E5FF` | `card` `#15102a` | **12.0:1** | Cyan on cards | ✅ AA / AAA |
| 9 | `primaryAction` `#5266eb` text **white** | filled button | **5.0:1** (white on `#5266eb`) | GradientButton primary CTA | ✅ AA |
| 10 | `destructive` `#f87171` | `background` `#0A0F1E` | **6.8:1** | Error / delete affordance | ✅ AA |
| 11 | `border` `#241a47` | `background` `#0A0F1E` | **1.2:1** | Card edge — non-text, decorative only | ⚠ Decorative — see fix |
| 12 | `secondaryForeground` `#e9e4ff` | `secondary` `#1f1740` | **12.4:1** | Chip text | ✅ AA / AAA |

### Onboarding palette (warm "organized chaos" sub-theme)

| # | Foreground | Effective bg | Ratio | Use | Result |
|---|---|---|---|---|---|
| 13 | `onboarding.text` `#F4EEFF` | `onboarding.bg` `#0A0F1E` | **16.8:1** | Stage body copy | ✅ AAA |
| 14 | `onboarding.textMuted` `#9B91B5` | `onboarding.bg` `#0A0F1E` | **6.0:1** | Stage subtitle | ✅ AA |
| 15 | `onboarding.mem` `#FFD56F` | `onboarding.bg` `#0A0F1E` | **12.9:1** | Mem golden highlight | ✅ AAA |
| 16 | `onboarding.hot` `#B47AFF` | `onboarding.bg` `#0A0F1E` | **6.6:1** | Hot purple accent | ✅ AA |
| 17 | `onboarding.cool` `#6FE5FF` | `onboarding.bg` `#0A0F1E` | **12.7:1** | Cool cyan accent | ✅ AAA |
| 18 | `onboarding.pink` `#FF8FB1` | `onboarding.bg` `#0A0F1E` | **7.7:1** | Pink relationship accent | ✅ AA / AAA |
| 19 | `onboarding.text` `#F4EEFF` | glass card `rgba(180,122,255,0.10)` over bg | **15.0:1** (composite bg ≈ `#1f1828`) | Glass card body text | ✅ AAA |
| 20 | `onboarding.textMuted` `#9B91B5` | glass card | **5.4:1** (composite bg ≈ `#1f1828`) | Glass card subtitle | ✅ AA |

### Brand-bible alignment (BRAND.md → in-code, Task #349)

The in-code dark tokens were re-aligned to the BRAND.md cosmic palette
in Task #349. The base / primary / accent rows above (1, 5–8) now use
the canonical brand-bible values directly. The remaining secondary
swatches (`card`, `secondary`, `muted`, `border`, `input`) keep their
existing slightly-warmer purple-tinted hexes — they were already inside
AA on the new background and shifting them was out of scope for the
alignment pass.

| # | Foreground | Background | Ratio | Result |
|---|---|---|---|---|
| 21 | `#00E5FF` (brand cyan) | `#0A0F1E` (brand navy) | **12.2:1** | ✅ AAA |
| 22 | `#9B7AE8` (brand purple) | `#0A0F1E` (brand navy) | **5.7:1** | ✅ AA |
| 23 | `#00E5FF` on glass `rgba(255,255,255,0.06)` over `#0A0F1E` | composite ≈ `#1A2030` | **9.8:1** | ✅ AAA |
| 24 | `#9B7AE8` on glass | composite ≈ `#1A2030` | **4.6:1** | ✅ AA |

Brand cyan and brand purple both clear AA on cosmic navy and on the
standard glassmorphic surface. **No desaturated variant required.** The
hero brand cyan (`#00E5FF`) stays the hero.

---

## Decisions applied

1. **Pure white retired as a body-text default.** `foreground` is now
   `#f5f3ff` (and `#FAFAFF` in High Contrast). Pure `#FFFFFF` survives
   only inside fully-saturated CTA fills (`primaryAction` blue,
   GradientButton, capture FAB) where it sits on a high-saturation
   background and the contrast against the brand surround makes the
   off-white read as dim. This matches the Apple HIG guidance for
   "white text inside a coloured pill" surfaces and was kept on
   purpose — see `app/(app)/(tabs)/index.tsx` (Quick Capture FAB) and
   `components/GradientButton.tsx` (primary variant).
2. **Border `#241a47` is decorative.** It sits at 1.2:1 against root
   background — fine for a card edge, never used for text or for
   meaningful UI state. High Contrast lifts it to `#3A2F70` (1.6:1) so
   low-vision users still get a perceptible card edge in bright ambient
   light. (The brand-bible alignment in Task #349 darkened the root
   background slightly, which compresses the standard border ratio
   below the 3:1 component-contrast band; raising the border hex into
   that band on the new navy is tracked as a follow-up.)
3. **No accent desaturation needed.** Brand cyan and brand purple both
   already clear AA on every surface they're rendered on (verified
   above against worst-case glass composites).
4. **High Contrast toggle.** Added to Settings → Preferences card.
   Persisted per-user alongside `soundEnabled` / `memMuted` in
   `SettingsContext`. Reads through `useColors()` so every screen picks
   it up automatically — there is no per-screen wiring.

---

## High Contrast variant — verified deltas

| # | Foreground | Background | Standard | High Contrast | Δ |
|---|---|---|---|---|---|
| 25 | `foreground` | `background` | 17.1:1 | **17.9:1** (`#FAFAFF` on `#0A0F1E`) | + |
| 26 | `mutedForeground` | `background` | 7.3:1 | **10.3:1** (`#C8CCE6` on `#0A0F1E`) | +3.0 |
| 27 | `mutedForeground` | `card` | 6.6:1 | **9.3:1** (`#C8CCE6` on `#15102a`) | +2.7 |
| 28 | `primary` | `card` | 5.6:1 | **8.0:1** (`#C0AFFF` on `#15102a`) | +2.4 |
| 29 | `accent` | `card` | 12.0:1 | **13.0:1** (`#7DF3DD` on `#15102a`) | +1.0 |
| 30 | `border` | `background` | 1.2:1 | **1.6:1** (`#3A2F70` on `#0A0F1E`) | +0.4 |
| 31 | `onboarding.textMuted` | `onboarding.bg` | 6.0:1 | **9.0:1** (`#C8C0DC` on `#0A0F1E`) | +3.0 |
| 32 | `onboarding.hot` | `onboarding.bg` | 6.6:1 | **8.7:1** (`#C99CFF` on `#0A0F1E`) | +2.1 |

Every standard text pairing already passes AA; High Contrast pushes the
borderline ones into the AAA range. Card-edge contrast against the
brand-bible navy (rows 11 and 30) is now compressed below the 3:1
component band — the border is still visible but improving it is
tracked as a follow-up to the Task #349 alignment.

---

## Screens walked

The following surfaces were inventoried during this pass. Each one
re-uses tokens from the matrices above; no screen introduces a custom
hex outside the documented exceptions (`#FFFFFF` inside saturated CTA
pills).

- `(tabs)/index.tsx` — Home (greeting, Quick Capture FAB, Mem strip).
- `(tabs)/archive.tsx` — Memory list, facet chips, illustration cards.
- `(tabs)/progress.tsx` — Streak, heatmap, milestones.
- `(tabs)/settings.tsx` — All preference rows, glassmorphic header.
- `(tabs)/ai-guide.tsx` + `components/ChatThread.tsx` — Mem chat
  bubbles, typing indicator, send button (white-on-blue CTA exception).
- `(app)/capture.tsx`, `voice-capture.tsx`, `log-call.tsx` — Capture
  forms.
- `(app)/recap.tsx`, `insights.tsx` — Daily / monthly recap views.
- `(app)/memory-match.tsx`, `game-24.tsx` — Brain games board + level
  ladder + result overlay.
- `(app)/wellness.tsx`, `tip-archive.tsx` — Mood + tip surfaces.
- `(app)/subscription.tsx` — Paywall (white-on-blue CTA exception).
- `(app)/about.tsx`, `support.tsx`, `licenses.tsx`,
  `edit-profile.tsx` — Static info screens.
- `onboarding.tsx`, `onboarding-chat.tsx` — Warm onboarding sub-theme.
- `login.tsx`, `forgot-password.tsx`, `+not-found.tsx` — Auth /
  fallback (mounted outside the Settings provider; `useColors()`
  defaults to standard contrast in that case).

---

## Out of scope (future tasks)

- **Light mode.** Tracked separately. The cosmic identity is dark-only
  by design.
- **Reduce-motion.** Animation accessibility is its own concern.
- **Border re-tune for cosmic navy.** Now that the root background is
  the brand-bible navy `#0A0F1E`, the existing `border #241a47` and
  HC `#3A2F70` no longer reach the 3:1 component-contrast band. Lifting
  border (and possibly `card`/`secondary`/`muted`) into a slightly
  cooler navy-tinted scale is a follow-up.
