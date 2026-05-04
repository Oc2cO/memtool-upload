import { pickInsightsView } from "./insightsView";

describe("pickInsightsView", () => {
  it("returns loading when fetching and no cached envelope yet", () => {
    expect(
      pickInsightsView({
        isLoading: true,
        hasPatterns: false,
        isColdStart: false,
        isPro: true,
      }),
    ).toBe("loading");
  });

  it("does not block on loading once a cached envelope exists", () => {
    expect(
      pickInsightsView({
        isLoading: true,
        hasPatterns: true,
        isColdStart: false,
        isPro: true,
      }),
    ).toBe("populated");
  });

  it("shows cold_start regardless of tier when below the min", () => {
    expect(
      pickInsightsView({
        isLoading: false,
        hasPatterns: true,
        isColdStart: true,
        isPro: true,
      }),
    ).toBe("cold_start");
    expect(
      pickInsightsView({
        isLoading: false,
        hasPatterns: true,
        isColdStart: true,
        isPro: false,
      }),
    ).toBe("cold_start");
  });

  it("locks free users out of the populated Insights screen", () => {
    expect(
      pickInsightsView({
        isLoading: false,
        hasPatterns: true,
        isColdStart: false,
        isPro: false,
      }),
    ).toBe("locked");
  });

  it("renders populated only for Pro users with a warmed envelope", () => {
    expect(
      pickInsightsView({
        isLoading: false,
        hasPatterns: true,
        isColdStart: false,
        isPro: true,
      }),
    ).toBe("populated");
  });
});
