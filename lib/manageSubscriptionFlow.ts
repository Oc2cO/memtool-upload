import type { PortalResult } from "./subscription";

// Inline error copy lives next to the decision logic so a future
// refactor of the manage-subscription button can't silently change
// what an existing paying user sees when the App Store deep link or
// Stripe portal fails to open.
export const MANAGE_APPLE_OPEN_FAILED_MESSAGE =
  "Couldn't open the App Store — try again";
export const MANAGE_STRIPE_OPEN_FAILED_MESSAGE =
  "Couldn't open Stripe — try again";

export type ManageOutcome =
  // Apple manage-subscriptions deep link launched (the OS hands the
  // https URL to the App Store / Settings app).
  | { kind: "opened_apple" }
  // Stripe billing portal URL was opened in the browser.
  | { kind: "opened_stripe" }
  // Stripe returned 503 / not_configured. Caller flips the screen
  // into the rail-not-configured state without a destructive error.
  | { kind: "not_configured" }
  // Anything else — generic, rail-specific copy.
  | { kind: "error"; message: string };

export interface RunManageFlowDeps {
  rail: "apple" | "stripe";
  openAppleManageSubscriptions: () => Promise<void>;
  apiCreatePortalSession: () => Promise<PortalResult>;
  openExternalUrl: (url: string) => Promise<void>;
}

export async function runManageFlow(
  deps: RunManageFlowDeps,
): Promise<ManageOutcome> {
  if (deps.rail === "apple") {
    // Apple-billed subscriptions can only be managed in the App Store
    // / iOS Settings — never in our own UI or the Stripe portal (App
    // Store Review Guideline 3.1.2). The deep link works on web too,
    // so this is the single right call regardless of Platform.OS.
    try {
      await deps.openAppleManageSubscriptions();
    } catch {
      return { kind: "error", message: MANAGE_APPLE_OPEN_FAILED_MESSAGE };
    }
    return { kind: "opened_apple" };
  }

  let result: PortalResult;
  try {
    result = await deps.apiCreatePortalSession();
  } catch {
    return { kind: "error", message: MANAGE_STRIPE_OPEN_FAILED_MESSAGE };
  }
  if (!result.ok) return { kind: "not_configured" };
  try {
    await deps.openExternalUrl(result.url);
  } catch {
    return { kind: "error", message: MANAGE_STRIPE_OPEN_FAILED_MESSAGE };
  }
  return { kind: "opened_stripe" };
}
