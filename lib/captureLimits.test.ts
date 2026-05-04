import {
  ILLUSTRATION_UPSELL_LABEL,
  ILLUSTRATION_OUT_TOAST,
  ILLUSTRATION_OUT_INLINE,
  getCaptureLimitState,
  getIllustrationQuotaState,
} from "./captureLimits";
import { FREE_DAILY_CAPTURE_LIMIT } from "./subscription";

describe("getIllustrationQuotaState", () => {
  it("renders the visible meter with pluralized 'illustrations' for a free user under the cap", () => {
    const s = getIllustrationQuotaState(1, 3, false);
    expect(s.visible).toBe(true);
    expect(s.isPro).toBe(false);
    expect(s.usedToday).toBe(1);
    expect(s.limit).toBe(3);
    expect(s.remainingToday).toBe(2);
    expect(s.atLimit).toBe(false);
    expect(s.label).toBe("2 of 3 illustrations left today");
    expect(s.upsellLabel).toBe(ILLUSTRATION_UPSELL_LABEL);
  });

  it("uses singular 'illustration' when the cap itself is 1", () => {
    // Pluralization tracks the cap, not `remainingToday`, so the
    // noun doesn't flicker between singular and plural as the
    // counter ticks down. "1 of 1 illustration left today" reads
    // singular; "1 of 3 illustrations left today" reads plural.
    const sCap1 = getIllustrationQuotaState(0, 1, false);
    expect(sCap1.label).toBe("1 of 1 illustration left today");

    const sCap3 = getIllustrationQuotaState(2, 3, false);
    expect(sCap3.remainingToday).toBe(1);
    expect(sCap3.label).toBe("1 of 3 illustrations left today");
  });

  it("flips atLimit at exactly the cap and reports 0 remaining", () => {
    const s = getIllustrationQuotaState(3, 3, false);
    expect(s.atLimit).toBe(true);
    expect(s.remainingToday).toBe(0);
    // Plural stays plural at zero so the noun doesn't flip as the
    // user ticks down to the cap.
    expect(s.label).toBe("0 of 3 illustrations left today");
  });

  it("clamps remainingToday to zero when the server count overshoots the cap", () => {
    const s = getIllustrationQuotaState(99, 3, false);
    expect(s.atLimit).toBe(true);
    expect(s.remainingToday).toBe(0);
    expect(s.label).toBe("0 of 3 illustrations left today");
  });

  it("hides the row entirely for Pro users (limit === null sentinel)", () => {
    const s = getIllustrationQuotaState(0, null, true);
    expect(s.visible).toBe(false);
    expect(s.atLimit).toBe(false);
    expect(s.limit).toBeNull();
    expect(s.label).toBe("");
  });

  it("never flips atLimit for Pro users even if a stale numeric limit lingers", () => {
    // Defense-in-depth: if a Pro upgrade lands while the cached
    // limit is still a number, we still must not show "at the cap"
    // on a Pro user's screen.
    const s = getIllustrationQuotaState(99, 3, true);
    expect(s.visible).toBe(false);
    expect(s.atLimit).toBe(false);
  });

  it("clamps malformed used-today values to zero instead of rendering negatives", () => {
    const s = getIllustrationQuotaState(Number.NaN, 3, false);
    expect(s.usedToday).toBe(0);
    expect(s.remainingToday).toBe(3);
    expect(s.label).toBe("3 of 3 illustrations left today");
  });

  it("treats a malformed limit (NaN, negative) as 'no cap reported' and hides the row", () => {
    const s = getIllustrationQuotaState(0, Number.NaN as unknown as number, false);
    expect(s.visible).toBe(false);
    expect(s.limit).toBeNull();
    expect(s.label).toBe("");
  });

  it("exposes the same upsell sentence to every caller", () => {
    // Locks the wording so a wording tweak triggers a single,
    // visible test failure rather than silent drift across screens.
    expect(ILLUSTRATION_UPSELL_LABEL).toBe(
      "Upgrade for unlimited illustrations",
    );
  });

  it("locks the toast wording used by the Archive Illustrate and Regenerate flows", () => {
    // Both archive.tsx call sites use ILLUSTRATION_OUT_TOAST; a
    // wording change must land here first so the test surfaces the
    // intent before any screen drifts silently.
    expect(ILLUSTRATION_OUT_TOAST).toBe(
      "Out of illustrations today — upgrade for more",
    );
  });

  it("locks the inline error wording used by the Capture screen", () => {
    // capture.tsx uses ILLUSTRATION_OUT_INLINE (no upsell suffix)
    // so the error fits inline below the polaroid without wrapping.
    expect(ILLUSTRATION_OUT_INLINE).toBe("Out of illustrations today");
  });
});

describe("getCaptureLimitState — live limit override (Task #144)", () => {
  // Pins the contract `SubscriptionContext.freeDailyCaptureLimit`
  // depends on: every "X of Y left" UI surface AND the Layer 3 throw
  // in `MemoriesContext.addMemory` route through here, so an
  // accidental drop of the `liveLimit` parameter would silently
  // strand free users on the compiled-in 10 even after the server
  // reported a higher cap during a promotion. These tests are the
  // one place that deliberate override change must update.

  it("uses the live limit when it's a positive integer different from the compiled-in default", () => {
    // Mid-promo cap of 5 reported by /subscription/entitlement.
    const s = getCaptureLimitState(2, false, 5);
    expect(s.limit).toBe(5);
    expect(s.remainingToday).toBe(3);
    expect(s.atLimit).toBe(false);
  });

  it("flips atLimit at exactly the live limit (not the compiled-in default)", () => {
    // 5 captures with live cap 5 = at the wall. If a future regression
    // hard-coded the constant, this would miss the cap entirely
    // (5 < 10) and let the user sneak past their actual quota.
    const s = getCaptureLimitState(5, false, 5);
    expect(s.atLimit).toBe(true);
    expect(s.remainingToday).toBe(0);
    // Also pin that the same input under the OLD default would NOT
    // flip — proves the override is what's driving atLimit here.
    expect(getCaptureLimitState(5, false).atLimit).toBe(false);
  });

  it("falls back to the compiled-in default when the live limit is missing or invalid", () => {
    // Older mobile build / never-fetched cold launch: caller passes
    // no liveLimit at all.
    expect(getCaptureLimitState(0, false).limit).toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
    // Sentinel "no value" the caller might pass (e.g. a stale
    // server response that returned 0 / negative / fractional /
    // NaN). All of these collapse to the compiled-in default — we
    // never want to render "X of 0 left" or "X of 10.5 left".
    expect(getCaptureLimitState(0, false, 0).limit).toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
    expect(getCaptureLimitState(0, false, -1).limit).toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
    expect(getCaptureLimitState(0, false, 10.5).limit).toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
    expect(getCaptureLimitState(0, false, Number.NaN).limit).toBe(
      FREE_DAILY_CAPTURE_LIMIT,
    );
  });

  it("never flips atLimit for Pro users even when the live limit is well below capturesToday", () => {
    // Defense-in-depth: if a Pro upgrade lands while a low live
    // cap is cached (or a stale render hasn't caught up), Pro must
    // still not be told they're at the wall.
    const s = getCaptureLimitState(99, true, 3);
    expect(s.atLimit).toBe(false);
    expect(s.limit).toBe(3);
  });
});
