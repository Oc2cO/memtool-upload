import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { APPLE_MANAGE_SUBSCRIPTIONS_URL } from "./revenuecat";

/**
 * Open an arbitrary external URL (Stripe checkout, Stripe billing
 * portal, etc.) the right way per platform:
 *   - Web: navigate the current tab so the user lands back on us
 *     via Stripe's success_url.
 *   - Native: open the system in-app browser so the auth session is
 *     preserved and the user can close it back into MemTool.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(url);
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

/**
 * Apple's manage-subscriptions deep link is an https URL that iOS
 * treats specially — opening it in the in-app browser would just show
 * the Apple website, while `Linking.openURL` lets the OS hand it to
 * the App Store / Settings app. So for this one URL we always go via
 * Linking, even on native.
 */
export async function openAppleManageSubscriptions(): Promise<void> {
  await Linking.openURL(APPLE_MANAGE_SUBSCRIPTIONS_URL);
}
