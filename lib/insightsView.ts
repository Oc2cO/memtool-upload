export type InsightsView =
  | "loading"
  | "cold_start"
  | "locked"
  | "populated";

export function pickInsightsView(args: {
  isLoading: boolean;
  hasPatterns: boolean;
  isColdStart: boolean;
  isPro: boolean;
}): InsightsView {
  if (args.isLoading && !args.hasPatterns) return "loading";
  if (args.isColdStart) return "cold_start";
  if (!args.isPro) return "locked";
  return "populated";
}
