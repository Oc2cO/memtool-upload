import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetNativeModuleForTests,
  __setNativeModuleForTests,
  type CoreHapticsNative,
} from "../modules/expo-core-haptics";
import {
  CORE_HAPTICS_HINT_DISMISSED_KEY,
  dismissCoreHapticsHint,
  hasDismissedCoreHapticsHint,
  shouldShowCoreHapticsHint,
} from "./coreHapticsHint";

const originalOS = Platform.OS;

function setPlatformOS(os: "ios" | "android" | "web") {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => os,
  });
}

function makeNative(available: boolean): CoreHapticsNative {
  return {
    getAvailability: () => ({
      available,
      reason: available ? null : "hardware_not_supported",
    }),
    play: jest.fn().mockResolvedValue({ status: "ok", handle: 1 }),
    stop: jest.fn(),
  };
}

beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockReset();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockReset();
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  __resetNativeModuleForTests();
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => originalOS,
  });
});

describe("shouldShowCoreHapticsHint", () => {
  it("is false on Android even if storage flag is unset", async () => {
    setPlatformOS("android");
    // Native module isn't installed on Android — getAvailability()
    // short-circuits before requiring expo-modules-core.
    expect(await shouldShowCoreHapticsHint()).toBe(false);
    // Cheapest gate: we should never have hit AsyncStorage at all
    // for an Android user, otherwise we'd be paying a round-trip
    // on every Settings focus for nothing.
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("is false on web", async () => {
    setPlatformOS("web");
    expect(await shouldShowCoreHapticsHint()).toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("is false on iOS when the native module is not linked (Expo Go / older dev client)", async () => {
    setPlatformOS("ios");
    // Don't __setNativeModuleForTests — the cache stays at
    // `undefined` and the module's lazy require() will try and fail
    // to find expo-modules-core's CoreHaptics, returning module_not_linked.
    expect(await shouldShowCoreHapticsHint()).toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("is false on iPhone where Core Haptics availability says no (JS fallback path)", async () => {
    setPlatformOS("ios");
    __setNativeModuleForTests(makeNative(false));
    expect(await shouldShowCoreHapticsHint()).toBe(false);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("is true on iPhone with Core Haptics available and no dismissed flag persisted", async () => {
    setPlatformOS("ios");
    __setNativeModuleForTests(makeNative(true));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    expect(await shouldShowCoreHapticsHint()).toBe(true);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(
      CORE_HAPTICS_HINT_DISMISSED_KEY,
    );
  });

  it("is false on iPhone with Core Haptics available once the dismissed flag is set", async () => {
    setPlatformOS("ios");
    __setNativeModuleForTests(makeNative(true));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      "2026-05-01T00:00:00.000Z",
    );

    expect(await shouldShowCoreHapticsHint()).toBe(false);
  });

  it("treats an AsyncStorage read failure as 'already dismissed' so a glitch never re-shows the hint", async () => {
    setPlatformOS("ios");
    __setNativeModuleForTests(makeNative(true));
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
      new Error("storage offline"),
    );

    expect(await shouldShowCoreHapticsHint()).toBe(false);
  });
});

describe("dismissCoreHapticsHint", () => {
  it("persists a non-empty value at the dismissed key so subsequent reads short-circuit", async () => {
    await dismissCoreHapticsHint();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
    expect(key).toBe(CORE_HAPTICS_HINT_DISMISSED_KEY);
    // Storing an ISO timestamp instead of a bare "1" gives us a
    // breadcrumb if we ever need to debug "why did this user never
    // see the hint" — `hasDismissedCoreHapticsHint` only cares that
    // *something* is there.
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  it("does not throw if AsyncStorage refuses the write", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(
      new Error("disk full"),
    );
    await expect(dismissCoreHapticsHint()).resolves.toBeUndefined();
  });
});

describe("hasDismissedCoreHapticsHint", () => {
  it("returns false when no flag has been written", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await hasDismissedCoreHapticsHint()).toBe(false);
  });

  it("returns true when any value is present at the key", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("anything");
    expect(await hasDismissedCoreHapticsHint()).toBe(true);
  });
});
