import React from "react";
import { render } from "@testing-library/react-native";

import { MemoryFacetChips } from "./MemoryFacetChips";

// `useColors` reaches through theming + Appearance which we don't
// need to exercise here — stub it to a fixed palette so the chips
// render deterministically and we don't have to boot the full
// hook tree under jest.
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    border: "#000",
    muted: "#222",
    foreground: "#fff",
  }),
}));

describe("MemoryFacetChips", () => {
  test("renders one chip per tag with the tag text", () => {
    const view = render(
      <MemoryFacetChips
        facets={{ tags: ["family", "calm", "sunday"], theme: "", mood: "" }}
      />,
    );
    expect(view.getByText("family")).toBeTruthy();
    expect(view.getByText("calm")).toBeTruthy();
    expect(view.getByText("sunday")).toBeTruthy();
    // A single accessible label exposes the chip set as a comma list
    // so VoiceOver users hear the row's tags without swiping through
    // each pill individually.
    expect(view.getByLabelText("Tags: family, calm, sunday")).toBeTruthy();
  });

  test("renders nothing when facets is undefined (older / non-AI row)", () => {
    const view = render(<MemoryFacetChips facets={undefined} />);
    expect(view.toJSON()).toBeNull();
  });

  test("renders nothing when tags array is empty (model returned no hits)", () => {
    const view = render(
      <MemoryFacetChips
        facets={{ tags: [], theme: "calm sunday", mood: "calm" }}
      />,
    );
    expect(view.toJSON()).toBeNull();
  });

  test("renders nothing when tags is not an array (cache shape drift)", () => {
    // Defensive path: a cached row from a future schema change that
    // shipped a non-array `tags` value should NOT crash the row — it
    // should just degrade to no chips, matching the missing-facets
    // path.
    const malformed = {
      tags: "family" as unknown as string[],
      theme: "",
      mood: "",
    };
    const view = render(<MemoryFacetChips facets={malformed} />);
    expect(view.toJSON()).toBeNull();
  });
});
