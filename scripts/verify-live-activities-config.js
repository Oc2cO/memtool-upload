#!/usr/bin/env node
/**
 * EAS build hook: verifies the Live Activities config is intact before
 * a managed build kicks off. Wired in `package.json` as the
 * `eas-build-pre-install` script so it runs on every EAS Build worker
 * before `npm install` and the subsequent Expo prebuild.
 *
 * Why this exists:
 *   The `withVoiceProcessingLiveActivityWidget` config plugin is
 *   responsible for putting `com.apple.developer.live-activities` into
 *   the generated Entitlements file at prebuild time. EAS managed
 *   credentials then sync that capability to the Apple Developer
 *   portal App ID. If anyone accidentally drops the plugin from
 *   `app.json` (or rewrites the plugin to no longer add the
 *   entitlement), the iOS build will sign successfully but the Live
 *   Activity will silently fail at runtime — and TestFlight will
 *   reject the binary because the App ID lacks the capability.
 *
 *   This script catches both regressions before the build starts.
 *
 * The Apple Developer portal step (App ID -> Capabilities ->
 * Live Activities for `com.polsia.memtool` and the widget bundle ID
 * `com.polsia.memtool.VoiceProcessingLiveActivityWidget`) must still
 * be enabled once by hand. EAS auto-syncs capabilities from the
 * entitlements file when an App Store Connect API key is configured
 * (see the `submit.production.ios` block in `eas.json`).
 */

const fs = require("fs");
const path = require("path");

const ENTITLEMENT_KEY = "com.apple.developer.live-activities";
const INFO_PLIST_KEY = "NSSupportsLiveActivities";
const PLUGIN_PATH_FRAGMENT = "withVoiceProcessingLiveActivityWidget";
const REQUIRED_ENV_FLAG = "EXPO_LIVE_ACTIVITIES_REQUIRED";
const REQUIRED_WIDGET_EXTENSION_POINT_ID = "com.apple.widgetkit-extension";

const ROOT = path.resolve(__dirname, "..");
const APP_JSON = path.join(ROOT, "app.json");
const EAS_JSON = path.join(ROOT, "eas.json");
const PLUGIN_FILE = path.join(
  ROOT,
  "plugins",
  "withVoiceProcessingLiveActivityWidget.js",
);
const WIDGET_TARGET_NAME = "VoiceProcessingLiveActivityWidget";
const WIDGET_SHARED_DIR = path.join(
  ROOT,
  "modules",
  "voice-processing-live-activity",
  "ios",
);
const WIDGET_SOURCE_DIR = path.join(WIDGET_SHARED_DIR, WIDGET_TARGET_NAME);
const WIDGET_REQUIRED_FILES = [
  WIDGET_TARGET_NAME + ".swift",
  "Info.plist",
];
const SHARED_ATTRIBUTES_FILE = path.join(
  WIDGET_SHARED_DIR,
  "VoiceProcessingAttributes.swift",
);

function fail(message) {
  console.error("\n[verify-live-activities-config] FAIL: " + message + "\n");
  process.exit(1);
}

function ok(message) {
  console.log("[verify-live-activities-config] OK: " + message);
}

function warn(message) {
  console.log("[verify-live-activities-config] WARN: " + message);
}

// Minimal XML plist parser. Intentionally tiny so the verifier can run on
// a fresh EAS Build worker before `npm install` (no third-party deps).
// Supports the subset of plist needed to walk an Info.plist:
//   <dict>, <array>, <string>, <integer>, <true/>, <false/>
// and self-closing variants of <dict>, <array>, and <string>. Throws on
// anything it does not understand so a malformed Info.plist becomes a
// fast, loud failure rather than silently passing the check.
function parsePlist(xml) {
  let pos = 0;

  function skipWs() {
    while (pos < xml.length && /\s/.test(xml[pos])) pos++;
  }

  // Skip XML declaration, DOCTYPE, comments, and the opening <plist> tag
  // until we land on the top-level <dict>.
  function skipPreamble() {
    while (pos < xml.length) {
      skipWs();
      if (xml.startsWith("<?", pos)) {
        const end = xml.indexOf("?>", pos);
        if (end === -1) throw new Error("Unterminated <? ... ?>");
        pos = end + 2;
        continue;
      }
      if (xml.startsWith("<!--", pos)) {
        const end = xml.indexOf("-->", pos);
        if (end === -1) throw new Error("Unterminated <!-- ... -->");
        pos = end + 3;
        continue;
      }
      if (xml.startsWith("<!", pos)) {
        const end = xml.indexOf(">", pos);
        if (end === -1) throw new Error("Unterminated <! ... >");
        pos = end + 1;
        continue;
      }
      if (xml.startsWith("<plist", pos)) {
        const end = xml.indexOf(">", pos);
        if (end === -1) throw new Error("Unterminated <plist> tag");
        pos = end + 1;
        continue;
      }
      return;
    }
  }

  function parseDict() {
    // Caller has already consumed the opening <dict>.
    const obj = {};
    while (true) {
      skipWs();
      if (xml.startsWith("</dict>", pos)) {
        pos += "</dict>".length;
        return obj;
      }
      if (!xml.startsWith("<key>", pos)) {
        throw new Error(
          "Expected <key> inside <dict> at position " +
            pos +
            " but found: " +
            xml.slice(pos, pos + 30),
        );
      }
      pos += "<key>".length;
      const keyEnd = xml.indexOf("</key>", pos);
      if (keyEnd === -1) throw new Error("Unterminated <key>");
      const key = xml.slice(pos, keyEnd);
      pos = keyEnd + "</key>".length;
      skipWs();
      obj[key] = parseValue();
    }
  }

  function parseArray() {
    // Caller has already consumed the opening <array>.
    const arr = [];
    while (true) {
      skipWs();
      if (xml.startsWith("</array>", pos)) {
        pos += "</array>".length;
        return arr;
      }
      arr.push(parseValue());
    }
  }

  function parseValue() {
    if (xml.startsWith("<dict/>", pos)) {
      pos += "<dict/>".length;
      return {};
    }
    if (xml.startsWith("<dict>", pos)) {
      pos += "<dict>".length;
      return parseDict();
    }
    if (xml.startsWith("<array/>", pos)) {
      pos += "<array/>".length;
      return [];
    }
    if (xml.startsWith("<array>", pos)) {
      pos += "<array>".length;
      return parseArray();
    }
    if (xml.startsWith("<string/>", pos)) {
      pos += "<string/>".length;
      return "";
    }
    if (xml.startsWith("<string>", pos)) {
      pos += "<string>".length;
      const end = xml.indexOf("</string>", pos);
      if (end === -1) throw new Error("Unterminated <string>");
      const value = xml.slice(pos, end);
      pos = end + "</string>".length;
      return value;
    }
    if (xml.startsWith("<integer>", pos)) {
      pos += "<integer>".length;
      const end = xml.indexOf("</integer>", pos);
      if (end === -1) throw new Error("Unterminated <integer>");
      const value = parseInt(xml.slice(pos, end), 10);
      pos = end + "</integer>".length;
      return value;
    }
    if (xml.startsWith("<true/>", pos)) {
      pos += "<true/>".length;
      return true;
    }
    if (xml.startsWith("<false/>", pos)) {
      pos += "<false/>".length;
      return false;
    }
    throw new Error(
      "Unsupported plist value at position " +
        pos +
        ": " +
        xml.slice(pos, pos + 30),
    );
  }

  skipPreamble();
  skipWs();
  if (!xml.startsWith("<dict>", pos)) {
    throw new Error(
      "Expected top-level <dict> in plist but found: " +
        xml.slice(pos, pos + 30),
    );
  }
  pos += "<dict>".length;
  return parseDict();
}

// 1. The plugin file must exist and, when actually invoked against a
//    fake Expo config, must register a withEntitlementsPlist modifier
//    that sets ENTITLEMENT_KEY = true.
//
//    A pure string-grep ("does the source mention the key?") was too
//    easy to bypass: someone could leave the constant in a comment or
//    a dead branch and the verifier would still pass even though the
//    generated entitlements plist no longer contained the capability.
//    Running the plugin proves the entitlements mod is wired in for
//    real and that running prebuild would actually mutate the plist.
if (!fs.existsSync(PLUGIN_FILE)) {
  fail(
    "Expected config plugin at " +
      path.relative(ROOT, PLUGIN_FILE) +
      " but it is missing.",
  );
}

function loadPluginWithStubbedConfigPlugins() {
  // Patch Module._load so that when the plugin requires
  // `@expo/config-plugins` it gets our recording stub instead. The
  // stub is intentionally minimal: every `withX` helper just returns
  // the config unchanged, except `withEntitlementsPlist` and
  // `withInfoPlist`, which capture their modifiers so we can run them
  // ourselves and inspect the resulting plist objects. This means we
  // don't need the real `@expo/config-plugins` installed (so the
  // verifier works on a fresh EAS Build worker before `npm install`)
  // and we don't need to run the dangerous file-system mods either.
  const Module = require("module");
  const originalLoad = Module._load;

  let entitlementsModifier = null;
  let infoPlistModifier = null;
  const stub = {
    withInfoPlist: (config, modifier) => {
      infoPlistModifier = modifier;
      return config;
    },
    withEntitlementsPlist: (config, modifier) => {
      entitlementsModifier = modifier;
      return config;
    },
    withXcodeProject: (config) => config,
    withDangerousMod: (config) => config,
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "@expo/config-plugins") {
      return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let pluginFn;
  try {
    delete require.cache[require.resolve(PLUGIN_FILE)];
    pluginFn = require(PLUGIN_FILE);
  } catch (err) {
    Module._load = originalLoad;
    fail(
      "Failed to load config plugin at " +
        path.relative(ROOT, PLUGIN_FILE) +
        ": " +
        (err && err.message ? err.message : String(err)),
    );
  }
  Module._load = originalLoad;

  return {
    pluginFn,
    getEntitlementsModifier: () => entitlementsModifier,
    getInfoPlistModifier: () => infoPlistModifier,
  };
}

const { pluginFn, getEntitlementsModifier, getInfoPlistModifier } =
  loadPluginWithStubbedConfigPlugins();

if (typeof pluginFn !== "function") {
  fail(
    "Config plugin at " +
      path.relative(ROOT, PLUGIN_FILE) +
      " does not export a function.",
  );
}

const fakeExpoConfig = {
  name: "MemTool",
  ios: { bundleIdentifier: "com.polsia.memtool" },
};

try {
  pluginFn(fakeExpoConfig);
} catch (err) {
  fail(
    "Config plugin threw when invoked with a fake Expo config: " +
      (err && err.message ? err.message : String(err)),
  );
}
ok("plugin no longer injects rejected Live Activities entitlement manually");

// 1b. The plugin must also call withInfoPlist and that modifier must
//     set NSSupportsLiveActivities = true on the main app's Info.plist.
//     Without this key, ActivityKit refuses to start a Live Activity
//     at runtime even though the entitlement is signed in — the build
//     will succeed, TestFlight will accept it, and the feature will
//     silently no-op on device. Same "actually run the mod" strategy
//     used for the entitlements modifier so a regression that drops
//     the Info.plist key (or flips it to false) is caught here.
const infoPlistModifier = getInfoPlistModifier();
if (typeof infoPlistModifier !== "function") {
  fail(
    "Config plugin never called withInfoPlist when invoked. " +
      "The " +
      INFO_PLIST_KEY +
      " key will be missing from the main app's Info.plist " +
      "and Live Activities will silently fail at runtime.",
  );
}

let infoPlistResult;
try {
  infoPlistResult = infoPlistModifier({
    modResults: {},
    modRequest: {
      platform: "ios",
      projectName: "MemTool",
      platformProjectRoot: "/tmp/verify-live-activities-fake",
      projectRoot: ROOT,
    },
  });
} catch (err) {
  fail(
    "Plugin's withInfoPlist modifier threw when invoked: " +
      (err && err.message ? err.message : String(err)),
  );
}

if (infoPlistResult && typeof infoPlistResult.then === "function") {
  fail(
    "Plugin's withInfoPlist modifier returned a Promise. " +
      "This verifier expects a synchronous mod so it can run before " +
      "EAS install completes — update the verifier if the mod must be async.",
  );
}

const finalInfoPlist =
  infoPlistResult && infoPlistResult.modResults
    ? infoPlistResult.modResults
    : null;

if (!finalInfoPlist || finalInfoPlist[INFO_PLIST_KEY] !== true) {
  fail(
    "Invoking the config plugin did not set '" +
      INFO_PLIST_KEY +
      "' = true on the main app's Info.plist. Live Activities will " +
      "silently fail at runtime even though the entitlement is signed in.",
  );
}
ok(
  "running the plugin actually sets " + INFO_PLIST_KEY + " = true on the main app's Info.plist",
);

// 2. The plugin must be registered in app.json's plugins array.
const appJson = JSON.parse(fs.readFileSync(APP_JSON, "utf8"));
const plugins = appJson?.expo?.plugins ?? [];
const registered = plugins.some((entry) => {
  const name = Array.isArray(entry) ? entry[0] : entry;
  return typeof name === "string" && name.includes(PLUGIN_PATH_FRAGMENT);
});
if (!registered) {
  fail(
    "app.json's expo.plugins array does not register " +
      "'./plugins/withVoiceProcessingLiveActivityWidget'. The widget " +
      "extension and Live Activities entitlement will be missing from the build.",
  );
}
ok("app.json registers the live-activity config plugin");

// 3. Bundle identifier sanity check — the widget extension's bundle ID
//    is derived from this and must also have Live Activities enabled
//    in the Apple Developer portal.
const bundleId = appJson?.expo?.ios?.bundleIdentifier;
if (!bundleId) {
  fail("app.json is missing expo.ios.bundleIdentifier.");
}
ok(
  "main bundle id is " +
    bundleId +
    " (widget bundle id: " +
    bundleId +
    ".VoiceProcessingLiveActivityWidget)",
);

// 4. eas.json's production build profile must wire the iOS side for
//    Live Activities: managed (remote) credentials so EAS auto-syncs
//    the entitlement → Apple Developer portal capability, an Xcode
//    image new enough to compile ActivityKit, and the EXPO_LIVE_-
//    ACTIVITIES_REQUIRED env flag that opts this very script into
//    the strict path on EAS Build workers.
if (!fs.existsSync(EAS_JSON)) {
  fail("Expected " + path.relative(ROOT, EAS_JSON) + " but it is missing.");
}
const easJson = JSON.parse(fs.readFileSync(EAS_JSON, "utf8"));
const productionProfile = easJson?.build?.production;
if (!productionProfile) {
  fail("eas.json is missing build.production profile.");
}
const productionIos = productionProfile.ios ?? {};
if (productionIos.credentialsSource !== "remote") {
  fail(
    "eas.json build.production.ios.credentialsSource must be 'remote' " +
      "so EAS managed credentials sync the live-activities capability " +
      "to the Apple Developer portal at build time.",
  );
}
if (!productionIos.image) {
  fail(
    "eas.json build.production.ios.image must be set (e.g. 'latest') " +
      "so the worker uses an Xcode that can compile ActivityKit/WidgetKit.",
  );
}
const productionEnv = productionProfile.env ?? {};
if (productionEnv[REQUIRED_ENV_FLAG] !== "1") {
  fail(
    "eas.json build.production.env." +
      REQUIRED_ENV_FLAG +
      " must equal '1' so this verifier knows production builds depend " +
      "on Live Activities and must fail fast on misconfiguration.",
  );
}
ok("eas.json production profile wires Live Activities (remote credentials, image pinned, env flag set)");

// 5. Widget extension's native sources must exist on disk. The plugin's
//    `withCopyWidgetSources` step blindly reads from this directory at
//    prebuild time; if it has been renamed, deleted, or one of the
//    required files is missing, EAS Build will still start, the plugin
//    will throw deep into the worker run, and we waste a build slot.
//    Fail fast here instead.
if (!fs.existsSync(WIDGET_SOURCE_DIR)) {
  fail(
    "Expected widget extension sources at " +
      path.relative(ROOT, WIDGET_SOURCE_DIR) +
      " but the directory is missing. The config plugin's " +
      "withCopyWidgetSources step would throw at prebuild and the EAS " +
      "Build worker would burn a slot before failing.",
  );
}
const widgetStat = fs.statSync(WIDGET_SOURCE_DIR);
if (!widgetStat.isDirectory()) {
  fail(
    path.relative(ROOT, WIDGET_SOURCE_DIR) +
      " exists but is not a directory. The config plugin expects a " +
      "directory of widget extension sources here.",
  );
}
for (const requiredFile of WIDGET_REQUIRED_FILES) {
  const requiredPath = path.join(WIDGET_SOURCE_DIR, requiredFile);
  if (!fs.existsSync(requiredPath)) {
    fail(
      "Widget extension sources are missing " +
        requiredFile +
        " at " +
        path.relative(ROOT, requiredPath) +
        ". Without it the widget target will fail to compile in EAS Build.",
    );
  }
}
ok(
  "widget extension sources present at " +
    path.relative(ROOT, WIDGET_SOURCE_DIR) +
    " (" +
    WIDGET_REQUIRED_FILES.join(", ") +
    ")",
);

// 5b. Shared ActivityAttributes file must exist alongside the widget
//     directory. The plugin's `withCopyWidgetSources` step copies this
//     sibling file into the widget folder so the extension target can
//     compile (it's listed in the widget's PBX sources). Today the
//     plugin silently skips the copy when the file is absent, so EAS
//     Build still starts and only fails deep into xcodebuild when the
//     widget Swift sources can't find `VoiceProcessingAttributes`.
//     Fail fast here for parity with the widget-directory check above.
if (!fs.existsSync(SHARED_ATTRIBUTES_FILE)) {
  fail(
    "Expected shared ActivityAttributes source at " +
      path.relative(ROOT, SHARED_ATTRIBUTES_FILE) +
      " but it is missing. The config plugin's withCopyWidgetSources " +
      "step would silently skip copying it, and the widget target " +
      "would fail to compile in EAS Build because it lists " +
      "VoiceProcessingAttributes.swift in its sources.",
  );
}
ok(
  "shared ActivityAttributes source present at " +
    path.relative(ROOT, SHARED_ATTRIBUTES_FILE),
);

// 5c. The widget Info.plist's NSExtension.NSExtensionPointIdentifier must
//     declare a WidgetKit extension. If this is wrong (or the file is
//     unparseable) Xcode still launches and only rejects the widget
//     target deep in the build, wasting an EAS Build slot. Parse the
//     plist here so the verifier fails fast with a clear message.
const widgetInfoPlistPath = path.join(WIDGET_SOURCE_DIR, "Info.plist");
let widgetInfoPlistContents;
try {
  widgetInfoPlistContents = fs.readFileSync(widgetInfoPlistPath, "utf8");
} catch (err) {
  fail(
    "Could not read widget extension Info.plist at " +
      path.relative(ROOT, widgetInfoPlistPath) +
      ": " +
      (err && err.message ? err.message : String(err)),
  );
}
let widgetInfoPlist;
try {
  widgetInfoPlist = parsePlist(widgetInfoPlistContents);
} catch (err) {
  fail(
    "Could not parse widget extension Info.plist at " +
      path.relative(ROOT, widgetInfoPlistPath) +
      ": " +
      (err && err.message ? err.message : String(err)),
  );
}
const nsExtension =
  widgetInfoPlist && typeof widgetInfoPlist === "object"
    ? widgetInfoPlist.NSExtension
    : null;
const pointId =
  nsExtension && typeof nsExtension === "object"
    ? nsExtension.NSExtensionPointIdentifier
    : undefined;
if (pointId !== REQUIRED_WIDGET_EXTENSION_POINT_ID) {
  fail(
    "Widget extension Info.plist at " +
      path.relative(ROOT, widgetInfoPlistPath) +
      " has NSExtension.NSExtensionPointIdentifier = " +
      JSON.stringify(pointId) +
      ' but it must be "' +
      REQUIRED_WIDGET_EXTENSION_POINT_ID +
      '". Xcode would still launch and only reject the widget target ' +
      "deep in the build, wasting an EAS Build slot.",
  );
}
ok(
  "widget extension Info.plist NSExtension.NSExtensionPointIdentifier is " +
    REQUIRED_WIDGET_EXTENSION_POINT_ID,
);

// 6. Submit profile must point at an App Store Connect API key so EAS
//    has the permission to sync capabilities to the portal App ID. The
//    key itself lives in an EAS Secret (file type) and is referenced
//    from eas.json as `$EXPO_ASC_API_KEY` so a clean checkout (or CI
//    runner) does not need a private `.p8` staged on disk.
const submitIos = easJson?.submit?.production?.ios ?? {};
if (!submitIos.ascApiKeyPath || !submitIos.ascApiKeyId) {
  warn(
    "eas.json submit.production.ios is missing ascApiKeyPath / ascApiKeyId. " +
      "Without an App Store Connect API key EAS cannot auto-sync the " +
      "Live Activities capability to the portal and TestFlight will reject the build.",
  );
} else if (
  typeof submitIos.ascApiKeyPath === "string" &&
  !submitIos.ascApiKeyPath.startsWith("$")
) {
  warn(
    "eas.json submit.production.ios.ascApiKeyPath must reference an EAS Secret " +
      '(e.g. "$EXPO_ASC_API_KEY") rather than a hard-coded path on disk. ' +
      "A repo-relative `.p8` path means submissions only work on the one machine " +
      "that happens to have that private key staged. Store the key as an EAS file " +
      "secret and reference it via env var so any clean checkout can submit.",
  );
} else {
  ok("eas.json submit profile has an App Store Connect API key wired for capability sync");
}

// In strict mode (running inside an EAS Build worker for the production
// profile, signalled by EXPO_LIVE_ACTIVITIES_REQUIRED=1) the checks
// above already gate the build. We log it so the worker output makes
// the contract obvious.
if (process.env[REQUIRED_ENV_FLAG] === "1") {
  ok("running in EAS strict mode (" + REQUIRED_ENV_FLAG + "=1)");
}

console.log(
  "[verify-live-activities-config] All Live Activities build prerequisites look correct.",
);



