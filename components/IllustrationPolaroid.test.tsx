/**
 * Coverage for the Archive-row polaroid's thumbnail wiring (Task
 * #212 added the small thumbnail variant on the api-server; this
 * test locks the IllustrationPolaroid's half of that contract).
 *
 * The regression we're guarding against: the polaroid silently
 * passing the full-resolution `imageUrl` to expo-image instead of
 * the small `thumbUrl`. Visually nothing changes — but every
 * archive row pulls the 1MB PNG and scrolling stutters. By
 * asserting on the URI handed to <Image>, we catch the regression
 * before it ships.
 */

import React from "react";
import { render } from "@testing-library/react-native";

// Stub useColors to a deterministic palette so we don't have to
// boot the appearance machinery for a thumbnail-URI assertion.
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#000",
    primaryForeground: "#fff",
    mutedForeground: "#888",
  }),
}));

// react-native-safe-area-context isn't installed in the test
// renderer; the IllustrationPolaroid mounts an IllustrationLightbox
// which calls useSafeAreaInsets() at render time even when
// `visible={false}`. A static stub keeps the lightbox from
// crashing without changing any behavior we assert on.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// expo-image's native `<Image>` doesn't render a discoverable URI
// in the test tree, so swap it for a stub that surfaces the URI
// via testID + accessibilityLabel. This is the same trick the
// codebase uses for native modules that don't run in jest-expo.
jest.mock("expo-image", () => {
  const ReactActual = require("react");
  const { View } = require("react-native");
  return {
    Image: (props: { source?: { uri?: string }; accessibilityLabel?: string }) =>
      ReactActual.createElement(View, {
        testID: "expo-image",
        accessibilityLabel: props.accessibilityLabel,
        // Surface the URI on a custom prop so tests can read it
        // without parsing the source object out of every node.
        "data-uri": props.source?.uri,
      }),
  };
});

import { IllustrationPolaroid } from "./IllustrationPolaroid";

const FULL_URL = "https://api.example.com/illos/abc/full.png";
const THUMB_URL = "https://api.example.com/illos/abc/thumb.png";

function getImageUri(view: ReturnType<typeof render>): string | undefined {
  const node = view.getByTestId("expo-image");
  return node.props["data-uri"] as string | undefined;
}

describe("IllustrationPolaroid — thumbnail URL wiring", () => {
  test("passes thumbUrl to expo-image when available (the scroll-perf win)", () => {
    const view = render(
      <IllustrationPolaroid
        imageUrl={FULL_URL}
        thumbUrl={THUMB_URL}
        caption="a quiet morning"
      />,
    );

    // The polaroid frame's <Image> must show the small thumbnail,
    // NOT the 1MB full-res PNG. A regression here would silently
    // re-introduce the Archive scroll jank that motivated Task #212.
    expect(getImageUri(view)).toBe(THUMB_URL);
  });

  test("falls back to imageUrl when thumbUrl is omitted (legacy server records)", () => {
    const view = render(
      <IllustrationPolaroid imageUrl={FULL_URL} caption="legacy" />,
    );

    // Pre-thumbnail records (and offline-cached maps from older
    // server versions) carry only a full-resolution URL; the
    // polaroid must still render rather than going blank.
    expect(getImageUri(view)).toBe(FULL_URL);
  });

  test("does NOT self-defend against an empty-string thumbUrl (upstream parser is the guard)", () => {
    const view = render(
      <IllustrationPolaroid
        imageUrl={FULL_URL}
        thumbUrl=""
        caption="empty thumb"
      />,
    );

    // The component's `thumbUrl ?? imageUrl` only treats `undefined`
    // as missing, so an empty string passes straight through to
    // expo-image (which would render a broken-image placeholder).
    // The api-client parser is the single source of truth for that
    // guard — it maps "" → undefined before this component ever
    // sees the value (see illustrations.test.ts). If the polaroid
    // ever grows its own empty-string guard, flip this expectation
    // to FULL_URL and the upstream guard can be relaxed.
    expect(getImageUri(view)).toBe("");
  });
});
