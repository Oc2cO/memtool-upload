#!/usr/bin/env tsx
/**
 * Pre-Launch Readiness Audit — MemTool
 *
 * Runs a full pre-launch readiness audit and prints a categorized Markdown
 * report. Exits non-zero if any check has FAIL status.
 *
 * Usage:
 *   pnpm --filter @workspace/memtool run audit:prelaunch
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Status = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
}

interface Category {
  title: string;
  checks: CheckResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEMTOOL_DIR = path.resolve(__dirname, "..");
// artifacts/memtool → artifacts → workspace root
const WORKSPACE_ROOT = path.resolve(MEMTOOL_DIR, "../..");

function rel(p: string): string {
  return path.relative(WORKSPACE_ROOT, p);
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function isZeroByte(p: string): boolean {
  try {
    return fs.statSync(p).size === 0;
  } catch {
    return false;
  }
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Walk a directory recursively; returns absolute paths to files. */
function walkFiles(dir: string, predicate?: (f: string) => boolean): string[] {
  const results: string[] = [];
  if (!exists(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (!predicate || predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

function pass(name: string, detail: string): CheckResult {
  return { name, status: "PASS", detail };
}

function warn(name: string, detail: string): CheckResult {
  return { name, status: "WARN", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "FAIL", detail };
}

// ---------------------------------------------------------------------------
// Category 1 — Submit Blockers
// ---------------------------------------------------------------------------

function checkSubmitBlockers(): CheckResult[] {
  const results: CheckResult[] = [];

  // 1a. ASC API key file. The `.p8` is a local-only credential
  // (gitignored by design), so checking for it on a CI runner is a
  // false negative — the key is provided to `eas submit` out of band.
  // In CI (`process.env.CI === "true"`, set by GitHub Actions and most
  // other providers) we downgrade the missing-key result to a WARN
  // with an explicit "skipped in CI" detail so the audit gate doesn't
  // fail PRs over a credential that intentionally isn't checked in.
  const ascKeyPath = path.join(WORKSPACE_ROOT, ".asc-keys", "AuthKey_7XBJCGMS4R.p8");
  const isCI = process.env.CI === "true";
  if (exists(ascKeyPath)) {
    results.push(pass("ASC API key file present", `Found at ${rel(ascKeyPath)}`));
  } else if (isCI) {
    results.push(
      warn(
        "ASC API key file present",
        `Skipped in CI (CI=true): ${rel(ascKeyPath)} is a local-only credential and is provided to eas submit out of band. Verify locally before tagging a release.`
      )
    );
  } else {
    results.push(
      fail(
        "ASC API key file present",
        `Missing: ${rel(ascKeyPath)} — re-download from ASC → Users and Access → Keys → 7XBJCGMS4R and save with chmod 600`
      )
    );
  }

  // 1b. .env.example documents required env vars
  const envExamplePath = path.join(MEMTOOL_DIR, ".env.example");
  // MemTool ships iOS-only — no Android / Play Store target. Do not
  // re-add EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY here.
  const requiredEnvVars = [
    "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
    "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY",
    "METRICS_SHARED_SECRET",
    "EXPO_PUBLIC_REPLIT_API_BASE_URL",
    "EXPO_PUBLIC_AUTH_API_BASE_URL",
  ];

  if (!exists(envExamplePath)) {
    results.push(
      warn(
        ".env.example documents required env vars",
        `No .env.example found at ${rel(envExamplePath)}. Create it and document: ${requiredEnvVars.join(", ")}`
      )
    );
  } else {
    const envContent = readFileSafe(envExamplePath);
    const missing = requiredEnvVars.filter((v) => !envContent.includes(v));
    if (missing.length === 0) {
      results.push(pass(".env.example documents required env vars", `All ${requiredEnvVars.length} required vars present`));
    } else {
      results.push(
        fail(
          ".env.example documents required env vars",
          `Missing from .env.example: ${missing.join(", ")}`
        )
      );
    }
  }

  // 1c. app.json icon asset exists on disk
  const appJsonPath = path.join(MEMTOOL_DIR, "app.json");
  let appJson: Record<string, unknown> = {};
  try {
    appJson = JSON.parse(readFileSafe(appJsonPath));
  } catch {
    results.push(fail("app.json is valid JSON", "Failed to parse app.json"));
    return results;
  }

  const expo = (appJson as { expo?: Record<string, unknown> }).expo ?? {};
  const iconRelative = expo.icon as string | undefined;
  if (!iconRelative) {
    results.push(fail("app.json icon asset exists", "No expo.icon field in app.json"));
  } else {
    const iconAbsolute = path.join(MEMTOOL_DIR, iconRelative);
    if (exists(iconAbsolute) && !isZeroByte(iconAbsolute)) {
      results.push(pass("app.json icon asset exists", `${iconRelative} found and non-empty`));
    } else if (!exists(iconAbsolute)) {
      results.push(fail("app.json icon asset exists", `Icon not found on disk: ${iconRelative}`));
    } else {
      results.push(fail("app.json icon asset exists", `Icon is zero bytes: ${iconRelative}`));
    }
  }

  // 1d. app.json splash asset exists on disk
  const splash = expo.splash as { image?: string } | undefined;
  const splashImage = splash?.image;
  if (!splashImage) {
    results.push(fail("app.json splash asset exists", "No expo.splash.image field in app.json"));
  } else {
    const splashAbsolute = path.join(MEMTOOL_DIR, splashImage);
    if (exists(splashAbsolute) && !isZeroByte(splashAbsolute)) {
      results.push(pass("app.json splash asset exists", `${splashImage} found and non-empty`));
    } else if (!exists(splashAbsolute)) {
      results.push(fail("app.json splash asset exists", `Splash not found on disk: ${splashImage}`));
    } else {
      results.push(fail("app.json splash asset exists", `Splash is zero bytes: ${splashImage}`));
    }
  }

  // 1e. iOS-only build target — no Android / Play Store. Hard-fail
  // if `expo.android` reappears in app.json (would re-introduce a
  // Play Store build target we no longer support).
  const android = (expo as { android?: unknown }).android;
  if (android === undefined) {
    results.push(pass("app.json is iOS-only (no expo.android block)", "No expo.android block — iOS-only build target confirmed"));
  } else {
    results.push(fail("app.json is iOS-only (no expo.android block)", "expo.android block found in app.json — MemTool ships iOS-only; remove the android block"));
  }

  // 1f. privacyManifests block present in app.json
  const ios = expo.ios as { privacyManifests?: unknown } | undefined;
  if (ios?.privacyManifests) {
    results.push(pass("privacyManifests block present in app.json", "expo.ios.privacyManifests block found"));
  } else {
    results.push(fail("privacyManifests block present in app.json", "expo.ios.privacyManifests block missing from app.json"));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 2 — Dead-Link / Orphan-Route Detection
// ---------------------------------------------------------------------------

/** Build the set of routes that exist in app/(app)/ */
function buildKnownRoutes(): Set<string> {
  const routes = new Set<string>();
  const appDir = path.join(MEMTOOL_DIR, "app", "(app)");
  if (!exists(appDir)) return routes;

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Layout groups like (tabs) don't add a segment
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        const segment = isGroup ? prefix : `${prefix}/${entry.name}`;
        walk(full, segment);
      } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        if (entry.name.startsWith("_")) continue; // _layout.tsx etc
        if (entry.name.startsWith("+")) continue; // +not-found.tsx
        if (entry.name.includes(".test.") || entry.name.includes(".haptics.")) continue;
        const base = entry.name.replace(/\.(tsx|ts)$/, "");
        const route = base === "index" ? prefix || "/" : `${prefix}/${base}`;
        routes.add(route || "/");
      }
    }
  }

  walk(appDir, "");

  // Also add top-level app/ routes (login, onboarding, etc.)
  const topLevel = path.join(MEMTOOL_DIR, "app");
  for (const entry of fs.readdirSync(topLevel, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith("+")) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".haptics.")) continue;
    const base = entry.name.replace(/\.(tsx|ts)$/, "");
    routes.add(`/${base}`);
  }

  return routes;
}

/** Extract push/replace/href route targets from source text */
function extractRouteTargets(source: string): string[] {
  const targets: string[] = [];
  // router.push("/...") or router.replace("/...")
  const pushRe = /router\s*\.\s*(?:push|replace)\s*\(\s*["'`](\/[^"'`]*)/g;
  let m: RegExpExecArray | null;
  while ((m = pushRe.exec(source)) !== null) {
    targets.push(m[1].split("?")[0]);
  }
  // router.push({ pathname: "/..." })
  const pathnameRe = /pathname\s*:\s*["'`](\/[^"'`]*)/g;
  while ((m = pathnameRe.exec(source)) !== null) {
    targets.push(m[1].split("?")[0]);
  }
  // href="/..."  (Link component)
  const hrefRe = /href\s*=\s*["'`](\/[^"'`]*)/g;
  while ((m = hrefRe.exec(source)) !== null) {
    targets.push(m[1].split("?")[0]);
  }
  // href={{ pathname: "/..." }}
  const hrefPathnameRe = /href\s*=\s*\{\s*\{\s*pathname\s*:\s*["'`](\/[^"'`]*)/g;
  while ((m = hrefPathnameRe.exec(source)) !== null) {
    targets.push(m[1].split("?")[0]);
  }
  return [...new Set(targets)];
}

// Routes that USED to be exposed under `app/(app)/` (gated only by a
// runtime `__DEV__` check on the `Stack.Screen` declaration) and have
// since been moved out of the routable URL space entirely.
//
// As of Task #304 they live under `app/(app)/_dev/`, which expo-router
// treats as a non-route directory (the `_` prefix). The audit below
// (`checkDevOnlyScreensNotRoutable`) re-verifies, on every prelaunch
// run, that none of these paths have crept back into the route map or
// any navigation call site, so a future refactor cannot accidentally
// re-expose them in production.
const DEV_ONLY_ROUTES = new Set<string>();
const FORMERLY_ROUTABLE_DEV_PATHS = [
  "/foundation-models-spike",
  "/haptics-debug",
] as const;

/** Extract tab names declared in (tabs)/_layout.tsx */
function buildTabRoutes(): Set<string> {
  const tabLayoutPath = path.join(MEMTOOL_DIR, "app", "(app)", "(tabs)", "_layout.tsx");
  const source = readFileSafe(tabLayoutPath);
  const tabs = new Set<string>();
  // Match NativeTabs.Trigger name="..." and Tabs.Screen name="..."
  const nameRe = /(?:NativeTabs\.Trigger|Tabs\.Screen)[^>]*name\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(source)) !== null) {
    tabs.add(m[1]);
  }
  return tabs;
}

function checkDeadLinks(): CheckResult[] {
  const results: CheckResult[] = [];
  const knownRoutes = buildKnownRoutes();
  const tabRoutes = buildTabRoutes();

  const isSourceFile = (f: string) =>
    (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes("node_modules");

  // Collect all source files for navigation target scanning
  const sourceFiles = [
    ...walkFiles(path.join(MEMTOOL_DIR, "app"), isSourceFile),
    ...walkFiles(path.join(MEMTOOL_DIR, "lib"), isSourceFile),
    ...walkFiles(path.join(MEMTOOL_DIR, "components"), isSourceFile),
  ];

  const allNavigationTargets = new Set<string>();
  const brokenLinks: string[] = [];

  for (const file of sourceFiles) {
    if (file.includes(".test.") || file.includes(".haptics.")) continue;
    const source = readFileSafe(file);
    const targets = extractRouteTargets(source);
    for (const target of targets) {
      allNavigationTargets.add(target);
      // Skip dynamic segments, external URLs, and layout group paths
      if (target.includes("[") || target.includes(":")) continue;
      // Expo-router layout group paths like /(app)/(tabs) are valid redirects
      if (/\/\([^)]+\)/.test(target)) continue;
      // Exact match only — no partial/fallback matching
      if (target !== "/" && target !== "" && !knownRoutes.has(target)) {
        brokenLinks.push(`${rel(file)}: ${target}`);
      }
    }
  }

  if (brokenLinks.length === 0) {
    results.push(
      pass(
        "All router.push/href targets resolve",
        `${allNavigationTargets.size} unique route targets checked — all resolve to files in app/`
      )
    );
  } else {
    results.push(
      fail(
        "All router.push/href targets resolve",
        `${brokenLinks.length} unresolved route target(s):\n  - ${brokenLinks.join("\n  - ")}`
      )
    );
  }

  // Check dev-only routes are gated (conditional guard) in _layout.tsx.
  // A real gate looks like: {__DEV__ && <Stack.Screen name="..." />}
  // or wrapped in an if/__DEV__ block. Merely being declared in the Stack
  // is NOT a gate — it makes the screen reachable in production builds.
  const layoutPath = path.join(MEMTOOL_DIR, "app", "(app)", "_layout.tsx");
  const layoutSource = readFileSafe(layoutPath);
  const layoutLines = layoutSource.split("\n");

  // Guard patterns that indicate a conditional render
  const guardPatterns = [/__DEV__/, /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/, /if\s*\(\s*__DEV__/, /devMode/i];

  const ungatedDevScreens: string[] = [];
  const gatedDevScreens: string[] = [];

  for (const devRoute of DEV_ONLY_ROUTES) {
    const screenName = devRoute.replace("/", "");

    // Find the line that declares this screen
    const lineIdx = layoutLines.findIndex((l) => l.includes(`name="${screenName}"`));
    if (lineIdx === -1) {
      ungatedDevScreens.push(`${devRoute} (not declared — add it to the Stack navigator)`);
      continue;
    }

    // Check a window of lines around the declaration for a guard pattern
    const windowStart = Math.max(0, lineIdx - 5);
    const window = layoutLines.slice(windowStart, lineIdx + 3).join("\n");
    const hasGuard = guardPatterns.some((re) => re.test(window));

    if (hasGuard) {
      gatedDevScreens.push(devRoute);
    } else {
      ungatedDevScreens.push(
        `${devRoute} (line ${lineIdx + 1}: declared without __DEV__ guard — wrap in {__DEV__ && <Stack.Screen … />} to hide in production)`
      );
    }
  }

  if (ungatedDevScreens.length === 0) {
    results.push(
      pass(
        "Dev-only screens isolated to app/(dev)/ and gated by __DEV__",
        `All ${gatedDevScreens.length} dev-only screen(s) are wrapped in a guard condition`
      )
    );
  } else {
    results.push(
      fail(
        "Dev-only screens isolated to app/(dev)/ and gated by __DEV__",
        `${ungatedDevScreens.length} dev-only screen(s) are accessible in production builds:\n  - ${ungatedDevScreens.join("\n  - ")}`
      )
    );
  }

  // Orphan-route detection: screens with no inbound navigation references
  // (excluding tab screens and dev-only screens)
  const appDir = path.join(MEMTOOL_DIR, "app", "(app)");
  const screenFiles = walkFiles(appDir, (f) => {
    if (!f.endsWith(".tsx") && !f.endsWith(".ts")) return false;
    const base = path.basename(f);
    if (base.startsWith("_") || base.startsWith("+")) return false;
    if (base.includes(".test.") || base.includes(".haptics.") || base.includes(".talking.")) return false;
    return true;
  });

  const orphanedScreens: string[] = [];
  for (const screenFile of screenFiles) {
    const base = path.basename(screenFile).replace(/\.(tsx|ts)$/, "");
    const screenRoute = `/${base}`;

    // Tab screens are always reachable from the tab bar
    if (tabRoutes.has(base)) continue;
    // Dev-only screens are expected to have no public navigation
    if (DEV_ONLY_ROUTES.has(screenRoute)) continue;
    // Layout files and not-found are not screens
    if (base === "_layout") continue;

    // Check if any source file navigates to this screen
    const reachable =
      allNavigationTargets.has(screenRoute) ||
      allNavigationTargets.has(`/${base}`) ||
      // Also check short name without leading slash
      [...allNavigationTargets].some((t) => t.endsWith(`/${base}`));

    if (!reachable) {
      orphanedScreens.push(`${rel(screenFile)} (route: ${screenRoute})`);
    }
  }

  if (orphanedScreens.length === 0) {
    results.push(
      pass(
        "No orphaned screens (all screens reachable)",
        `All ${screenFiles.length} screen(s) checked — each is either a tab, reachable by navigation call, or a known dev-only screen`
      )
    );
  } else {
    results.push(
      warn(
        "Potentially orphaned screens (no inbound navigation found)",
        `${orphanedScreens.length} screen(s) have no detected router.push/href pointing to them:\n  - ${orphanedScreens.join("\n  - ")}\n  Verify each is intentionally navigable (e.g., deep-link-only) before submission.`
      )
    );
  }

  // Task #304 regression guard: the formerly routable dev paths
  // (foundation-models-spike, haptics-debug) must not exist as routes
  // and must not be the target of any router.push / href in app code.
  // If a future refactor re-introduces them under `app/(app)/`, they
  // will reappear in `knownRoutes`; if anything calls
  // `router.push("/foundation-models-spike")` they will reappear in
  // `allNavigationTargets`. Either case fails this check.
  const reRoutableDevPaths: string[] = [];
  const reLinkedDevPaths: string[] = [];
  for (const devPath of FORMERLY_ROUTABLE_DEV_PATHS) {
    if (knownRoutes.has(devPath)) reRoutableDevPaths.push(devPath);
    if (allNavigationTargets.has(devPath)) reLinkedDevPaths.push(devPath);
  }
  if (reRoutableDevPaths.length === 0 && reLinkedDevPaths.length === 0) {
    results.push(
      pass(
        "Dev-only debug screens are not routable",
        `${FORMERLY_ROUTABLE_DEV_PATHS.length} formerly routable dev path(s) confirmed absent from route map and navigation calls`
      )
    );
  } else {
    const details: string[] = [];
    if (reRoutableDevPaths.length > 0) {
      details.push(
        `Found in route map (move back to app/(app)/_dev/ or another non-routable location): ${reRoutableDevPaths.join(", ")}`
      );
    }
    if (reLinkedDevPaths.length > 0) {
      details.push(
        `Targeted by router.push/href (remove the navigation call; mount via DevToolsLauncher modal instead): ${reLinkedDevPaths.join(", ")}`
      );
    }
    results.push(
      fail(
        "Dev-only debug screens must not be routable",
        details.join("\n  - ")
      )
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 3 — Stale "Coming Soon" / TODO Scan
// ---------------------------------------------------------------------------

const STALE_PATTERNS: Array<{ label: string; re: RegExp; skipRe?: RegExp }> = [
  { label: "coming soon", re: /coming\s+soon/i },
  { label: "your-backend.example.com", re: /your-backend\.example\.com/i },
  { label: "TBD placeholder text", re: /\bTBD\b/ },
  {
    label: "placeholder text (non-prop)",
    re: /\bplaceholder\b/i,
    // Skip JSX prop attributes (placeholder="..."), TypeScript type definitions
    // (placeholder?: string;), and variable references (placeholder, or placeholder))
    skipRe: /placeholder\s*[=:?]|placeholder\s*[,);]?\s*$|,\s*placeholder/i,
  },
];

function checkStaleCopyPatterns(): CheckResult[] {
  const results: CheckResult[] = [];

  const sourceFiles = walkFiles(path.join(MEMTOOL_DIR, "app"), (f) => {
    if (!f.endsWith(".tsx") && !f.endsWith(".ts")) return false;
    if (f.includes("node_modules")) return false;
    return true;
  }).concat(
    walkFiles(path.join(MEMTOOL_DIR, "lib"), (f) => {
      if (!f.endsWith(".tsx") && !f.endsWith(".ts")) return false;
      if (f.includes("node_modules")) return false;
      return true;
    }).concat(
      walkFiles(path.join(MEMTOOL_DIR, "components"), (f) => {
        if (!f.endsWith(".tsx") && !f.endsWith(".ts")) return false;
        if (f.includes("node_modules")) return false;
        return true;
      })
    )
  );

  for (const pattern of STALE_PATTERNS) {
    const hits: string[] = [];
    for (const file of sourceFiles) {
      if (file.includes(".test.") || file.includes(".haptics.")) continue;
      const source = readFileSafe(file);
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment-only lines (JS, TS, and JSX comment variants)
        const trimmed = line.trimStart();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("{/*") ||
          trimmed.startsWith("<!--")
        ) continue;
        if (!pattern.re.test(line)) continue;
        // Skip if the pattern's own skipRe matches (e.g. placeholder= JSX prop)
        if (pattern.skipRe && pattern.skipRe.test(line)) continue;
        hits.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    }
    if (hits.length === 0) {
      results.push(pass(`No "${pattern.label}" stale copy`, `Pattern not found in user-facing source files`));
    } else {
      results.push(
        warn(
          `Stale copy: "${pattern.label}"`,
          `${hits.length} occurrence(s):\n  - ${hits.slice(0, 5).join("\n  - ")}${hits.length > 5 ? `\n  …and ${hits.length - 5} more` : ""}`
        )
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 4 — Asset Reference Integrity
// ---------------------------------------------------------------------------

function checkAssetIntegrity(): CheckResult[] {
  const results: CheckResult[] = [];

  const AUDIT_SCRIPT = path.resolve(__filename);

  const sourceFiles = walkFiles(path.join(MEMTOOL_DIR), (f) => {
    if (!f.endsWith(".tsx") && !f.endsWith(".ts")) return false;
    if (f.includes("node_modules")) return false;
    if (f === AUDIT_SCRIPT) return false; // don't scan ourselves
    return true;
  });

  const missingAssets: string[] = [];
  const zeroBytAssets: string[] = [];
  const checkedPaths = new Set<string>();

  for (const file of sourceFiles) {
    const source = readFileSafe(file);
    const fileDir = path.dirname(file);

    let m: RegExpExecArray | null;

    // require("./assets/...") or require("../../assets/...") — relative paths
    const requireRelRe = /require\(["'`](\.[^"'`]*\/assets\/[^"'`]+)["'`]\)/g;
    while ((m = requireRelRe.exec(source)) !== null) {
      const assetRelPath = m[1];
      if (assetRelPath.includes("...")) continue; // skip ellipsis doc-examples
      const absolutePath = path.resolve(fileDir, assetRelPath);
      if (checkedPaths.has(absolutePath)) continue;
      checkedPaths.add(absolutePath);
      if (!exists(absolutePath)) {
        missingAssets.push(`${rel(file)}: require("${assetRelPath}")`);
      } else if (isZeroByte(absolutePath)) {
        zeroBytAssets.push(`${rel(file)}: require("${assetRelPath}") → zero bytes`);
      }
    }

    // require("@/assets/...") — alias paths
    const requireAliasRe = /require\(["'`](@\/assets\/[^"'`]+)["'`]\)/g;
    while ((m = requireAliasRe.exec(source)) !== null) {
      const aliasPath = m[1];
      if (aliasPath.includes("...")) continue;
      const absolutePath = path.join(MEMTOOL_DIR, aliasPath.replace("@/", ""));
      if (checkedPaths.has(absolutePath)) continue;
      checkedPaths.add(absolutePath);
      if (!exists(absolutePath)) {
        missingAssets.push(`${rel(file)}: require("${aliasPath}")`);
      } else if (isZeroByte(absolutePath)) {
        zeroBytAssets.push(`${rel(file)}: require("${aliasPath}") → zero bytes`);
      }
    }

    // import Foo from "@/assets/..." — static imports
    const importRe = /from\s+["'`](@\/assets\/[^"'`]+)["'`]/g;
    while ((m = importRe.exec(source)) !== null) {
      const assetPath = m[1].replace("@/", "");
      const absolutePath = path.join(MEMTOOL_DIR, assetPath);
      const candidates = [absolutePath, `${absolutePath}.png`, `${absolutePath}.jpg`, `${absolutePath}.gif`, `${absolutePath}.svg`, `${absolutePath}.mp4`];
      const found = candidates.some(exists);
      if (!found && !checkedPaths.has(absolutePath)) {
        checkedPaths.add(absolutePath);
        missingAssets.push(`${rel(file)}: import from "${m[1]}"`);
      }
    }
  }

  const total = checkedPaths.size;

  if (missingAssets.length === 0 && zeroBytAssets.length === 0) {
    results.push(pass("Asset reference integrity", `All ${total} checked asset reference(s) resolve to files on disk`));
  } else {
    if (missingAssets.length > 0) {
      results.push(
        fail(
          "Asset references resolve (missing files)",
          `${missingAssets.length} missing asset(s):\n  - ${missingAssets.slice(0, 10).join("\n  - ")}${missingAssets.length > 10 ? `\n  …and ${missingAssets.length - 10} more` : ""}`
        )
      );
    }
    if (zeroBytAssets.length > 0) {
      results.push(
        fail(
          "Asset references resolve (zero-byte files)",
          `${zeroBytAssets.length} zero-byte asset(s):\n  - ${zeroBytAssets.join("\n  - ")}`
        )
      );
    }
  }

  // Check key image and video asset directories for zero-byte files
  const assetDirs = [
    path.join(MEMTOOL_DIR, "assets", "images"),
    path.join(MEMTOOL_DIR, "assets", "brand"),
  ];

  const zeroByteFound: string[] = [];
  for (const dir of assetDirs) {
    const files = walkFiles(dir);
    for (const f of files) {
      if (isZeroByte(f)) zeroByteFound.push(rel(f));
    }
  }

  if (zeroByteFound.length === 0) {
    results.push(pass("No zero-byte assets in assets/images and assets/brand", "All image/brand assets have content"));
  } else {
    results.push(
      fail(
        "Zero-byte assets detected",
        `${zeroByteFound.length} zero-byte file(s): ${zeroByteFound.join(", ")}`
      )
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 5 — Store-Listing Completeness
// ---------------------------------------------------------------------------

const STORE_DISCLAIMER_PATTERNS = ["Known gap", "TODO", "to be added", "TBD"];

function checkStoreListings(): CheckResult[] {
  const results: CheckResult[] = [];

  // MemTool ships iOS-only — there is no Play Store listing. Do not
  // re-introduce a `play-store/` entry here.
  const stores: Array<{ name: string; listingPath: string; screenshotDir: string; requiredScreenshots: string[] }> = [
    {
      name: "App Store (iOS)",
      listingPath: path.join(MEMTOOL_DIR, "app-store", "STORE_LISTING.md"),
      screenshotDir: path.join(MEMTOOL_DIR, "app-store", "assets", "screenshots-marketing"),
      requiredScreenshots: [
        "raw-rgb-01-home.png",
        "raw-rgb-02-capture.png",
        "raw-rgb-03-archive.png",
        "raw-rgb-04-recap.png",
        "raw-rgb-05-ai-guide.png",
        "raw-rgb-06-paywall.png",
      ],
    },
  ];

  for (const store of stores) {
    if (!exists(store.listingPath)) {
      results.push(fail(`${store.name} STORE_LISTING.md present`, `Not found: ${rel(store.listingPath)}`));
      continue;
    }

    const content = readFileSafe(store.listingPath);
    const flagged: string[] = [];
    for (const pattern of STORE_DISCLAIMER_PATTERNS) {
      const re = new RegExp(pattern, "i");
      if (re.test(content)) {
        flagged.push(pattern);
      }
    }

    if (flagged.length === 0) {
      results.push(pass(`${store.name}: no gap/TODO markers in STORE_LISTING.md`, "Listing appears complete"));
    } else {
      results.push(
        warn(
          `${store.name}: STORE_LISTING.md has incomplete markers`,
          `Found these markers: ${flagged.join(", ")} — review and resolve before submitting`
        )
      );
    }

    // Check required screenshots
    const missingScreenshots = store.requiredScreenshots.filter(
      (s) => !exists(path.join(store.screenshotDir, s))
    );
    if (missingScreenshots.length === 0) {
      results.push(pass(`${store.name}: required screenshots present`, `All ${store.requiredScreenshots.length} screenshot(s) present`));
    } else {
      results.push(
        fail(
          `${store.name}: required screenshots present`,
          `Missing ${missingScreenshots.length} screenshot(s): ${missingScreenshots.join(", ")}`
        )
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 6 — Client-Server Contract
// ---------------------------------------------------------------------------

function checkClientServerContract(): CheckResult[] {
  const results: CheckResult[] = [];

  const openapiPath = path.join(WORKSPACE_ROOT, "lib", "api-spec", "openapi.yaml");
  const apiSpecDir = path.join(WORKSPACE_ROOT, "lib", "api-spec");

  if (!exists(openapiPath)) {
    results.push(fail("OpenAPI spec exists", `Not found: ${rel(openapiPath)}`));
  } else {
    results.push(pass("OpenAPI spec exists", rel(openapiPath)));

    console.error("  [6/7] Running OpenAPI codegen to check for drift…");

    // Run orval (the generation step only — skip typecheck:libs which is slow)
    // Use the api-spec package's orval binary directly
    const codegenResult = spawnSync(
      "pnpm",
      ["exec", "orval", "--config", "./orval.config.ts"],
      {
        cwd: apiSpecDir,
        timeout: 60_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    if (codegenResult.error || codegenResult.status !== 0) {
      // Any non-zero exit is a FAIL — a broken codegen run means we cannot
      // know if generated files are fresh, so report the error and stop here.
      const stderrSnippet = (codegenResult.stderr ?? "").trim().slice(0, 300);
      results.push(
        fail(
          "OpenAPI codegen up-to-date (no diff after codegen)",
          `Orval exited with code ${codegenResult.status} — codegen is broken or the spec is invalid.\n  Run \`pnpm --filter @workspace/api-spec run codegen\` manually to investigate.\n  stderr: ${stderrSnippet || "(empty)"}`
        )
      );
    } else {
      // Check git diff on ALL orval-generated output directories:
      //   lib/api-client-react/src/ — React Query hooks (api-client-react target)
      //   lib/api-zod/src/          — Zod schemas (zod target)
      const diffResult = spawnSync(
        "git",
        [
          "diff",
          "--name-only",
          "--",
          "lib/api-client-react/src/",
          "lib/api-zod/src/",
        ],
        { cwd: WORKSPACE_ROOT, timeout: 10_000, encoding: "utf8" }
      );

      const changedFiles = (diffResult.stdout ?? "")
        .trim()
        .split("\n")
        .filter(Boolean);

      if (changedFiles.length === 0) {
        results.push(
          pass(
            "OpenAPI codegen up-to-date (no diff after codegen)",
            "Generated API client and Zod schemas match openapi.yaml — no drift detected"
          )
        );
      } else {
        results.push(
          fail(
            "OpenAPI codegen up-to-date (no diff after codegen)",
            `Codegen produced changes to ${changedFiles.length} generated file(s) — commit the updated output:\n  - ${changedFiles.join("\n  - ")}`
          )
        );
      }
    }
  }

  // Dynamically scan lib/**/*.ts(x) for raw fetch() calls that bypass codegen
  // A raw fetch() in lib means the call is not going through the generated API hooks
  const libDir = path.join(MEMTOOL_DIR, "lib");
  const libSourceFiles = walkFiles(libDir, (f) => {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) return false;
    if (f.includes("node_modules")) return false;
    if (f.includes(".test.")) return false;
    return true;
  });

  interface FetchUsage {
    file: string;
    line: number;
    snippet: string;
  }
  const manualFetchUsages: FetchUsage[] = [];

  for (const f of libSourceFiles) {
    const source = readFileSafe(f);
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      // Skip comment lines
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      // Detect actual fetch() calls (not doc comments or string mentions)
      if (/(?:await|=|\breturn\b)\s+fetch\s*\(/.test(line) || /\bfetch\s*\(\s*(?:url|input|buildEndpoint|`|"|')/.test(line)) {
        manualFetchUsages.push({ file: rel(f), line: i + 1, snippet: trimmed.slice(0, 80) });
      }
    }
  }

  // Group by file for a cleaner report
  const fetchByFile = new Map<string, number[]>();
  for (const u of manualFetchUsages) {
    if (!fetchByFile.has(u.file)) fetchByFile.set(u.file, []);
    fetchByFile.get(u.file)!.push(u.line);
  }

  if (fetchByFile.size === 0) {
    results.push(pass("No raw fetch() bypasses in lib/", "All lib API calls go through the generated client"));
  } else {
    const summary = [...fetchByFile.entries()]
      .map(([f, lines]) => `${f} (line${lines.length > 1 ? "s" : ""} ${lines.join(", ")})`)
      .join("\n  - ");
    results.push(
      warn(
        "Raw fetch() calls in lib/ bypass the generated API client",
        `${fetchByFile.size} file(s) contain raw fetch() calls not going through the codegen hooks:\n  - ${summary}\n  Review each call: if intentional (auth wrapper, streaming, non-OpenAPI endpoint), add a comment explaining why.`
      )
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 7 — Account Deletion E2E (Task #399)
// ---------------------------------------------------------------------------
// Runs `pnpm --filter @workspace/scripts run e2e:delete-account`, which
// registers a throwaway account, signs in, deletes it via the api-server,
// then verifies (a) the local server-side data is gone and (b) the upstream
// Polsia identity record is verifiably gone (a fresh login attempt with
// the same credentials returns 401). Catches a regression where the
// api-server silently swallows or skips the upstream DELETE — the failure
// mode unit tests with mocks cannot reproduce.
//
// Requires live network access to the configured upstream hosts. Skipped
// (WARN) when `SKIP_E2E_DELETE_ACCOUNT=1` is set, e.g. for offline / air-
// gapped CI runs. Override the upstream targets with `E2E_AUTH_API_BASE`
// and `E2E_REPLIT_API_BASE` to point the audit at staging instead of
// production.

function checkAccountDeletionE2E(): CheckResult[] {
  const results: CheckResult[] = [];

  if (process.env.SKIP_E2E_DELETE_ACCOUNT === "1") {
    results.push(
      warn(
        "Account deletion E2E (register → login → delete → re-login fails)",
        "Skipped: SKIP_E2E_DELETE_ACCOUNT=1. Run `pnpm --filter @workspace/scripts run e2e:delete-account` manually before submitting.",
      ),
    );
    return results;
  }

  console.error("  [7/8] Running account-deletion E2E (live network)…");

  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "e2e:delete-account"],
    {
      cwd: WORKSPACE_ROOT,
      timeout: 120_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT");

  if (timedOut) {
    results.push(
      fail(
        "Account deletion E2E (register → login → delete → re-login fails)",
        "E2E script did not finish within 120 s — treated as a FAIL. " +
          "Run `pnpm --filter @workspace/scripts run e2e:delete-account` locally for diagnostics, " +
          "or set SKIP_E2E_DELETE_ACCOUNT=1 if the run environment cannot reach the upstream hosts.",
      ),
    );
    return results;
  }

  if (result.status === 0) {
    results.push(
      pass(
        "Account deletion E2E (register → login → delete → re-login fails)",
        "All 5 steps passed: register, login, delete, local-data-gone (401), upstream-gone (re-login 401).",
      ),
    );
    return results;
  }

  // Pull the most useful diagnostic lines (StepError messages prefixed
  // with `[<timestamp>] [<step>]`) so the report explains *which* step
  // failed without dumping the whole stdout.
  const diagLines = output
    .split("\n")
    .filter((l) => /\] \[(register|login|delete|local-data-gone|upstream-gone|cleanup|setup|done)\]/.test(l))
    .slice(-12)
    .map((l) => l.trim());
  const tail = diagLines.length > 0 ? diagLines.join("\n") : output.trim().split("\n").slice(-10).join("\n");

  results.push(
    fail(
      "Account deletion E2E (register → login → delete → re-login fails)",
      `E2E script exited with code ${result.status}. Recent output:\n${tail}`,
    ),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Category 8 — Test Coverage Signal
// ---------------------------------------------------------------------------

function checkTestCoverage(): CheckResult[] {
  const results: CheckResult[] = [];

  console.error("  [8/8] Running test suite (may take up to 90s)…");

  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/memtool", "run", "test", "--passWithNoTests", "--forceExit", "--no-coverage"],
    {
      cwd: WORKSPACE_ROOT,
      timeout: 90_000,
      encoding: "utf8",
      // Merge stderr into stdout so we capture everything in one string
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const timedOut = result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT");

  if (timedOut) {
    results.push(
      fail(
        "Test suite passes",
        "Test runner did not finish within 90 s — this is treated as a FAIL for CI reliability. Run `pnpm --filter @workspace/memtool run test` locally for full results."
      )
    );
    return results;
  }

  if (!output && result.status !== 0) {
    results.push(
      fail(
        "Test suite passes",
        `Test runner exited with code ${result.status ?? "n/a"} and produced no output — test infrastructure failure. Run \`pnpm --filter @workspace/memtool run test\` locally.`
      )
    );
    return results;
  }

  const lines = output.split("\n");
  const failedMatch = output.match(/Tests:\s+[^\n]*?(\d+)\s+failed/);
  const passedMatch = output.match(/Tests:\s+[^\n]*?(\d+)\s+passed/);
  const skippedMatch = output.match(/Tests:\s+[^\n]*?(\d+)\s+skipped/);
  const suitesFailedMatch = output.match(/Test Suites:\s+[^\n]*?(\d+)\s+failed/);

  const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
  const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
  const skipped = skippedMatch ? parseInt(skippedMatch[1]) : 0;
  const suitesFailed = suitesFailedMatch ? parseInt(suitesFailedMatch[1]) : 0;

  const failLines = lines
    .filter((l) => l.includes("● ") || l.match(/FAIL\s+\S/))
    .slice(0, 10)
    .map((l) => l.trim());

  if (failed === 0 && suitesFailed === 0 && result.status === 0) {
    const detail = `${passed} test(s) passed${skipped > 0 ? `, ${skipped} skipped` : ""}`;
    results.push(pass("Test suite passes", detail));
  } else if (failed > 0 || suitesFailed > 0) {
    const detail = [
      `${failed} test(s) failed across ${suitesFailed} suite(s)`,
      passed > 0 ? `${passed} passed` : null,
      skipped > 0 ? `${skipped} skipped` : null,
      failLines.length > 0 ? `Key failures:\n  - ${failLines.join("\n  - ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    results.push(fail("Test suite passes", detail));
  } else {
    // Non-zero exit but no Jest pattern matched — treat as FAIL for CI reliability
    const tail = lines.filter((l) => l.trim()).slice(-8).join("\n");
    results.push(
      fail(
        "Test suite passes",
        `Exit code ${result.status} with no parsed Jest counts — possible test infrastructure failure. Last output:\n${tail}`
      )
    );
  }

  if (skipped > 0) {
    results.push(
      warn(
        "Skipped tests",
        `${skipped} test(s) skipped — confirm each skip is intentional before submitting`
      )
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Category 8 — Stripe Upgrade E2E (opt-in)
// ---------------------------------------------------------------------------
//
// Drives a real Stripe test-mode checkout (4242 card) against the
// configured Polsia gateway and asserts that `/subscription/status`
// flips `is_pro` to `true`. Catches regressions that the unit tests
// can't see — webhook stops landing, response shape drifts between
// `url`/`checkout_url`/`checkoutUrl`, gateway 502s, etc. (Task #398).
//
// Opt-in via `RUN_STRIPE_E2E=1` because the probe takes ~30–90 s,
// requires network egress to Stripe's hosted checkout, and depends on
// Stripe being wired in the target environment. Pre-launch runs against
// staging set the env var; local audit runs leave it off.
//
// The probe script returns three exit states:
//   0 — Pro entitlement confirmed (PASS)
//   2 — Soft skip (e.g. STRIPE_NOT_CONFIGURED at the gateway) — WARN
//   1 — Hard failure — FAIL
//
// The check is also explicitly registered (not silently absent) when
// the env var is unset so reviewers see at-a-glance whether the gate
// was actually exercised.

function checkStripeUpgradeE2E(): CheckResult[] {
  const results: CheckResult[] = [];

  const optedIn = process.env.RUN_STRIPE_E2E === "1";
  if (!optedIn) {
    results.push(
      warn(
        "Stripe upgrade E2E",
        "Skipped — set RUN_STRIPE_E2E=1 to drive a real Stripe test-mode checkout against the configured Polsia gateway and assert is_pro flips to true. Required for the pre-launch / staging gate; left off locally so the audit stays fast.",
      ),
    );
    return results;
  }

  console.error("  [8/8] Driving Stripe test checkout (may take up to 3 min)…");

  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "e2e:stripe-upgrade"],
    {
      cwd: WORKSPACE_ROOT,
      timeout: 180_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const tail = output
    .split("\n")
    .filter((l) => l.trim())
    .slice(-12)
    .join("\n");
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT");

  if (timedOut) {
    results.push(
      fail(
        "Stripe upgrade E2E",
        `Probe did not finish within 180 s. Tail:\n${tail}`,
      ),
    );
    return results;
  }

  if (result.status === 0) {
    results.push(
      pass(
        "Stripe upgrade E2E",
        `Real Stripe test checkout completed and /subscription/status reported is_pro=true.`,
      ),
    );
    return results;
  }

  if (result.status === 2) {
    // Documented soft-skip exit code from the probe — the gateway
    // returned STRIPE_NOT_CONFIGURED, so the rail isn't exercisable
    // in this environment. Surface as WARN (not FAIL) so a transient
    // upstream state doesn't block the audit, but make the reason
    // visible so reviewers don't ship blind.
    results.push(
      warn(
        "Stripe upgrade E2E",
        `Probe soft-skipped (exit 2). Tail:\n${tail}`,
      ),
    );
    return results;
  }

  results.push(
    fail(
      "Stripe upgrade E2E",
      `Probe exited with code ${result.status ?? "n/a"}. Tail:\n${tail}`,
    ),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function statusIcon(s: Status): string {
  return s === "PASS" ? "✅ PASS" : s === "WARN" ? "⚠️  WARN" : "❌ FAIL";
}

function renderReport(categories: Category[], date: string): string {
  const lines: string[] = [];
  lines.push("# Pre-Launch Readiness Audit");
  lines.push("");
  lines.push(`**Generated:** ${date}`);
  lines.push(`**Project:** MemTool (\`com.polsia.memtool\`)`);
  lines.push("");

  // Summary table
  let totalPass = 0;
  let totalWarn = 0;
  let totalFail = 0;
  for (const cat of categories) {
    for (const c of cat.checks) {
      if (c.status === "PASS") totalPass++;
      else if (c.status === "WARN") totalWarn++;
      else totalFail++;
    }
  }
  const totalChecks = totalPass + totalWarn + totalFail;
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| ✅ PASS | ${totalPass} |`);
  lines.push(`| ⚠️  WARN | ${totalWarn} |`);
  lines.push(`| ❌ FAIL | ${totalFail} |`);
  lines.push(`| **Total** | **${totalChecks}** |`);
  lines.push("");

  if (totalFail > 0) {
    lines.push(`> **${totalFail} FAIL(s) detected — resolve before submitting.**`);
  } else if (totalWarn > 0) {
    lines.push(`> No FAILs detected. ${totalWarn} WARN(s) require review before submission.`);
  } else {
    lines.push(`> All checks passed. The build appears ready for submission.`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const cat of categories) {
    lines.push(`## ${cat.title}`);
    lines.push("");
    lines.push("| Status | Check | Detail |");
    lines.push("|--------|-------|--------|");
    for (const c of cat.checks) {
      const detail = c.detail.replace(/\n/g, " ").replace(/\|/g, "\\|");
      lines.push(`| ${statusIcon(c.status)} | ${c.name} | ${detail} |`);
    }
    lines.push("");

    // Expand multi-line FAILs and WARNs
    for (const c of cat.checks) {
      if ((c.status === "FAIL" || c.status === "WARN") && c.detail.includes("\n")) {
        lines.push(`### ${statusIcon(c.status)}: ${c.name}`);
        lines.push("");
        lines.push("```");
        lines.push(c.detail);
        lines.push("```");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const date = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  console.log(`\n🔍 Running MemTool pre-launch readiness audit — ${date}\n`);
  console.log(
    "ℹ️  MemTool ships iOS-only via App Store Connect. Android / Play Store targets are intentionally not audited.\n",
  );

  const categories: Category[] = [
    {
      title: "1. Submit Blockers",
      checks: checkSubmitBlockers(),
    },
    {
      title: "2. Dead-Link / Orphan-Route Detection",
      checks: checkDeadLinks(),
    },
    {
      title: "3. Stale Copy / TODO Scan",
      checks: checkStaleCopyPatterns(),
    },
    {
      title: "4. Asset Reference Integrity",
      checks: checkAssetIntegrity(),
    },
    {
      title: "5. Store-Listing Completeness",
      checks: checkStoreListings(),
    },
    {
      title: "6. Client-Server Contract",
      checks: checkClientServerContract(),
    },
    {
      title: "7. Account Deletion E2E",
      checks: checkAccountDeletionE2E(),
    },
    {
      title: "8. Test Coverage Signal",
      checks: checkTestCoverage(),
    },
    {
      title: "8. Stripe Upgrade E2E",
      checks: checkStripeUpgradeE2E(),
    },
  ];

  const report = renderReport(categories, date);

  // Print to stdout
  console.log(report);

  // Write to docs/PRELAUNCH_AUDIT_LATEST.md
  const outputPath = path.join(MEMTOOL_DIR, "docs", "PRELAUNCH_AUDIT_LATEST.md");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  console.log(`\n📄 Report written to ${rel(outputPath)}\n`);

  // Exit non-zero if any FAIL
  const anyFail = categories.some((cat) => cat.checks.some((c) => c.status === "FAIL"));
  if (anyFail) {
    const failCount = categories.flatMap((c) => c.checks).filter((c) => c.status === "FAIL").length;
    console.error(`\n❌ ${failCount} FAIL(s) detected — resolve before submitting.\n`);
    process.exit(1);
  } else {
    const warnCount = categories.flatMap((c) => c.checks).filter((c) => c.status === "WARN").length;
    if (warnCount > 0) {
      console.log(`⚠️  ${warnCount} WARN(s) — review before submitting.\n`);
    } else {
      console.log(`✅ All checks passed.\n`);
    }
  }
}

main().catch((err) => {
  console.error("Audit script crashed:", err);
  process.exit(2);
});
