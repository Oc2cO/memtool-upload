import { Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { getApiBaseUrl } from "@/lib/api";

const FALLBACK_PRIVACY_URL =
  process.env["EXPO_PUBLIC_PRIVACY_POLICY_URL"] ??
  "https://oc2coos-2.polsia.app/privacy";

export function getPrivacyPolicyUrl(): string {
  const explicit = process.env["EXPO_PUBLIC_PRIVACY_POLICY_URL"];
  if (explicit && explicit.length > 0) return explicit;

  const base = getApiBaseUrl();
  if (base && base.length > 0) {
    const trimmed = base.replace(/\/+$/, "");
    if (trimmed.endsWith("/api")) return `${trimmed}/privacy`;
    return `${trimmed}/api/privacy`;
  }

  return FALLBACK_PRIVACY_URL;
}

export const PRIVACY_POLICY_LABEL = "Privacy Policy";

const FALLBACK_TERMS_URL =
  process.env["EXPO_PUBLIC_TERMS_URL"] ??
  "https://oc2coos-2.polsia.app/terms";

export function getTermsOfServiceUrl(): string {
  const explicit = process.env["EXPO_PUBLIC_TERMS_URL"];
  if (explicit && explicit.length > 0) return explicit;

  const base = getApiBaseUrl();
  if (base && base.length > 0) {
    const trimmed = base.replace(/\/+$/, "");
    if (trimmed.endsWith("/api")) return `${trimmed}/terms`;
    return `${trimmed}/api/terms`;
  }

  return FALLBACK_TERMS_URL;
}

export const TERMS_OF_SERVICE_LABEL = "Terms of Service";

const FALLBACK_SUPPORT_URL =
  process.env["EXPO_PUBLIC_SUPPORT_URL"] ??
  "https://oc2coos-2.polsia.app/support";

export function getSupportUrl(): string {
  const explicit = process.env["EXPO_PUBLIC_SUPPORT_URL"];
  if (explicit && explicit.length > 0) return explicit;

  const base = getApiBaseUrl();
  if (base && base.length > 0) {
    const trimmed = base.replace(/\/+$/, "");
    if (trimmed.endsWith("/api")) return `${trimmed}/support`;
    return `${trimmed}/api/support`;
  }

  return FALLBACK_SUPPORT_URL;
}

export const SUPPORT_LABEL = "Help & Support";

const FALLBACK_SUPPORT_EMAIL = "support@oc2coos-2.polsia.app";

export function getSupportEmail(): string {
  const explicit = process.env["EXPO_PUBLIC_SUPPORT_EMAIL"];
  if (explicit && explicit.length > 0) return explicit;
  return FALLBACK_SUPPORT_EMAIL;
}

export function getSupportMailtoUrl(): string {
  return `mailto:${getSupportEmail()}`;
}

export async function openLegalUrl(url: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      await Linking.openURL(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  } catch {
    try {
      await Linking.openURL(url);
    } catch {
      // ignore — caller has no good recourse if both browser and Linking fail
    }
  }
}

export async function openSupportEmail(): Promise<void> {
  try {
    await Linking.openURL(getSupportMailtoUrl());
  } catch {
    // Simulator without Mail configured will just no-op.
  }
}
