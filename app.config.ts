import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Dynamic Expo config layered on top of the static `app.json`.
 *
 * The only reason this file exists is to inject the
 * `@sentry/react-native/expo` plugin with values that depend on the
 * build-time environment:
 *
 *   - `organization` reads from `SENTRY_ORG` (an EAS env var / secret).
 *     Static `app.json` does NOT perform shell-style `$VAR` substitution
 *     for plugin options, so the plugin org has to be resolved here.
 *   - `project` is fixed (`memtool-mobile`).
 *
 * If `SENTRY_ORG` and `SENTRY_AUTH_TOKEN` are not present at EAS build
 * time the plugin still installs the iOS Xcode upload phase but the
 * upload step itself is a no-op — the build does not fail.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const org = process.env.SENTRY_ORG;
  const sentryPlugin: [string, Record<string, unknown>] = [
    "@sentry/react-native/expo",
    {
      url: "https://sentry.io/",
      project: "memtool-mobile",
      ...(org ? { organization: org } : {}),
    },
  ];

  const basePlugins = (config.plugins ?? []) as ExpoConfig["plugins"];

  return {
    ...config,
    name: config.name ?? "MemTool",
    slug: config.slug ?? "workspace",
    plugins: [...(basePlugins ?? []), sentryPlugin],
  };
};
