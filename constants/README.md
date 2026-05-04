# MemTool design tokens

This folder is the source of truth for the small set of values every screen in
MemTool should reach for: spacing, radii, typography, and colors. The goal is
not to ban every literal in the app — it is to make sure the values that *do*
repeat across screens stay in sync, and to make deliberate one-offs visible
when they happen.

If you find yourself typing a raw `16`, `24`, or `Inter_700Bold` in a
StyleSheet, stop and check whether one of these tokens already covers it.

## Spacing — `spacing.ts`

The spacing scale is the usual T-shirt sizing most React Native apps converge
on:

```
4 / 8 / 12 / 16 / 20 / 24 / 28 / 32
```

| Token            | Value | Use it for                                                      |
| ---------------- | ----- | --------------------------------------------------------------- |
| `spacing.xs`     | 4     | Hairline gap, icon padding inside a button                      |
| `spacing.sm`     | 8     | Tight stack — icon ↔ label, badge ↔ chip                        |
| `spacing.md`     | 12    | Compact row gap                                                 |
| `spacing.base`   | 16    | Default card padding, default vertical rhythm                   |
| `spacing.lgCard` | 20    | Slightly larger card padding (suggestion / group cards)         |
| `spacing.lg`     | 24    | Outer screen padding, large card padding                        |
| `spacing.xlTight`| 28    | Between major regions when 32 feels loose                       |
| `spacing.xl`     | 32    | Between major regions, large empty-state breathing room         |

Use it like this:

```ts
const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
```

## Radii — `spacing.ts`

| Token       | Value | Use it for                                                   |
| ----------- | ----- | ------------------------------------------------------------ |
| `radius.sm` | 12    | Small / list-style controls (chips, tab segments, recent rows) |
| `radius.md` | 16    | Standard card border radius                                  |
| `radius.lg` | 24    | Large feature cards (capture, recap result, wellness)        |

## Typography — `typography.ts`

Every entry in `text` bundles `fontSize`, `fontWeight`, and `fontFamily`. They
ship together because React Native on Android does **not** auto-substitute
weights — a bare `fontWeight: "700"` without `fontFamily: "Inter_700Bold"`
silently falls back to the system font and looks visibly off next to the rest
of the app. Spreading the token is the only way to keep the three in sync.

```ts
const styles = StyleSheet.create({
  title: {
    ...text.cardTitle,
    color: colors.foreground,
  },
});
```

`lineHeight` and `letterSpacing` are intentionally **not** baked into the
tokens — different surfaces want different rhythm (recap body uses
`lineHeight: 28` for a 16pt body, the fact card uses `20`) — so apply those
locally on the style.

The available tokens, roughly biggest to smallest:

| Token                | Size / Weight | Use it for                                                 |
| -------------------- | ------------- | ---------------------------------------------------------- |
| `text.brand`         | 42 / 700      | App / brand wordmark only                                  |
| `text.screenTitle`   | 28 / 700      | Largest in-screen title (Settings header, Home name)       |
| `text.cardTitle`     | 24 / 700      | Card-level title (Quick Capture, onboarding tagline)       |
| `text.sectionTitle`  | 20 / 600      | Section heading inside a screen ("Train Your Mind")        |
| `text.cardHeading`   | 18 / 700      | Result / recap title, empty-state title                    |
| `text.cardLabel`     | 18 / 600      | Modal / capture screen title, profile email                |
| `text.body`          | 16 / 400      | Standard body copy                                         |
| `text.bodyMedium`    | 16 / 500      | Body emphasised (greeting, nav-card title, settings row)   |
| `text.bodySemibold`  | 16 / 600      | Body emphasised stronger (Save buttons, secondary CTAs)    |
| `text.helper`        | 14 / 500      | Helper / metadata default                                  |
| `text.helperRegular` | 14 / 400      | Helper regular (fact card, suggestion text)                |
| `text.caption`       | 12 / 400      | Settings row subtitle, very small text                     |
| `text.captionStrong` | 12 / 600      | Section labels (THIS MONTH), badge text                    |
| `text.tiny`          | 10 / 400      | Chart axis labels only                                     |

If you need a weight that isn't on a token (e.g. a 16pt bold that doesn't
exist as `text.bodyBold`), use the **spread-then-override** pattern below
rather than hand-rolling the three properties from scratch.

## Spread-then-override: the escape hatch

Most one-off styles are really "an existing token, but with one thing
nudged." Spread the token first so the family/weight/size still come from one
place, then override only the field that needs to change. **When you override
the weight, you must also override the matching `Inter_*` family** for the
same Android reason described above.

A real example, from `components/MemNoticedCard.tsx`:

```ts
cardLabel: {
  ...text.caption,            // 12 / 400 / Inter_400Regular
  fontWeight: "700",          // pin to bold…
  fontFamily: "Inter_700Bold",// …and pin the matching family
  letterSpacing: 1,
  textTransform: "uppercase",
},

modalTitle: {
  ...text.body,               // 16 / 400 / Inter_400Regular
  fontWeight: "700",
  fontFamily: "Inter_700Bold",
},
```

Both styles want a size that already exists on a token (12, 16) but at a
weight the token doesn't ship with. Spreading keeps the size locked to the
scale; the explicit weight + family pair keeps Android honest.

## Colors — `colors.ts`

MemTool is **dark-first**: there is one palette (`dark`), and the light key
in `colors.ts` is currently aliased to it so the app renders the same on
either system appearance. New colors should be added to the `dark` object
— not to a parallel `light` map — until we actually ship a light theme.

Don't import `colors` directly in screens. Read from the `useColors()` hook,
which returns the active palette plus scheme-independent values like
`radius`:

```ts
const c = useColors();
const styles = StyleSheet.create({
  card: {
    backgroundColor: c.card,
    borderColor: c.border,
  },
});
```

The tokens, grouped by role:

| Token                        | Use it for                                                         |
| ---------------------------- | ------------------------------------------------------------------ |
| `background` / `foreground`  | Screen background and the default text color on top of it          |
| `card` / `cardForeground`    | Raised surface (cards, sheets) and text on top of it               |
| `muted` / `mutedForeground`  | Quieter fill (input chrome, subtle chips) and secondary text       |
| `secondary` / `secondaryForeground` | Secondary surfaces (alt cards, selected segments) and text on them |
| `border` / `input`           | Hairline card / divider strokes, and input field fill              |
| `primary` / `primaryForeground` | Brand purple — accents, icons, brand glyphs (see rule below)    |
| `primaryAction` / `primaryActionPressed` | Primary CTA fill — `GradientButton` primary, Quick Capture, "main button on a screen" surfaces; pressed state for the same |
| `accent` / `accentForeground`| Teal accent for highlight/positive states                          |
| `destructive` / `destructiveForeground` | Errors, delete confirmations, destructive CTAs          |
| `onboarding.*`               | Warmer, more saturated sub-palette used **only** by first-run / re-onboarding screens |

### `primary` vs `primaryAction`

These look similar but answer different questions, and screens get this
wrong if they treat them as interchangeable:

- `primary` (purple) — "**what's our brand color?**" Use it for accents,
  icons, brand glyphs, focus rings — anywhere a small splash of brand color
  belongs.
- `primaryAction` (blue) — "**what color is the primary CTA?**" Use it for
  the main button fill on a screen (Quick Capture, `GradientButton` primary
  variant, etc.). Pair with `primaryActionPressed` for the pressed state.

If you're styling a button, you almost always want `primaryAction`. If
you're tinting an icon or a brand mark, you almost always want `primary`.

### Where new colors go

If a screen needs a color that isn't on a token, **add it to `colors.ts`
first** rather than hardcoding a hex literal in the StyleSheet. The whole
point of promoting `primaryAction` out of `GradientButton.tsx` was to make
this file the single source of truth — every new hex that lands in a screen
chips away at that.

The same rules from "Deliberate one-offs" below apply: a true one-off used
in exactly one place can stay inline with a comment, but the moment it
shows up in a second screen, promote it here and give it a role-based name
(`primaryAction`, `cardForeground`) rather than a value-based one
(`blue500`, `gray800`).

## Deliberate one-offs

Sometimes the right answer really is a value that isn't on the scale — a
13pt CTA that sits between `text.caption` (12) and `text.helper` (14), or an
18px gap that sits between `spacing.base` (16) and `spacing.lgCard` (20).

When that happens:

1. Use the literal number directly in the StyleSheet (don't invent a
   one-shot token).
2. Leave a short comment explaining why it's off-scale, so the next
   contributor doesn't "fix" it back to a token and shift the design.

Again from `MemNoticedCard.tsx`:

```ts
cardCta: {
  // 13: deliberate one-off, between text.caption (12) and text.helper (14).
  fontSize: 13,
  fontWeight: "600",
  fontFamily: "Inter_600SemiBold",
},
```

If the same one-off shows up in a second place, that's the signal to promote
it to a real token in this folder rather than copy-pasting the comment.

## Adding to the scale

Before adding a new entry:

- Is the value already covered by an existing token? Use that.
- Is it a true one-off used in one spot? Inline it with a comment (above).
- Is it appearing in two or more places? Add it here, give it a name that
  describes its **role** (`lgCard`, `captionStrong`) rather than its raw
  value, and update the table in this README.
