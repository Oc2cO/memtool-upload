import {
  MANAGE_APPLE_OPEN_FAILED_MESSAGE,
  MANAGE_STRIPE_OPEN_FAILED_MESSAGE,
  runManageFlow,
} from "./manageSubscriptionFlow";
import type { PortalResult } from "./subscription";

interface BuildDepsOverrides {
  rail?: "apple" | "stripe";
  openAppleManageSubscriptions?: () => Promise<void>;
  apiCreatePortalSession?: () => Promise<PortalResult>;
  openExternalUrl?: (url: string) => Promise<void>;
}

function buildDeps(overrides: BuildDepsOverrides = {}) {
  return {
    rail: overrides.rail ?? "apple",
    openAppleManageSubscriptions:
      overrides.openAppleManageSubscriptions ?? (async () => undefined),
    apiCreatePortalSession:
      overrides.apiCreatePortalSession ??
      (async (): Promise<PortalResult> => ({
        ok: true,
        url: "https://stripe.example/portal",
      })),
    openExternalUrl:
      overrides.openExternalUrl ?? (async (_url: string) => undefined),
  };
}

describe("runManageFlow — Apple rail (deep link)", () => {
  test("Apple deep-link success → opened_apple, fires the deep link once", async () => {
    let deepLinkCalls = 0;
    const outcome = await runManageFlow(
      buildDeps({
        rail: "apple",
        openAppleManageSubscriptions: async () => {
          deepLinkCalls += 1;
        },
      }),
    );
    expect(deepLinkCalls).toBe(1);
    expect(outcome).toEqual({ kind: "opened_apple" });
  });

  test("Apple deep-link short-circuits before any Stripe call", async () => {
    let portalCalls = 0;
    let opened = 0;
    await runManageFlow(
      buildDeps({
        rail: "apple",
        apiCreatePortalSession: async () => {
          portalCalls += 1;
          return { ok: true, url: "https://stripe.example/portal" };
        },
        openExternalUrl: async () => {
          opened += 1;
        },
      }),
    );
    expect(portalCalls).toBe(0);
    expect(opened).toBe(0);
  });

  test("Apple deep-link throw → 'couldn't open the App Store' copy (raw error not surfaced)", async () => {
    const outcome = await runManageFlow(
      buildDeps({
        rail: "apple",
        openAppleManageSubscriptions: async () => {
          throw new Error("LSApplicationQueriesSchemes — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: MANAGE_APPLE_OPEN_FAILED_MESSAGE,
    });
    expect(MANAGE_APPLE_OPEN_FAILED_MESSAGE).toBe(
      "Couldn't open the App Store — try again",
    );
  });
});

describe("runManageFlow — Stripe rail (billing portal)", () => {
  test("Stripe portal success → opened_stripe, opens the returned URL", async () => {
    let openedUrl: string | null = null;
    const outcome = await runManageFlow(
      buildDeps({
        rail: "stripe",
        apiCreatePortalSession: async () => ({
          ok: true,
          url: "https://stripe.example/portal/xyz",
        }),
        openExternalUrl: async (url) => {
          openedUrl = url;
        },
      }),
    );
    expect(openedUrl).toBe("https://stripe.example/portal/xyz");
    expect(outcome).toEqual({ kind: "opened_stripe" });
  });

  test("Stripe rail does not fire the Apple deep link", async () => {
    let deepLinkCalls = 0;
    await runManageFlow(
      buildDeps({
        rail: "stripe",
        openAppleManageSubscriptions: async () => {
          deepLinkCalls += 1;
        },
      }),
    );
    expect(deepLinkCalls).toBe(0);
  });

  test("Stripe portal 'not_configured' → not_configured (no destructive copy, no open)", async () => {
    let opened = false;
    const outcome = await runManageFlow(
      buildDeps({
        rail: "stripe",
        apiCreatePortalSession: async () => ({
          ok: false,
          reason: "not_configured",
        }),
        openExternalUrl: async () => {
          opened = true;
        },
      }),
    );
    expect(opened).toBe(false);
    expect(outcome).toEqual({ kind: "not_configured" });
  });

  test("Stripe portal API throw → 'couldn't open Stripe' copy", async () => {
    const outcome = await runManageFlow(
      buildDeps({
        rail: "stripe",
        apiCreatePortalSession: async () => {
          throw new Error("portal failed — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: MANAGE_STRIPE_OPEN_FAILED_MESSAGE,
    });
    expect(MANAGE_STRIPE_OPEN_FAILED_MESSAGE).toBe(
      "Couldn't open Stripe — try again",
    );
  });

  test("Stripe openExternalUrl throw → 'couldn't open Stripe' copy", async () => {
    const outcome = await runManageFlow(
      buildDeps({
        rail: "stripe",
        openExternalUrl: async () => {
          throw new Error("browser refused — must NOT leak");
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "error",
      message: MANAGE_STRIPE_OPEN_FAILED_MESSAGE,
    });
  });
});
