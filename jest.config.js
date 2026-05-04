// Tests are scoped to lib/**, components/**, app/**, and context/** —
// the full subscription screen has too many side-effect imports
// (router, fonts, custom animations) to boot in a unit test, so
// coverage lives in the extracted hook + component instead. The
// app/** tests cover screen handlers (e.g. capture / log-call
// cooldown branches) by mocking the hook surface those screens
// depend on. context/** tests boot the React context providers
// directly with their imported modules mocked out.
module.exports = {
  preset: "jest-expo",
  testMatch: [
    "<rootDir>/lib/**/*.test.ts",
    "<rootDir>/lib/**/*.test.tsx",
    "<rootDir>/components/**/*.test.ts",
    "<rootDir>/components/**/*.test.tsx",
    "<rootDir>/app/**/*.test.ts",
    "<rootDir>/app/**/*.test.tsx",
    "<rootDir>/context/**/*.test.ts",
    "<rootDir>/context/**/*.test.tsx",
    "<rootDir>/scripts/**/*.test.js",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Extend jest-expo's default transformIgnorePatterns so the
  // workspace-vendored @workspace/api-client-react package (which
  // ships TS source with `export *`) is also transformed by
  // babel-jest. Without this opt-in, any test that transitively
  // imports that package fails to load with "Unexpected token
  // 'export'". See task #391.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|@workspace/api-client-react))",
    "/node_modules/react-native-reanimated/plugin/",
  ],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
