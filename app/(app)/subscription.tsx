import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { AliveButton } from "@/components/alive/AliveButton";
import { AmbientBlobs } from "@/components/alive/AmbientBlobs";
import { GradientBackground } from "@/components/alive/GradientBackground";
import { RotatingBrandMark } from "@/components/alive/RotatingBrandMark";
import { ProCelebrationOverlay } from "@/components/ProCelebrationOverlay";
import { LiftPress } from "@/components/alive/LiftPress";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/context/SubscriptionContext";
import { useMemories } from "@/context/MemoriesContext";
import { getIllustrationQuotaState } from "@/lib/captureLimits";
import {
  resolvePaymentRail,
  type PaymentRail,
} from "@/lib/subscription";
import {
  formatPackagePricing,
  getProPackages,
  isRevenueCatConfigured,
  type PackagePricingDisplay,
  type ProPackages,
} from "@/lib/revenuecat";
import { useHandleRestore } from "@/lib/useHandleRestore";
import { useHandleUpgrade } from "@/lib/useHandleUpgrade";
import { useHandleManageSubscription } from "@/lib/useHandleManageSubscription";
import { trackEvent } from "@/lib/analytics";
import { formatLongDate } from "@/lib/dates";
import { RestorePurchasesButton } from "@/components/subscription/RestorePurchasesButton";
import {
  getPrivacyPolicyUrl,
  getTermsOfServiceUrl,
  openLegalUrl,
} from "@/lib/legal";

/**
 * Pro feature list shown on the upgrade hero. Returned as a function
 * (not a module-level const) so the "No daily capture limit" body
 * can interpolate the live free-tier cap from
 * `useSubscription().freeDailyCaptureLimit` (Task #185). Without
 * this the screen would silently keep saying "no throttle" while
 * on-call ships a runtime override that bumps the cap to e.g. 20 —
 * exactly the inconsistency Task #144 was meant to remove from the
 * home counter and the in-flow upsells.
 */
function getProFeatures(freeDailyCaptureLimit: number): {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  body: string;
}[] {
  return [
    {
      icon: "calendar-outline",
      text: "31-day memory library",
      body: "Scroll back a full month of memories, recaps, and insights.",
    },
    {
      icon: "sparkles-outline",
      text: "Deeper daily recaps",
      body: "Richer AI summaries that connect the dots across your day.",
    },
    {
      icon: "infinite-outline",
      text: "No daily capture limit",
      body: `Free tier stops at ${freeDailyCaptureLimit} memories a day — Pro lets you capture as many as you want.`,
    },
    {
      icon: "cloud-done-outline",
      text: "Priority cloud sync",
      body: "Your memories stay in sync across all your devices, instantly.",
    },
  ];
}

const PRO_CELEBRATION_UNLOCKS: string[] = [
  "No daily capture limit",
  "31-day memory library",
  "Priority recap depth",
];

// Clarity Seeker variant copy (Task #64). Trial fallback is rendered
// client-side until App Store Connect is configured for a 14-day intro;
// once it is, `formatPackagePricing` populates `pricing.freeTrial` and
// the fallback is bypassed automatically.
const HERO_HEADLINE = "Stop losing your thoughts. Start understanding yourself.";
const HERO_SUBTITLE =
  "Your memories become a 31-day library and richer recaps that connect the dots across your day.";
const ANNUAL_FREE_TRIAL_FALLBACK = "14 days free, then $29.99/year";

// Cyan accent matches `C.cyan` in the mockup shell.
const PAYWALL_CYAN = "#5eead4";
const PAYWALL_CYAN_GLOW = "rgba(94, 234, 212, 0.45)";
const PAYWALL_CYAN_TEXT = "#7df0db";

function Shimmer() {
  const colors = useColors();
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1000 }),
        withTiming(0.3, { duration: 1000 }),
      ),
      -1,
      true,
    );
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[styles.shimmerLine, style, { backgroundColor: colors.muted }]}
    />
  );
}

function formatRenewalDate(iso: string): string | null {
  // Delegates to the shared `lib/dates.ts` formatter so renewal dates
  // pick up the same en-US locale + YYYY-MM-DD parsing rules as every
  // other date in the app. Returning `null` for invalid input is
  // preserved because the call site uses it as a hide/show signal.
  if (!iso) return null;
  const formatted = formatLongDate(iso);
  return formatted === "" ? null : formatted;
}

// CTA copy comes from the SDK price; on the Stripe rail we don't
// fabricate pricing. When Annual is selected with a free trial we flip
// to "Start N-day free trial", parsing N from the trial string itself
// so an App Store change (e.g. 7-day) flows through with no code edit.
function ctaLabel(
  isApple: boolean,
  selectedPlan: "monthly" | "annual",
  monthlyPricing: PackagePricingDisplay | null,
  annualPricing: PackagePricingDisplay | null,
  annualHasFreeTrial: boolean,
): string {
  if (!isApple) return "Upgrade to MemTool Pro";
  if (selectedPlan === "annual" && annualHasFreeTrial) {
    const trialStr = annualPricing?.freeTrial ?? ANNUAL_FREE_TRIAL_FALLBACK;
    const match = trialStr.match(/^(\d+\s+(?:day|days|week|weeks|month|months|year|years))/i);
    return match ? `Start ${match[1]} free trial` : "Start free trial";
  }
  const pricing =
    selectedPlan === "annual"
      ? annualPricing ?? monthlyPricing
      : monthlyPricing ?? annualPricing;
  if (!pricing) return "Continue to Apple checkout";
  return `Continue · ${pricing.headlinePrice}${pricing.cadence}`;
}

/**
 * Single plan-option card. Pure presentational: it owns its own
 * selection visuals (border + check glyph) and surfaces a tap to the
 * parent. Pricing is rendered ONLY from the passed `pricing` object;
 * any future "$/period" rendering happens upstream in
 * `formatPackagePricing` so currency and intro-offer formatting stay
 * in one place.
 */
function PlanOption(props: {
  label: string;
  pricing: PackagePricingDisplay;
  badge: string | null;
  // When set, the card uses `accent` for the badge bg, the border, the
  // selected-state glow, and the radio icon. Used by the Annual card on
  // the Clarity Seeker variant to lift it above Monthly.
  accent?: string;
  // When true, the card is dimmed/recessed when not selected (Monthly).
  recessed?: boolean;
  selected: boolean;
  onSelect: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { label, pricing, badge, accent, recessed, selected, onSelect, colors } = props;
  // Sentence-case accent pill (Task #311). The badge is now a tinted
  // accent chip — soft accent fill at low alpha, accent-coloured text
  // — so "Most popular" feels like a quiet recommendation in the Mem
  // voice rather than a shouty ALL-CAPS marketing stamp. The pre-#311
  // styling kept the badge text in primaryForeground on a saturated
  // accent background which was the only ALL-CAPS-feeling element on
  // the paywall (audit Round 1).
  const badgeAccent = accent ?? colors.primary;
  const badgeBgColor = badgeAccent + "22";
  const badgeFgColor = badgeAccent;
  const borderColor = accent ?? (selected ? colors.primary : colors.border);
  const radioColor = accent ?? (selected ? colors.primary : colors.mutedForeground);
  return (
    <LiftPress
      onPress={onSelect}
      style={[
        styles.planOption,
        {
          backgroundColor: colors.card,
          borderColor,
          borderWidth: accent ? 2 : 1,
        },
        accent && selected && styles.planOptionAccentSelected,
        accent && !selected && styles.planOptionAccentIdle,
        recessed && !selected && styles.planOptionRecessed,
        selected && !accent && styles.planOptionSelected,
      ]}
      // Paywall tier cards — Mercury Recipe E full recipe. The base
      // `planOption` style now defines shadowColor/offset/radius (without
      // shadowOpacity/elevation) so LiftPress can animate the iOS opacity
      // and Android elevation on the Monthly card too. The accent (yearly)
      // variant overrides those geometry values with its cyan glow.
      liftShadow
      accessibilityLabel={`${label} plan ${pricing.headlinePrice} ${pricing.cadence}${selected ? " (selected)" : ""}`}
    >
      <View style={styles.planOptionHeader}>
        <View style={styles.planOptionLabelWrap}>
          <Text style={[styles.planOptionLabel, { color: colors.foreground }]}>
            {label}
          </Text>
          {badge !== null && (
            <View
              style={[
                styles.planOptionBadge,
                { backgroundColor: badgeBgColor },
              ]}
            >
              <Text
                style={[
                  styles.planOptionBadgeText,
                  { color: badgeFgColor },
                ]}
              >
                {badge}
              </Text>
            </View>
          )}
        </View>
        <Ionicons
          name={selected ? "radio-button-on" : "radio-button-off"}
          size={22}
          color={radioColor}
        />
      </View>
      <View style={styles.planOptionPriceRow}>
        <Text style={[styles.planOptionPrice, { color: colors.foreground }]}>
          {pricing.headlinePrice}
        </Text>
        <Text
          style={[
            styles.planOptionCadence,
            { color: colors.mutedForeground },
          ]}
        >
          {pricing.cadence}
        </Text>
      </View>
      {pricing.freeTrial !== null && (
        <Text
          style={[styles.planOptionFreeTrial, { color: PAYWALL_CYAN_TEXT }]}
          numberOfLines={2}
        >
          {pricing.freeTrial}
        </Text>
      )}
      {pricing.freeTrial === null && pricing.introOffer !== null && (
        <Text
          style={[styles.planOptionIntro, { color: colors.primary }]}
          numberOfLines={2}
        >
          Intro offer: {pricing.introOffer}
        </Text>
      )}
      {pricing.pricePerMonth !== null && label !== "Monthly" && (
        <Text
          style={[
            styles.planOptionPerMonth,
            { color: colors.mutedForeground },
          ]}
        >
          {pricing.pricePerMonth}/month equivalent
        </Text>
      )}
      {label === "Monthly" && pricing.freeTrial === null && (
        <Text
          style={[
            styles.planOptionPerMonth,
            { color: colors.mutedForeground },
          ]}
        >
          No free trial
        </Text>
      )}
    </LiftPress>
  );
}

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { status, isLoading, error, refresh, freeDailyCaptureLimit } =
    useSubscription();
  const { illustrationsUsedToday, illustrationsLimit } = useMemories();

  // Live Pro-feature list (Task #185). Recomputed when the server's
  // free-tier cap changes (or the persisted offline value hydrates)
  // so the "No daily capture limit" body always shows the current
  // cap users are escaping by upgrading. Memoized so the
  // featureList map below doesn't get a fresh array reference on
  // every unrelated re-render.
  const proFeatures = useMemo(
    () => getProFeatures(freeDailyCaptureLimit),
    [freeDailyCaptureLimit],
  );

  // Action state is local to the screen — the context only owns the
  // tier read. `paymentsConfigured` stays threaded through the upgrade
  // / manage / restore hooks so a "rail not configured" failure can be
  // tracked and surfaced as an inline error, but the screen no longer
  // swaps into a fallback "coming soon" mode — the Apple rail always
  // renders the real RevenueCat-backed CTA per App Store submission
  // requirements.
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [paymentsConfigured, setPaymentsConfigured] = useState<boolean | null>(
    null,
  );

  // Apple-rail product catalog. We load both packages once on focus
  // and cache them in screen state — the SDK call is cheap but it's
  // an async network hop, so we don't want to refetch on every
  // re-render. `selectedPlan` defaults to "annual" because that's the
  // option App Store guidelines say should be highlighted by default
  // when an annual exists (it's the better-value choice). Selection
  // is screen-local; nothing else in the app cares.
  const [proPackages, setProPackages] = useState<ProPackages>({
    monthly: null,
    annual: null,
  });
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">(
    "annual",
  );

  // Refresh on every focus so coming back from Stripe (which suspends
  // the app on native and opens a new tab on web) reflects the new
  // tier without a manual reload. Apple IAP doesn't leave the app at
  // all, but the post-purchase refresh inside the handler covers that.
  // We also reload the RevenueCat package catalog here — it's cheap
  // and guarantees the price labels stay in sync if Apple ships a
  // price change while the screen is mounted.
  useFocusEffect(
    useCallback(() => {
      refresh();
      let alive = true;
      (async () => {
        if (!isRevenueCatConfigured()) {
          if (alive) setPackagesLoaded(true);
          return;
        }
        try {
          const pkgs = await getProPackages();
          if (alive) {
            setProPackages(pkgs);
            setPackagesLoaded(true);
          }
        } catch {
          if (alive) setPackagesLoaded(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [refresh]),
  );

  // Per-render decision so a server-side `payment_platform` flip on
  // refresh swaps the buttons without remounting.
  const rail: PaymentRail = useMemo(() => resolvePaymentRail(status), [status]);

  // Funnel entry point. Fires once per focus (so navigating away and
  // back counts as a separate visit). Values come from refs so the
  // focus callback stays stable across `rail` / `is_pro` changes that
  // happen as the cached subscription status hydrates — otherwise the
  // event would re-fire every time the status updated within the same
  // visit.
  const paywallViewContextRef = useRef({ rail, isPro: status?.is_pro === true });
  paywallViewContextRef.current = { rail, isPro: status?.is_pro === true };
  useFocusEffect(
    useCallback(() => {
      trackEvent("pro_paywall_viewed", {
        rail: paywallViewContextRef.current.rail,
        is_pro: paywallViewContextRef.current.isPro,
      });
    }, []),
  );

  // Pre-format both pricing displays so the JSX stays readable. Each
  // line goes through `formatPackagePricing` — there are NO hardcoded
  // currency strings anywhere downstream.
  const monthlyPricing: PackagePricingDisplay | null = useMemo(
    () => (proPackages.monthly ? formatPackagePricing(proPackages.monthly) : null),
    [proPackages.monthly],
  );
  // Inject the variant-locked trial fallback only when the SDK doesn't
  // already report a free-trial intro phase.
  const annualPricing: PackagePricingDisplay | null = useMemo(() => {
    if (!proPackages.annual) return null;
    const sdk = formatPackagePricing(proPackages.annual);
    return sdk.freeTrial === null
      ? { ...sdk, freeTrial: ANNUAL_FREE_TRIAL_FALLBACK }
      : sdk;
  }, [proPackages.annual]);
  const annualHasFreeTrial =
    annualPricing !== null && annualPricing.freeTrial !== null;

  // Upgrade button wiring. The rail-specific decision logic lives in
  // `runUpgradeFlow` (lib/upgradeFlow.ts); the screen-side side-effect
  // wiring (state, refresh, celebration overlay, post-purchase
  // re-poll, conversion analytics + funnel events, haptics) lives in
  // `useHandleUpgrade` (lib/useHandleUpgrade.ts) so all five outcome
  // branches stay covered by the unit tests.
  const handleUpgrade = useHandleUpgrade({
    rail,
    selectedPlan,
    proPackages,
    monthlyPricing,
    annualPricing,
    refresh,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    setCelebrationVisible,
    actionPending,
  });

  // Manage-subscription button wiring. Decision logic lives in
  // `runManageFlow` (lib/manageSubscriptionFlow.ts); the screen-side
  // side-effect wiring (state setters + error haptic) lives in
  // `useHandleManageSubscription` (lib/useHandleManageSubscription.ts)
  // so all four outcome branches stay covered by the unit tests.
  const handleManage = useHandleManageSubscription({
    rail,
    setActionError,
    setActionPending,
    setPaymentsConfigured,
    actionPending,
  });

  // Apple App Review (3.1.1) requires the "Restore Purchases" callback
  // to handle four branches with the right inline message. The decision
  // logic + state-mapping lives in `useHandleRestore` (lib/useHandleRestore.ts)
  // so the four branches can be unit-tested at the screen level via a
  // tiny test host, instead of being trapped inside this 1300-line
  // component.
  const handleRestore = useHandleRestore({
    paymentsConfigured,
    setPaymentsConfigured,
    refresh,
    setActionError,
    setActionPending,
    setRestoreSuccess,
    actionPending,
  });

  // Render precedence (rule #9): isLoading&&!status -> error&&!status -> populated.
  // Inline "Couldn't refresh" banner sits above the populated card when
  // a refresh fails after we already had data.
  const showInitialLoading = isLoading && !status;
  const showError = !isLoading && error !== null && status === null;
  const showRefreshErrorBanner =
    !isLoading && error !== null && status !== null;
  const isPro = status?.is_pro === true;
  const renewalLabel =
    status?.pro_expires != null ? formatRenewalDate(status.pro_expires) : null;

  // Mirror the same illustration-quota meter the home, archive, and
  // capture screens render. All math + wording (including
  // pluralization and the "Upgrade for unlimited illustrations"
  // upsell) lives in `getIllustrationQuotaState` so a wording tweak
  // on any one surface flows through here too. `quota.visible`
  // collapses both gates ("free tier" AND "server gave us a cap")
  // into one flag, so this stays hidden for Pro users — the upgrade
  // screen never advertises a cap a Pro user no longer has. No tap
  // target on this surface: we're already on the upsell screen, so
  // routing to /subscription would be a no-op.
  const illustrationQuota = getIllustrationQuotaState(
    illustrationsUsedToday,
    illustrationsLimit,
    isPro,
  );

  // Rail-specific copy. Kept as inline maps rather than a switch so a
  // future rail (e.g. Play Billing) drops in with one new entry.
  const isApple = rail === "apple";
  const upgradeFootnote = isApple
    ? "Payments are processed by Apple. You'll complete checkout in the App Store sheet without leaving MemTool."
    : "Payments are processed by Stripe. You'll complete checkout in your browser and come back here when you're done.";
  // Variant subtitle is shared across both rails — it describes the
  // product, not the payment path. Cancellation messaging now lives in
  // the Apple footnote + the "Cancel anytime" trust line.
  const subtitleCopy = HERO_SUBTITLE;
  const manageButtonLabel = isApple
    ? "Manage in App Store"
    : "Manage Subscription";

  return (
    <View style={styles.screenRoot}>
    <SettleOnMount
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          MemTool Pro
        </Text>
        <Pressable
          onPress={refresh}
          style={styles.refreshButton}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="refresh" size={24} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
      >
        {showRefreshErrorBanner && (
          <View
            style={[
              styles.refreshErrorBanner,
              {
                backgroundColor: colors.card,
                borderColor: colors.destructive,
              },
            ]}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={colors.destructive}
            />
            <Text
              style={[styles.refreshErrorText, { color: colors.foreground }]}
              numberOfLines={2}
            >
              Couldn't refresh: {error}
            </Text>
            <TouchableOpacity
              onPress={refresh}
              hitSlop={8}
              style={styles.refreshErrorRetry}
            >
              <Text
                style={[styles.refreshErrorRetryText, { color: colors.primary }]}
              >
                Try again
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {showInitialLoading && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.loadingContainer}>
              <Ionicons
                name="sparkles"
                size={32}
                color={colors.primary}
                style={styles.sparkleIcon}
              />
              <Text style={[styles.loadingTitle, { color: colors.foreground }]}>
                Loading your plan...
              </Text>
              <View style={styles.shimmerContainer}>
                <Shimmer />
                <Shimmer />
                <Shimmer />
              </View>
            </View>
          </View>
        )}

        {showError && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.resultHeader}>
              <Ionicons
                name="alert-circle"
                size={24}
                color={colors.destructive}
              />
              <Text style={[styles.resultTitle, { color: colors.destructive }]}>
                Couldn't load your plan
              </Text>
            </View>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>
              {error}
            </Text>
            <TouchableOpacity
              onPress={refresh}
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.retryButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Try again
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {status !== null && (
          <>
            {isPro ? (
              <View
                style={[
                  styles.heroCard,
                  styles.heroCardClipped,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <View
                  pointerEvents="none"
                  style={StyleSheet.absoluteFill}
                >
                  <GradientBackground style={StyleSheet.absoluteFill} />
                  <AmbientBlobs />
                  <RotatingBrandMark
                    size={320}
                    color={colors.primary}
                    baseOpacity={0.09}
                  />
                </View>
                <View style={styles.proBadgeRow}>
                  <LinearGradient
                    colors={["#a78bfa", "#5eead4"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.proBadge}
                  >
                    <Ionicons
                      name="star"
                      size={14}
                      color="#0a0612"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </LinearGradient>
                </View>
                <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                  You're on MemTool Pro
                </Text>
                <Text
                  style={[
                    styles.heroSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Thanks for supporting the project. Every Pro feature is
                  unlocked on this account.
                </Text>
                {renewalLabel !== null && (
                  <Text
                    style={[styles.metaText, { color: colors.mutedForeground }]}
                  >
                    Renews {renewalLabel}
                  </Text>
                )}
              </View>
            ) : (
              <View
                style={[
                  styles.heroCard,
                  styles.heroCardClipped,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  pointerEvents="none"
                  style={StyleSheet.absoluteFill}
                >
                  <GradientBackground style={StyleSheet.absoluteFill} />
                  <AmbientBlobs />
                  <RotatingBrandMark
                    size={320}
                    color={colors.primary}
                    baseOpacity={0.09}
                  />
                </View>
                <Ionicons
                  name="sparkles"
                  size={32}
                  color={colors.primary}
                  style={{ marginBottom: 12 }}
                />
                <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                  {HERO_HEADLINE}
                </Text>
                <Text
                  style={[
                    styles.heroSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {subtitleCopy}
                </Text>

                {illustrationQuota.visible && (
                  <View
                    style={[
                      styles.illustrationQuotaRow,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    accessibilityLabel={
                      illustrationQuota.atLimit
                        ? illustrationQuota.upsellLabel
                        : illustrationQuota.label
                    }
                  >
                    <Ionicons
                      name={
                        illustrationQuota.atLimit ? "lock-closed" : "sparkles"
                      }
                      size={16}
                      color={
                        illustrationQuota.atLimit
                          ? colors.mutedForeground
                          : "#a78bfa"
                      }
                    />
                    <Text
                      style={[
                        styles.illustrationQuotaText,
                        {
                          color: illustrationQuota.atLimit
                            ? colors.mutedForeground
                            : colors.foreground,
                        },
                      ]}
                    >
                      {illustrationQuota.atLimit
                        ? illustrationQuota.upsellLabel
                        : illustrationQuota.label}
                    </Text>
                  </View>
                )}

                <View style={styles.featureList}>
                  {proFeatures.map((f, i) => (
                    <View
                      key={f.text}
                      style={[
                        styles.featureRow,
                        i < proFeatures.length - 1 && {
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          paddingBottom: 14,
                        },
                      ]}
                    >
                      <Ionicons name={f.icon} size={20} color={colors.primary} style={{ marginTop: 2 }} />
                      <View style={styles.featureTextBlock}>
                        <Text
                          style={[
                            styles.featureText,
                            { color: colors.foreground },
                          ]}
                        >
                          {f.text}
                        </Text>
                        <Text
                          style={[
                            styles.featureBody,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {f.body}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Purchase-decision block. INTENTIONALLY split into two
                independent conditional renders (rather than a single
                ternary) so the Restore Purchases button below this
                block reads, structurally, as an unambiguous sibling —
                never a nested branch. App Review 3.1.1 requires
                Restore to be present at all times on the Apple
                paywall. The Apple rail always renders the live
                RevenueCat-backed CTA — the legacy disabled-state
                fallback was removed in Task #333. */}
            {isPro && (
              <AliveButton
                onPress={handleManage}
                disabled={actionPending}
                style={[
                  styles.actionButtonWrapper,
                  actionPending && { opacity: 0.6 },
                ]}
                glowColor={colors.primary}
                glowIntensity={0.6}
                screenKey="subscription"
                accessibilityLabel={manageButtonLabel}
              >
                <View
                  style={[
                    styles.outlineButton,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  {actionPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons
                        name={isApple ? "logo-apple" : "card-outline"}
                        size={18}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.outlineButtonText,
                          { color: colors.primary },
                        ]}
                      >
                        {manageButtonLabel}
                      </Text>
                    </>
                  )}
                </View>
              </AliveButton>
            )}
            {!isPro && (
              <>
                {/* Apple-rail two-option chooser. Renders only when
                    on the Apple rail and at least one package
                    resolved. The Stripe rail keeps a single CTA. */}
                {isApple &&
                  packagesLoaded &&
                  (proPackages.monthly || proPackages.annual) && (
                    <View style={styles.planChooser}>
                      <Text
                        style={[
                          styles.planChooserLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Choose your plan
                      </Text>
                      {proPackages.annual && annualPricing && (
                        <PlanOption
                          label="Annual"
                          pricing={annualPricing}
                          badge="Best Value — save 16%"
                          accent={PAYWALL_CYAN}
                          selected={selectedPlan === "annual"}
                          onSelect={() => setSelectedPlan("annual")}
                          colors={colors}
                        />
                      )}
                      {proPackages.monthly && monthlyPricing && (
                        <PlanOption
                          label="Monthly"
                          pricing={monthlyPricing}
                          badge={null}
                          recessed
                          selected={selectedPlan === "monthly"}
                          onSelect={() => setSelectedPlan("monthly")}
                          colors={colors}
                        />
                      )}
                    </View>
                  )}

                <AliveButton
                  onPress={handleUpgrade}
                  disabled={actionPending}
                  style={[
                    styles.actionButtonWrapper,
                    actionPending && { opacity: 0.7 },
                    isApple && annualHasFreeTrial && selectedPlan === "annual" &&
                      styles.actionButtonCyanGlow,
                  ]}
                  glowColor={
                    isApple && annualHasFreeTrial && selectedPlan === "annual"
                      ? PAYWALL_CYAN
                      : "#5266eb"
                  }
                  rippleColor="rgba(255, 255, 255, 0.42)"
                  fillColor={
                    isApple && annualHasFreeTrial && selectedPlan === "annual"
                      ? PAYWALL_CYAN
                      : "#5266eb"
                  }
                  pressedFillColor={
                    isApple && annualHasFreeTrial && selectedPlan === "annual"
                      ? "#3fbfa8"
                      : "#4354c8"
                  }
                  colorDurationMs={200}
                  glowInDurationMs={300}
                  glowOutDurationMs={300}
                  pressScale={1.0}
                  screenKey="subscription"
                  accessibilityLabel={
                    isApple
                      ? selectedPlan === "annual" && annualHasFreeTrial
                        ? "Start 14-day free trial"
                        : selectedPlan === "annual" && annualPricing
                        ? `Continue ${annualPricing.headlinePrice} ${annualPricing.cadence}`
                        : monthlyPricing
                        ? `Continue ${monthlyPricing.headlinePrice} ${monthlyPricing.cadence}`
                        : "Continue to Apple checkout"
                      : "Upgrade to MemTool Pro"
                  }
                >
                  <View style={styles.gradientButton}>
                    {actionPending ? (
                      <ActivityIndicator
                        size="small"
                        color={
                          isApple && annualHasFreeTrial && selectedPlan === "annual"
                            ? "#0a0612"
                            : "#ffffff"
                        }
                      />
                    ) : (
                      <>
                        <Ionicons
                          name="rocket-outline"
                          size={18}
                          color={
                            isApple && annualHasFreeTrial && selectedPlan === "annual"
                              ? "#0a0612"
                              : "#ffffff"
                          }
                        />
                        <Text
                          style={[
                            styles.gradientButtonText,
                            isApple && annualHasFreeTrial && selectedPlan === "annual" &&
                              { color: "#0a0612" },
                          ]}
                        >
                          {ctaLabel(
                            isApple,
                            selectedPlan,
                            monthlyPricing,
                            annualPricing,
                            annualHasFreeTrial,
                          )}
                        </Text>
                      </>
                    )}
                  </View>
                </AliveButton>

                {/* Trust lines gated to (Apple ∧ Annual ∧ free trial)
                    so neither line lies on Monthly or Stripe. */}
                {isApple && annualHasFreeTrial && selectedPlan === "annual" && (
                  <View style={styles.trustLineBlock}>
                    <Text
                      style={[styles.trustLinePrimary, { color: PAYWALL_CYAN_TEXT }]}
                    >
                      Try it free — no charge today
                    </Text>
                    <Text
                      style={[styles.trustLineSecondary, { color: colors.mutedForeground }]}
                    >
                      Cancel anytime. No commitment.
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Restore Purchases — required by Apple's review
                guidelines for any app selling IAP. The visibility
                contract (`isApple && !isPro`, intentionally NOT
                coupled to `paymentsConfigured`) lives in
                RestorePurchasesButton + shouldShowRestoreButton so it
                can be tested independently of this 1300-line screen. */}
            <RestorePurchasesButton
              isApple={isApple}
              isPro={isPro}
              onPress={handleRestore}
              disabled={actionPending}
              textColor={colors.mutedForeground}
              containerStyle={styles.restoreButton}
              textStyle={styles.restoreButtonText}
            />

            {restoreSuccess && (
              <View
                style={[
                  styles.actionErrorBanner,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={[styles.refreshErrorText, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  Purchases restored successfully
                </Text>
              </View>
            )}

            {actionError !== null && (
              <View
                style={[
                  styles.actionErrorBanner,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.destructive,
                  },
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.destructive}
                />
                <Text
                  style={[styles.refreshErrorText, { color: colors.foreground }]}
                  numberOfLines={3}
                >
                  {actionError}
                </Text>
              </View>
            )}

            <Text
              style={[styles.footnote, { color: colors.mutedForeground }]}
            >
              {upgradeFootnote}
            </Text>

            {isApple && (
              <Text
                style={[styles.footnote, { color: colors.mutedForeground }]}
              >
                Payment will be charged to your Apple ID at confirmation of
                purchase. Subscription automatically renews unless canceled at
                least 24 hours before the end of the current period. Your
                account may be charged for renewal within 24 hours before the
                end of the current period. You can manage or cancel your
                subscription in your App Store account settings.
              </Text>
            )}

            <View style={styles.legalLinkRow}>
              <Pressable
                onPress={() => openLegalUrl(getTermsOfServiceUrl())}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="Open Terms of Service"
              >
                <Text
                  style={[
                    styles.legalLink,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Terms of Service
                </Text>
              </Pressable>
              <Text
                style={[styles.footnote, { color: colors.mutedForeground }]}
              >
                ·
              </Text>
              <Pressable
                onPress={() => openLegalUrl(getPrivacyPolicyUrl())}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="Open Privacy Policy"
              >
                <Text
                  style={[
                    styles.legalLink,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Privacy Policy
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SettleOnMount>
    <ProCelebrationOverlay
      visible={celebrationVisible}
      onDismiss={() => {
        setCelebrationVisible(false);
        router.back();
      }}
      unlocks={PRO_CELEBRATION_UNLOCKS}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
  },
  backButton: { padding: spacing.sm },
  refreshButton: { padding: spacing.sm },
  title: {
    ...text.sectionTitle,
  },
  scrollContent: { padding: spacing.lg },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.base,
  },
  heroCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.base,
  },
  // Clip the absolutely-positioned ambient blob layer to the card's
  // rounded corners so the soft circles don't bleed past the border.
  heroCardClipped: {
    overflow: "hidden",
  },
  proBadgeRow: { flexDirection: "row", marginBottom: spacing.base },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    // 10: deliberate one-off, between spacing.sm (8) and spacing.md (12).
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  proBadgeText: {
    color: "#0a0612",
    // 800-weight one-off — Inter only has up to 700 in the bundle, so
    // we keep the explicit Inter_700Bold family pinned.
    fontSize: 12,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  heroTitle: {
    // 22: deliberate one-off, between text.sectionTitle (20) and
    // text.cardTitle (24).
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...text.helperRegular,
    lineHeight: 20,
    marginBottom: spacing.base,
  },
  // Mirrors the home/archive/capture quota row styling so the meter
  // reads as the same UI element across all four surfaces. Uses the
  // page background (not card) for its fill because it sits inside
  // the hero card and needs to recess against `colors.card`.
  illustrationQuotaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  illustrationQuotaText: {
    flex: 1,
    ...text.helper,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  featureList: { gap: 14, marginTop: 4 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  featureTextBlock: { flex: 1 },
  featureText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    marginBottom: 2,
  },
  featureBody: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 18,
  },
  metaText: {
    ...text.caption,
    marginTop: 4,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
  },
  sparkleIcon: { marginBottom: spacing.base },
  loadingTitle: {
    ...text.cardHeading,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: spacing.xl,
  },
  shimmerContainer: { width: "100%", gap: spacing.base },
  // 8: deliberate one-off corner — shimmer pill is shorter than card
  // surfaces, so it doesn't use a radius token.
  shimmerLine: { height: 16, borderRadius: 8, width: "100%" },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  resultTitle: {
    ...text.cardHeading,
  },
  bodyText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 22,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: spacing.base,
  },
  retryButtonText: {
    ...text.helper,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  planChooser: { gap: spacing.md, marginBottom: spacing.base },
  planChooserLabel: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 4,
  },
  planOption: {
    // 18: deliberate one-off, between radius.md (16) and radius.lg (24).
    borderRadius: 18,
    borderWidth: 1.5,
    padding: spacing.base,
    // Baseline shadow geometry (color/offset/radius) so LiftPress's
    // Mercury Recipe E animation has something to drive on iOS for the
    // non-accent (Monthly) variant. shadowOpacity / elevation are
    // intentionally omitted so LiftPress falls back to its 0.04 → 0.10
    // and 2 → 6 defaults. The accent (Yearly) variant overrides these
    // geometry values with its cyan glow via planOptionAccent*.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  planOptionSelected: {
    borderWidth: 2,
  },
  planOptionAccentSelected: {
    shadowColor: PAYWALL_CYAN,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
  },
  planOptionAccentIdle: {
    shadowColor: PAYWALL_CYAN,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  planOptionRecessed: {
    opacity: 0.78,
  },
  planOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  planOptionLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 1,
  },
  planOptionLabel: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  planOptionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
  },
  planOptionBadgeText: {
    // 11: deliberate one-off, sized down from text.caption (12).
    // Sentence-case + accent colour (Task #311) — letterSpacing
    // dropped from 0.3 to 0 and weight from 700 to 600 so the chip
    // reads as soft recommendation, not a marketing shout.
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0,
  },
  planOptionPriceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  planOptionPrice: {
    // 22: deliberate one-off, between text.sectionTitle (20) and
    // text.cardTitle (24).
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  planOptionCadence: {
    ...text.helperRegular,
  },
  planOptionIntro: {
    marginTop: 6,
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  planOptionFreeTrial: {
    marginTop: 6,
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  planOptionPerMonth: {
    marginTop: 4,
    ...text.caption,
  },
  trustLineBlock: {
    alignItems: "center",
    gap: 4,
    // 18: deliberate one-off, between spacing.base (16) and spacing.lgCard (20).
    marginBottom: 18,
    marginTop: 4,
  },
  trustLinePrimary: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  trustLineSecondary: {
    ...text.caption,
    textAlign: "center",
  },
  actionButtonWrapper: {
    borderRadius: radius.md,
    overflow: "hidden",
    marginBottom: spacing.base,
  },
  actionButtonCyanGlow: {
    shadowColor: PAYWALL_CYAN_GLOW,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.85,
    shadowRadius: 28,
    elevation: 10,
  },
  gradientButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lgCard,
  },
  gradientButtonText: {
    color: "#ffffff",
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  outlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lgCard,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  outlineButtonText: {
    ...text.body,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  suggestionTitle: {
    ...text.helper,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  suggestionText: {
    // 15: deliberate one-off, between text.helper (14) and text.body (16).
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 22,
  },
  refreshErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    // 14: deliberate one-off, between spacing.md (12) and spacing.base (16).
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  actionErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    // 14: deliberate one-off, between spacing.md (12) and spacing.base (16).
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  refreshErrorText: {
    flex: 1,
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
  },
  refreshErrorRetry: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  refreshErrorRetryText: {
    // 13: deliberate one-off, between text.caption (12) and text.helper (14).
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  restoreButton: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  restoreButtonText: {
    ...text.helper,
    textDecorationLine: "underline",
  },
  footnote: {
    ...text.caption,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  legalLinkRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legalLink: {
    ...text.caption,
    lineHeight: 18,
    textDecorationLine: "underline",
  },
});
