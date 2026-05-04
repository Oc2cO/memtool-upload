// Ancestor selector prefix that scopes all rules to StyleSheet.create({...}) objects.
// This prevents false positives on non-style objects that happen to use the same
// property names (e.g. API payloads, config objects).
const STYLESHEET_CREATE =
  "CallExpression[callee.object.name='StyleSheet'][callee.property.name='create'] ";

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["react-hooks"],
  extends: ["plugin:react-hooks/recommended"],
  ignorePatterns: [
    "node_modules/",
    "vendor/",
    ".expo/",
    "build/",
    "dist/",
    // Native modules and test helpers — not StyleSheet code
    "lib/",
    "modules/",
    "scripts/",
    "server/",
    // Token definition files are allowed to use raw literals by design
    "constants/spacing.ts",
    "constants/typography.ts",
    "constants/colors.ts",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      // ── Spacing tokens ──────────────────────────────────────────────────────
      // Use spacing.* tokens instead of raw numbers for layout properties.
      // Token scale: xs=4 / sm=8 / md=12 / base=16 / lgCard=20 / lg=24 / xlTight=28 / xl=32
      // To allow a deliberate one-off: // eslint-disable-next-line no-restricted-syntax
      {
        selector:
          STYLESHEET_CREATE +
          "Property[key.name=/^(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap)$/][value.type='Literal'][value.value!=0]",
        message:
          "Use a spacing token (e.g. spacing.md, spacing.lg) instead of a raw number. " +
          "Import from constants/spacing. Add // eslint-disable-next-line no-restricted-syntax for intentional one-offs.",
      },
      // ── Radius tokens ───────────────────────────────────────────────────────
      // Use radius.* tokens: radius.sm=12, radius.md=16, radius.lg=24.
      {
        selector:
          STYLESHEET_CREATE +
          "Property[key.name='borderRadius'][value.type='Literal'][value.value!=0]",
        message:
          "Use a radius token (e.g. radius.md, radius.lg) instead of a raw number. " +
          "Import from constants/spacing. Add // eslint-disable-next-line no-restricted-syntax for intentional one-offs.",
      },
      // ── Typography tokens ────────────────────────────────────────────────────
      // Spread a text token (e.g. ...text.body) instead of setting fontSize,
      // fontWeight, or fontFamily individually — the triplet must stay in sync
      // and Android requires the matching Inter_* family for every weight.
      {
        selector:
          STYLESHEET_CREATE +
          "Property[key.name='fontSize'][value.type='Literal']",
        message:
          "Use a typography token (e.g. ...text.body) instead of a raw fontSize literal. " +
          "Import text from constants/typography. Add // eslint-disable-next-line no-restricted-syntax for intentional one-offs.",
      },
      {
        selector:
          STYLESHEET_CREATE +
          "Property[key.name='fontWeight'][value.type='Literal']",
        message:
          "Use a typography token (e.g. ...text.body) instead of a raw fontWeight literal. " +
          "Import text from constants/typography. Add // eslint-disable-next-line no-restricted-syntax for intentional one-offs.",
      },
      {
        selector:
          STYLESHEET_CREATE +
          "Property[key.name='fontFamily'][value.type='Literal']",
        message:
          "Use a typography token (e.g. ...text.body) instead of a raw fontFamily literal. " +
          "Import text from constants/typography. Add // eslint-disable-next-line no-restricted-syntax for intentional one-offs.",
      },
      // ── Haptics vocabulary ───────────────────────────────────────────────────
      // `Haptics.notificationAsync` bypasses the six AHAP verb signatures
      // (capture, link-formed, streak-extended, day-recap-ready, error, undo)
      // defined in lib/haptics and breaks the unified haptic feel.
      //
      // ✅ Use the named verb hooks instead:
      //    const haptic = useHaptic("capture");   haptic();
      //    const { play } = useHaptics();         play("error");
      //
      // ⚠️  `impactAsync` / `selectionAsync` are still allowed for lightweight
      //    micro-feedback (scroll ticks, slider drags, toggles).
      //
      // 🔑 Escape hatch — if you genuinely need a raw notification buzz, add
      //    the comment on the preceding line so the exception is auditable:
      //    // eslint-disable-next-line no-restricted-syntax
      {
        selector:
          "CallExpression[callee.object.name='Haptics'][callee.property.name='notificationAsync']",
        message:
          "Raw Haptics.notificationAsync() is banned outside lib/haptics. " +
          "Use a named verb hook instead: useHaptic('capture') / useHaptics().play('error'). " +
          "See lib/haptics/index.ts for the full verb vocabulary. " +
          "Add // eslint-disable-next-line no-restricted-syntax on the preceding line for genuine one-off exceptions.",
      },
    ],
  },
};
