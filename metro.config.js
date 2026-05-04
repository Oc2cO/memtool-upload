const { getSentryExpoConfig } = require("@sentry/react-native/metro");

// Wraps `expo/metro-config`'s getDefaultConfig and additionally enables
// the Sentry serializer that emits a Debug ID into the JS bundle so the
// uploaded source maps can be matched in production. Safe to use even
// when SENTRY_AUTH_TOKEN is not present — without the token the EAS
// upload step in the @sentry/react-native/expo plugin is skipped, and
// the only effect is a Debug ID comment in the bundle.
const config = getSentryExpoConfig(__dirname);

// Exclude *.test.* and __tests__ from production bundling. Test files
// live alongside route files inside `app/`, so expo-router's
// `require.context` would otherwise try to import them — pulling in
// @testing-library/react-native, which references Node's `console`
// module and breaks `eas build`'s eager bundle phase.
config.resolver.blockList = /(.*\.test\.[jt]sx?$|.*\/__tests__\/.*)/;

module.exports = config;
