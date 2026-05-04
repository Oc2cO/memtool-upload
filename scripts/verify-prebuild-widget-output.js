#!/usr/bin/env node
/**
 * Post-prebuild regression guard for the VoiceProcessingLiveActivityWidget
 * extension target.
 *
 * Run this AFTER `expo prebuild` to confirm that the generated
 * `ios/MemTool.xcodeproj/project.pbxproj` actually contains all the
 * sections the `withVoiceProcessingLiveActivityWidget` config plugin
 * is expected to have written.
 *
 * Usage:
 *   node scripts/verify-prebuild-widget-output.js
 *   # or via npm:
 *   npm run verify:prebuild-output
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (details printed to stderr)
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PBXPROJ = path.join(
  ROOT,
  "ios",
  "MemTool.xcodeproj",
  "project.pbxproj"
);

const WIDGET_TARGET_NAME = "VoiceProcessingLiveActivityWidget";
const PRODUCT_FILE = `${WIDGET_TARGET_NAME}.appex`;

function fail(message) {
  console.error(`\n[verify-prebuild-output] FAIL: ${message}\n`);
  process.exit(1);
}

function ok(message) {
  console.log(`[verify-prebuild-output] OK: ${message}`);
}

// ----------------------------------------------------------------
// 1. The pbxproj file must exist — prebuild must have been run first.
// ----------------------------------------------------------------
if (!fs.existsSync(PBXPROJ)) {
  fail(
    `Generated Xcode project not found at ${path.relative(ROOT, PBXPROJ)}.\n` +
      `  Run 'npx expo prebuild --platform ios --no-install' first.`
  );
}

const pbxproj = fs.readFileSync(PBXPROJ, "utf8");

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function assertContains(substring, description) {
  if (!pbxproj.includes(substring)) {
    fail(
      `${description}\n` +
        `  Expected to find: ${JSON.stringify(substring)}\n` +
        `  File: ${path.relative(ROOT, PBXPROJ)}`
    );
  }
  ok(description);
}

// ----------------------------------------------------------------
// 2. PBXNativeTarget for the widget extension must be present.
// ----------------------------------------------------------------
assertContains(
  `name = "${WIDGET_TARGET_NAME}"`,
  `PBXNativeTarget "${WIDGET_TARGET_NAME}" present`
);

assertContains(
  `productType = "com.apple.product-type.app-extension"`,
  `Widget target productType is com.apple.product-type.app-extension`
);

// ----------------------------------------------------------------
// 3. Product file reference (.appex) must be present.
// ----------------------------------------------------------------
assertContains(
  `${PRODUCT_FILE}`,
  `Product file reference ${PRODUCT_FILE} present`
);

// ----------------------------------------------------------------
// 4. Source files must be in a PBXSourcesBuildPhase.
// ----------------------------------------------------------------
assertContains(
  `VoiceProcessingLiveActivityWidget.swift in Sources`,
  `VoiceProcessingLiveActivityWidget.swift listed in Sources build phase`
);

assertContains(
  `VoiceProcessingAttributes.swift in Sources`,
  `VoiceProcessingAttributes.swift listed in Sources build phase`
);

// ----------------------------------------------------------------
// 5. Frameworks must be in a PBXFrameworksBuildPhase.
// ----------------------------------------------------------------
assertContains(
  `WidgetKit.framework in Frameworks`,
  `WidgetKit.framework listed in Frameworks build phase`
);

assertContains(
  `SwiftUI.framework in Frameworks`,
  `SwiftUI.framework listed in Frameworks build phase`
);

// ----------------------------------------------------------------
// 6. Embed Foundation Extensions copy-files phase must be on the
//    main app target referencing the widget .appex.
// ----------------------------------------------------------------
assertContains(
  `Embed Foundation Extensions`,
  `Embed Foundation Extensions build phase present`
);

assertContains(
  `${PRODUCT_FILE} in Embed Foundation Extensions`,
  `${PRODUCT_FILE} referenced in Embed Foundation Extensions phase`
);

// ----------------------------------------------------------------
// 7. Build configurations for the widget target must be present.
// ----------------------------------------------------------------
assertContains(
  `INFOPLIST_FILE = ${WIDGET_TARGET_NAME}/Info.plist`,
  `Widget target INFOPLIST_FILE build setting correct`
);

assertContains(
  `SKIP_INSTALL = YES`,
  `Widget target SKIP_INSTALL = YES present`
);

// ----------------------------------------------------------------
// 8. The widget group (project navigator) must exist.
// ----------------------------------------------------------------
assertContains(
  `name = "${WIDGET_TARGET_NAME}"`,
  `PBXGroup named "${WIDGET_TARGET_NAME}" present`
);

// ----------------------------------------------------------------
// Done.
// ----------------------------------------------------------------
console.log(
  "\n[verify-prebuild-output] All widget extension output checks passed."
);
