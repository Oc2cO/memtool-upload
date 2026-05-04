/**
 * Tests for `verify-live-activities-config.js` — the `eas-build-pre-install`
 * hook that bails out before EAS Build wastes a worker on a misconfigured
 * Live Activities setup.
 *
 * Strategy: each test materializes a fresh sandbox directory that mirrors
 * the parts of the memtool layout the verifier reaches into (app.json,
 * eas.json, plugins/withVoiceProcessingLiveActivityWidget.js), then copies
 * the script under test into <sandbox>/scripts/ and runs it via
 * `child_process.spawnSync`. Because the script resolves all paths with
 * `path.resolve(__dirname, "..")`, the copied script reads from the
 * sandbox — never from the real repo — so each negative branch can be
 * exercised in isolation.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT_SOURCE = path.join(__dirname, "verify-live-activities-config.js");

// A "good" plugin: imports withEntitlementsPlist + withInfoPlist and
// actually sets the live-activities entitlement on the entitlements
// modResults object and NSSupportsLiveActivities on the Info.plist
// modResults object. The verifier's stub of @expo/config-plugins
// captures these modifiers and runs them.
const VALID_PLUGIN_SOURCE = `const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");
module.exports = function (config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    return cfg;
  });
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.live-activities"] = true;
    return cfg;
  });
  return config;
};
`;

// A plugin that doesn't touch entitlements at all — it doesn't even
// call withEntitlementsPlist. The verifier should fail because no
// entitlements modifier is registered.
const PLUGIN_WITHOUT_ENTITLEMENT_SOURCE = `module.exports = function (config) {
  // Plugin that no longer adds the entitlement key.
  return config;
};
`;

// A plugin that mentions the entitlement key in a comment (so the old
// string-grep check would pass) but whose withEntitlementsPlist
// modifier never actually sets the key. This is the regression the new
// "actually run the plugin" check exists to catch.
const PLUGIN_COMMENT_ONLY_SOURCE = `const { withEntitlementsPlist } = require("@expo/config-plugins");
module.exports = function (config) {
  // TODO: re-add com.apple.developer.live-activities once we redesign
  // the live activity flow. For now we intentionally do not set it.
  return withEntitlementsPlist(config, (cfg) => {
    return cfg;
  });
};
`;

// A plugin that correctly sets the entitlement but never calls
// withInfoPlist at all — i.e. the Info.plist mod was dropped during
// a refactor. The build would sign correctly but Live Activities
// would silently fail at runtime, so the verifier must catch this.
const PLUGIN_WITHOUT_INFO_PLIST_SOURCE = `const { withEntitlementsPlist } = require("@expo/config-plugins");
module.exports = function (config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.live-activities"] = true;
    return cfg;
  });
};
`;

// A plugin that sets the entitlement and does call withInfoPlist, but
// whose Info.plist modifier never actually assigns
// NSSupportsLiveActivities (e.g. the line was removed by accident).
// The verifier must catch this too — registering the mod is not
// enough, the mod must actually set the key to true.
const PLUGIN_INFO_PLIST_WITHOUT_KEY_SOURCE = `const { withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");
module.exports = function (config) {
  config = withInfoPlist(config, (cfg) => {
    return cfg;
  });
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["com.apple.developer.live-activities"] = true;
    return cfg;
  });
  return config;
};
`;

function buildValidAppJson() {
  return {
    expo: {
      name: "MemTool",
      ios: { bundleIdentifier: "com.polsia.memtool" },
      plugins: [
        ["./plugins/withVoiceProcessingLiveActivityWidget", {}],
        "expo-router",
      ],
    },
  };
}

const VALID_WIDGET_SWIFT_SOURCE = `import WidgetKit
import SwiftUI

@main
struct VoiceProcessingLiveActivityWidget: Widget {
  var body: some WidgetConfiguration { EmptyWidgetConfiguration() }
}
`;

const VALID_WIDGET_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;

const VALID_SHARED_ATTRIBUTES_SOURCE = `import ActivityKit
import Foundation

struct VoiceProcessingAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {}
}
`;

function buildValidEasJson() {
  return {
    build: {
      production: {
        env: { EXPO_LIVE_ACTIVITIES_REQUIRED: "1" },
        ios: { credentialsSource: "remote", image: "latest" },
      },
    },
    submit: {
      production: {
        ios: {
          ascApiKeyPath: "$EXPO_ASC_API_KEY",
          ascApiKeyId: "TESTKEYID",
        },
      },
    },
  };
}

/**
 * Materialize a sandbox project layout. `mutate` may modify the in-memory
 * fixtures (or null them out) before they are written to disk.
 */
function makeSandbox(mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-la-"));
  const fixtures = {
    appJson: buildValidAppJson(),
    easJson: buildValidEasJson(),
    pluginSource: VALID_PLUGIN_SOURCE,
    omitPluginFile: false,
    omitEasJson: false,
    // Widget extension native sources — `withCopyWidgetSources` reads
    // these at prebuild time. The verifier now refuses to start a
    // build when the directory or one of the required files is gone.
    widgetFiles: {
      "VoiceProcessingLiveActivityWidget.swift": VALID_WIDGET_SWIFT_SOURCE,
      "Info.plist": VALID_WIDGET_INFO_PLIST,
    },
    omitWidgetDir: false,
    // If set, create a regular file at the widget directory path
    // instead of a directory, to exercise the "exists but is not a
    // directory" branch.
    widgetDirAsFile: false,
    // Shared ActivityAttributes file that lives alongside the widget
    // directory. The plugin's `withCopyWidgetSources` step copies
    // this file into the widget folder; the verifier refuses to start
    // a build when it's gone.
    sharedAttributesSource: VALID_SHARED_ATTRIBUTES_SOURCE,
    omitSharedAttributesFile: false,
  };
  mutate(fixtures);

  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "app.json"),
    JSON.stringify(fixtures.appJson, null, 2),
  );
  if (!fixtures.omitEasJson) {
    fs.writeFileSync(
      path.join(root, "eas.json"),
      JSON.stringify(fixtures.easJson, null, 2),
    );
  }
  if (!fixtures.omitPluginFile) {
    fs.writeFileSync(
      path.join(root, "plugins", "withVoiceProcessingLiveActivityWidget.js"),
      fixtures.pluginSource,
    );
  }

  const sharedDir = path.join(
    root,
    "modules",
    "voice-processing-live-activity",
    "ios",
  );
  const widgetDir = path.join(sharedDir, "VoiceProcessingLiveActivityWidget");
  if (fixtures.widgetDirAsFile) {
    fs.mkdirSync(path.dirname(widgetDir), { recursive: true });
    fs.writeFileSync(widgetDir, "not a directory");
  } else if (!fixtures.omitWidgetDir) {
    fs.mkdirSync(widgetDir, { recursive: true });
    for (const [name, contents] of Object.entries(fixtures.widgetFiles)) {
      fs.writeFileSync(path.join(widgetDir, name), contents);
    }
  }
  if (!fixtures.omitSharedAttributesFile) {
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "VoiceProcessingAttributes.swift"),
      fixtures.sharedAttributesSource,
    );
  }

  fs.copyFileSync(
    SCRIPT_SOURCE,
    path.join(root, "scripts", "verify-live-activities-config.js"),
  );

  return root;
}

function runVerifier(sandboxRoot, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(sandboxRoot, "scripts", "verify-live-activities-config.js")],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
}

describe("verify-live-activities-config", () => {
  const sandboxes = [];

  function track(root) {
    sandboxes.push(root);
    return root;
  }

  afterAll(() => {
    for (const root of sandboxes) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("happy path: valid app.json, plugin, and eas.json pass", () => {
    const root = track(makeSandbox());
    const result = runVerifier(root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "All Live Activities build prerequisites look correct",
    );
  });

  test("strict mode banner is printed when EXPO_LIVE_ACTIVITIES_REQUIRED=1", () => {
    const root = track(makeSandbox());
    const result = runVerifier(root, { EXPO_LIVE_ACTIVITIES_REQUIRED: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "running in EAS strict mode (EXPO_LIVE_ACTIVITIES_REQUIRED=1)",
    );
  });

  test("fails when the config plugin file is missing entirely", () => {
    const root = track(
      makeSandbox((f) => {
        f.omitPluginFile = true;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Expected config plugin at plugins/withVoiceProcessingLiveActivityWidget.js",
    );
    expect(result.stderr).toContain("missing");
  });

  test("fails when the plugin never registers a withEntitlementsPlist modifier", () => {
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = PLUGIN_WITHOUT_ENTITLEMENT_SOURCE;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Config plugin never called withEntitlementsPlist when invoked",
    );
  });

  test("fails when the plugin only mentions the entitlement in a comment but never sets it", () => {
    // Regression for the old string-grep check: the source contains the
    // entitlement constant inside a TODO comment, but the actual mod
    // never assigns it. The "actually run the plugin" check must catch
    // this — a pure grep would not.
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = PLUGIN_COMMENT_ONLY_SOURCE;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    // Sanity-check that the source really would have fooled the grep.
    expect(PLUGIN_COMMENT_ONLY_SOURCE).toContain(
      "com.apple.developer.live-activities",
    );
    expect(result.stderr).toContain(
      "Invoking the config plugin did not set 'com.apple.developer.live-activities' = true",
    );
  });

  test("fails when the plugin sets the entitlement but never calls withInfoPlist", () => {
    // Regression for the Info.plist side of the contract: a refactor
    // could keep the entitlement modifier intact but drop the
    // Info.plist mod entirely. The build would sign correctly but
    // Live Activities would silently fail at runtime, so the verifier
    // must fail before the build starts.
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = PLUGIN_WITHOUT_INFO_PLIST_SOURCE;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Config plugin never called withInfoPlist when invoked",
    );
    expect(result.stderr).toContain("NSSupportsLiveActivities");
  });

  test("fails when the plugin's withInfoPlist mod does not set NSSupportsLiveActivities", () => {
    // The plugin registers a withInfoPlist modifier but the modifier
    // body never assigns NSSupportsLiveActivities (e.g. the line was
    // removed by mistake). Just registering the mod is not enough —
    // the verifier runs it and asserts the resulting plist has the
    // key set to true.
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = PLUGIN_INFO_PLIST_WITHOUT_KEY_SOURCE;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Invoking the config plugin did not set 'NSSupportsLiveActivities' = true",
    );
  });

  test("fails when the plugin module does not export a function", () => {
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = `module.exports = { notAFunction: true };\n`;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not export a function");
  });

  test("fails when the plugin file has a syntax error", () => {
    const root = track(
      makeSandbox((f) => {
        f.pluginSource = `module.exports = function (config) { return config; ;;{ \n`;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to load config plugin");
  });

  test("fails when app.json's plugins array does not register the plugin", () => {
    const root = track(
      makeSandbox((f) => {
        f.appJson.expo.plugins = ["expo-router"];
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "app.json's expo.plugins array does not register",
    );
    expect(result.stderr).toContain("withVoiceProcessingLiveActivityWidget");
  });

  test("fails when app.json is missing expo.ios.bundleIdentifier", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.appJson.expo.ios.bundleIdentifier;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "app.json is missing expo.ios.bundleIdentifier",
    );
  });

  test("fails when eas.json is missing entirely", () => {
    const root = track(
      makeSandbox((f) => {
        f.omitEasJson = true;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected eas.json");
    expect(result.stderr).toContain("missing");
  });

  test("fails when eas.json has no build.production profile", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.easJson.build.production;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "eas.json is missing build.production profile",
    );
  });

  test("fails when production iOS credentialsSource is not 'remote'", () => {
    const root = track(
      makeSandbox((f) => {
        f.easJson.build.production.ios.credentialsSource = "local";
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "build.production.ios.credentialsSource must be 'remote'",
    );
  });

  test("fails when production iOS image is not pinned", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.easJson.build.production.ios.image;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("build.production.ios.image must be set");
  });

  test("fails when production env.EXPO_LIVE_ACTIVITIES_REQUIRED is not '1'", () => {
    const root = track(
      makeSandbox((f) => {
        f.easJson.build.production.env.EXPO_LIVE_ACTIVITIES_REQUIRED = "0";
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "build.production.env.EXPO_LIVE_ACTIVITIES_REQUIRED must equal '1'",
    );
  });

  test("fails when the widget extension source directory is missing", () => {
    const root = track(
      makeSandbox((f) => {
        f.omitWidgetDir = true;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Expected widget extension sources at modules/voice-processing-live-activity/ios/VoiceProcessingLiveActivityWidget",
    );
    expect(result.stderr).toContain("missing");
  });

  test("fails when the widget extension path exists but is not a directory", () => {
    const root = track(
      makeSandbox((f) => {
        f.widgetDirAsFile = true;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "modules/voice-processing-live-activity/ios/VoiceProcessingLiveActivityWidget",
    );
    expect(result.stderr).toContain("is not a directory");
  });

  test("fails when the widget extension is missing VoiceProcessingLiveActivityWidget.swift", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.widgetFiles["VoiceProcessingLiveActivityWidget.swift"];
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Widget extension sources are missing VoiceProcessingLiveActivityWidget.swift",
    );
  });

  test("fails when the widget extension is missing Info.plist", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.widgetFiles["Info.plist"];
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Widget extension sources are missing Info.plist",
    );
  });

  test("fails when the shared VoiceProcessingAttributes.swift is missing", () => {
    // Regression for the silent-skip in `withCopyWidgetSources`: the
    // plugin guards the copy with `if (fs.existsSync(attrsSrc))`, so
    // when the file is gone EAS Build still starts and only fails
    // deep into xcodebuild because the widget target lists
    // VoiceProcessingAttributes.swift in its compile sources.
    const root = track(
      makeSandbox((f) => {
        f.omitSharedAttributesFile = true;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Expected shared ActivityAttributes source at modules/voice-processing-live-activity/ios/VoiceProcessingAttributes.swift",
    );
    expect(result.stderr).toContain("missing");
  });

  test("fails when the widget Info.plist is not parseable XML", () => {
    // The file exists (so the existence check passes) but the contents
    // are gibberish. The verifier must reject it with a clear "could
    // not parse" message instead of silently continuing.
    const root = track(
      makeSandbox((f) => {
        f.widgetFiles["Info.plist"] = "this is not a plist <<<>>>";
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Could not parse widget extension Info.plist",
    );
    expect(result.stderr).toContain(
      "modules/voice-processing-live-activity/ios/VoiceProcessingLiveActivityWidget/Info.plist",
    );
  });

  test("fails when widget Info.plist NSExtensionPointIdentifier is the wrong extension point", () => {
    // Real-world regression: someone copy-pasted a notification content
    // extension's Info.plist into the widget target. Xcode would still
    // launch the build and only reject the widget target deep in the
    // EAS Build worker, burning a slot.
    const wrongExtensionPoint = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.content-extension</string>
  </dict>
</dict>
</plist>
`;
    const root = track(
      makeSandbox((f) => {
        f.widgetFiles["Info.plist"] = wrongExtensionPoint;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "NSExtension.NSExtensionPointIdentifier",
    );
    expect(result.stderr).toContain(
      '"com.apple.usernotifications.content-extension"',
    );
    expect(result.stderr).toContain("com.apple.widgetkit-extension");
  });

  test("fails when widget Info.plist NSExtensionPointIdentifier key is missing", () => {
    // The NSExtension dict exists but never declares an extension point
    // identifier — Xcode treats this as an invalid extension target.
    const missingPointId = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>NSExtension</key>
  <dict>
  </dict>
</dict>
</plist>
`;
    const root = track(
      makeSandbox((f) => {
        f.widgetFiles["Info.plist"] = missingPointId;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "NSExtension.NSExtensionPointIdentifier",
    );
    expect(result.stderr).toContain("undefined");
    expect(result.stderr).toContain("com.apple.widgetkit-extension");
  });

  test("fails when submit profile is missing the App Store Connect API key", () => {
    const root = track(
      makeSandbox((f) => {
        delete f.easJson.submit.production.ios.ascApiKeyPath;
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "submit.production.ios is missing ascApiKeyPath / ascApiKeyId",
    );
  });

  test("fails when ascApiKeyPath is a hard-coded disk path instead of an EAS Secret reference", () => {
    const root = track(
      makeSandbox((f) => {
        f.easJson.submit.production.ios.ascApiKeyPath =
          "../../.asc-keys/AuthKey_TEST.p8";
      }),
    );
    const result = runVerifier(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ascApiKeyPath must reference an EAS Secret",
    );
  });
});
