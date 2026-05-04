/**
 * Expo config plugin: adds the VoiceProcessingLiveActivityWidget
 * extension target to the iOS Xcode project at prebuild time.
 *
 * What it does:
 *   1. Sets NSSupportsLiveActivities + NSSupportsLiveActivitiesFrequentUpdates
 *      in the main app's Info.plist.
 *   2. Adds `com.apple.developer.live-activities` to the app's
 *      Entitlements file so Xcode can submit the binary.
 *   3. Copies the widget extension Swift sources + Info.plist from
 *      `modules/voice-processing-live-activity/ios/` into the
 *      generated iOS project directory.
 *   4. Creates a new PBXNativeTarget of type
 *      `com.apple.product-type.app-extension` (WidgetKit extension)
 *      and adds all required PBX phases and build settings so the
 *      extension is compiled and embedded into the app bundle.
 *
 * The plugin is idempotent — if the target already exists (e.g. a
 * second `expo prebuild`) it will skip all mutations.
 *
 * Usage — `app.json` plugins array:
 *   "./plugins/withVoiceProcessingLiveActivityWidget"
 *
 * References:
 *   https://docs.expo.dev/config-plugins/introduction/
 *   https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension
 *   https://developer.apple.com/documentation/activitykit
 */

const {
  withInfoPlist,
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const WIDGET_TARGET_NAME = "VoiceProcessingLiveActivityWidget";
const WIDGET_BUNDLE_ID_SUFFIX = ".VoiceProcessingLiveActivityWidget";

const SOURCE_DIR = path.resolve(
  __dirname,
  "..",
  "modules",
  "voice-processing-live-activity",
  "ios",
  WIDGET_TARGET_NAME
);

const SHARED_SOURCES = path.resolve(
  __dirname,
  "..",
  "modules",
  "voice-processing-live-activity",
  "ios"
);

/** Step 1: Info.plist additions for the main app target. */
function withLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    cfg.modResults.NSSupportsLiveActivitiesFrequentUpdates = false;
    return cfg;
  });
}

/** Step 2: Entitlements for the main app target. */
function withLiveActivityEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (!cfg.modResults["com.apple.developer.live-activities"]) {
      cfg.modResults["com.apple.developer.live-activities"] = true;
    }
    return cfg;
  });
}

/**
 * Step 3: Copy widget extension sources into the generated iOS
 * project tree. The widget folder sits at
 * `ios/VoiceProcessingLiveActivityWidget/` inside the prebuild
 * output so Xcode can find the files when they are referenced
 * by relative path in the xcodeproj.
 */
function withCopyWidgetSources(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const destDir = path.join(projectRoot, WIDGET_TARGET_NAME);
      fs.mkdirSync(destDir, { recursive: true });

      // Copy widget-specific sources — always overwrite so iterative
      // changes to the Swift sources are picked up on every prebuild.
      for (const file of fs.readdirSync(SOURCE_DIR)) {
        const src = path.join(SOURCE_DIR, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
      }

      // Copy the shared ActivityAttributes file into the widget folder
      // so the extension target compiles without needing to reach back
      // into the module's ios/ root.
      const attrsSrc = path.join(SHARED_SOURCES, "VoiceProcessingAttributes.swift");
      const attrsDest = path.join(destDir, "VoiceProcessingAttributes.swift");
      if (fs.existsSync(attrsSrc)) {
        fs.copyFileSync(attrsSrc, attrsDest);
      }

      return cfg;
    },
  ]);
}

/**
 * Step 4: Add the WidgetKit extension target to the Xcode project.
 *
 * Directly manipulates project.hash.project.objects (the internal
 * data structure the xcode library serialises to project.pbxproj)
 * instead of calling the library's helper methods, which have a
 * different argument shape than what earlier versions of this plugin
 * assumed and several of which do not exist at all in xcode@3.0.1.
 *
 * Object sections written:
 *   PBXFileReference        — product .appex, .swift sources, Info.plist, frameworks
 *   PBXBuildFile            — source build files, framework build files, embed build file
 *   PBXSourcesBuildPhase    — compiles the two Swift files
 *   PBXFrameworksBuildPhase — links WidgetKit + SwiftUI
 *   PBXResourcesBuildPhase  — empty (no asset catalogs in the extension)
 *   PBXCopyFilesBuildPhase  — embeds the .appex into the main app bundle
 *   XCBuildConfiguration    — Debug + Release configs for the extension target
 *   XCConfigurationList     — config list referencing Debug + Release
 *   PBXNativeTarget         — the extension target itself
 *   PBXGroup                — group in the project navigator for the extension files
 */
function withWidgetTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const objects = project.hash.project.objects;

    // Guard: skip if the target already exists (idempotent).
    // Target names in pbxproj may or may not be quoted.
    const targets = project.pbxNativeTargetSection();
    const alreadyExists = Object.values(targets).some(
      (t) =>
        t &&
        (t.name === WIDGET_TARGET_NAME ||
          t.name === `"${WIDGET_TARGET_NAME}"`)
    );
    if (alreadyExists) {
      return cfg;
    }

    const appBundleId = cfg.ios?.bundleIdentifier ?? "com.polsia.memtool";
    const widgetBundleId = appBundleId + WIDGET_BUNDLE_ID_SUFFIX;
    const iosDeploymentTarget = "16.1";
    const swiftVersion = "5.9";

    const gen = () => project.generateUuid();

    // Ensure sections exist (they always do in a generated project, but
    // be defensive in case a section is missing).
    const ensureSection = (name) => {
      if (!objects[name]) objects[name] = {};
    };
    ensureSection("PBXFileReference");
    ensureSection("PBXBuildFile");
    ensureSection("PBXSourcesBuildPhase");
    ensureSection("PBXFrameworksBuildPhase");
    ensureSection("PBXResourcesBuildPhase");
    ensureSection("PBXCopyFilesBuildPhase");
    ensureSection("XCBuildConfiguration");
    ensureSection("XCConfigurationList");
    ensureSection("PBXNativeTarget");
    ensureSection("PBXGroup");

    // ----------------------------------------------------------------
    // 1. Product file reference (.appex in BUILT_PRODUCTS_DIR)
    // ----------------------------------------------------------------
    const productFileRefUuid = gen();
    const productFileName = `${WIDGET_TARGET_NAME}.appex`;
    objects["PBXFileReference"][productFileRefUuid] = {
      isa: "PBXFileReference",
      explicitFileType: '"wrapper.app-extension"',
      includeInIndex: 0,
      path: productFileName,
      sourceTree: "BUILT_PRODUCTS_DIR",
    };
    objects["PBXFileReference"][`${productFileRefUuid}_comment`] = productFileName;

    // ----------------------------------------------------------------
    // 2. Swift source file references + build files
    // ----------------------------------------------------------------
    const swiftFiles = [
      "VoiceProcessingLiveActivityWidget.swift",
      "VoiceProcessingAttributes.swift",
    ];

    const sourceBuildFiles = swiftFiles.map((fname) => {
      const fileRefUuid = gen();
      const buildFileUuid = gen();

      objects["PBXFileReference"][fileRefUuid] = {
        isa: "PBXFileReference",
        lastKnownFileType: "sourcecode.swift",
        name: `"${fname}"`,
        path: `"${WIDGET_TARGET_NAME}/${fname}"`,
        sourceTree: '"<group>"',
      };
      objects["PBXFileReference"][`${fileRefUuid}_comment`] = fname;

      objects["PBXBuildFile"][buildFileUuid] = {
        isa: "PBXBuildFile",
        fileRef: fileRefUuid,
        fileRef_comment: fname,
      };
      objects["PBXBuildFile"][`${buildFileUuid}_comment`] = `${fname} in Sources`;

      return { fileRefUuid, buildFileUuid, fname };
    });

    // ----------------------------------------------------------------
    // 3. Info.plist file reference (resources)
    // ----------------------------------------------------------------
    const infoPlistFile = "Info.plist";
    const infoPlistRefUuid = gen();
    objects["PBXFileReference"][infoPlistRefUuid] = {
      isa: "PBXFileReference",
      lastKnownFileType: "text.plist.xml",
      name: `"${infoPlistFile}"`,
      path: `"${WIDGET_TARGET_NAME}/${infoPlistFile}"`,
      sourceTree: '"<group>"',
    };
    objects["PBXFileReference"][`${infoPlistRefUuid}_comment`] = infoPlistFile;

    // ----------------------------------------------------------------
    // 4. Framework file references + build files
    // ----------------------------------------------------------------
    const frameworkDefs = [
      {
        name: "WidgetKit.framework",
        path: "System/Library/Frameworks/WidgetKit.framework",
      },
      {
        name: "SwiftUI.framework",
        path: "System/Library/Frameworks/SwiftUI.framework",
      },
    ];

    const frameworkBuildFiles = frameworkDefs.map((fw) => {
      const fileRefUuid = gen();
      const buildFileUuid = gen();

      objects["PBXFileReference"][fileRefUuid] = {
        isa: "PBXFileReference",
        lastKnownFileType: "wrapper.framework",
        name: `"${fw.name}"`,
        path: `"${fw.path}"`,
        sourceTree: "SDKROOT",
      };
      objects["PBXFileReference"][`${fileRefUuid}_comment`] = fw.name;

      objects["PBXBuildFile"][buildFileUuid] = {
        isa: "PBXBuildFile",
        fileRef: fileRefUuid,
        fileRef_comment: fw.name,
      };
      objects["PBXBuildFile"][`${buildFileUuid}_comment`] = `${fw.name} in Frameworks`;

      return { fileRefUuid, buildFileUuid, name: fw.name };
    });

    // ----------------------------------------------------------------
    // 5. Build phases
    // ----------------------------------------------------------------

    // Sources
    const sourcesBuildPhaseUuid = gen();
    objects["PBXSourcesBuildPhase"][sourcesBuildPhaseUuid] = {
      isa: "PBXSourcesBuildPhase",
      buildActionMask: 2147483647,
      files: sourceBuildFiles.map((f) => ({
        value: f.buildFileUuid,
        comment: `${f.fname} in Sources`,
      })),
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects["PBXSourcesBuildPhase"][`${sourcesBuildPhaseUuid}_comment`] = "Sources";

    // Frameworks
    const frameworksBuildPhaseUuid = gen();
    objects["PBXFrameworksBuildPhase"][frameworksBuildPhaseUuid] = {
      isa: "PBXFrameworksBuildPhase",
      buildActionMask: 2147483647,
      files: frameworkBuildFiles.map((f) => ({
        value: f.buildFileUuid,
        comment: `${f.name} in Frameworks`,
      })),
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects["PBXFrameworksBuildPhase"][`${frameworksBuildPhaseUuid}_comment`] = "Frameworks";

    // Resources (empty — no asset catalogs in this extension)
    const resourcesBuildPhaseUuid = gen();
    objects["PBXResourcesBuildPhase"][resourcesBuildPhaseUuid] = {
      isa: "PBXResourcesBuildPhase",
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects["PBXResourcesBuildPhase"][`${resourcesBuildPhaseUuid}_comment`] = "Resources";

    // ----------------------------------------------------------------
    // 6. Build configurations (Debug + Release)
    // ----------------------------------------------------------------
    const sharedBuildSettings = {
      ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: "AccentColor",
      ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME: "WidgetBackground",
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: 1,
      INFOPLIST_FILE: `${WIDGET_TARGET_NAME}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: iosDeploymentTarget,
      LD_RUNPATH_SEARCH_PATHS: [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ],
      MARKETING_VERSION: "1.0",
      PRODUCT_BUNDLE_IDENTIFIER: widgetBundleId,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: "YES",
      SWIFT_EMIT_LOC_STRINGS: "YES",
      SWIFT_VERSION: swiftVersion,
      TARGETED_DEVICE_FAMILY: '"1,2"',
    };

    const debugConfigUuid = gen();
    objects["XCBuildConfiguration"][debugConfigUuid] = {
      isa: "XCBuildConfiguration",
      buildSettings: {
        ...sharedBuildSettings,
        DEBUG_INFORMATION_FORMAT: "dwarf",
        MTL_ENABLE_DEBUG_INFO: "INCLUDE_SOURCE",
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG",
      },
      name: "Debug",
    };
    objects["XCBuildConfiguration"][`${debugConfigUuid}_comment`] = "Debug";

    const releaseConfigUuid = gen();
    objects["XCBuildConfiguration"][releaseConfigUuid] = {
      isa: "XCBuildConfiguration",
      buildSettings: {
        ...sharedBuildSettings,
        COPY_PHASE_STRIP: "NO",
        DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
        MTL_ENABLE_DEBUG_INFO: "NO",
      },
      name: "Release",
    };
    objects["XCBuildConfiguration"][`${releaseConfigUuid}_comment`] = "Release";

    // ----------------------------------------------------------------
    // 7. Configuration list
    // ----------------------------------------------------------------
    const configListUuid = gen();
    const configListComment = `Build configuration list for PBXNativeTarget "${WIDGET_TARGET_NAME}"`;
    objects["XCConfigurationList"][configListUuid] = {
      isa: "XCConfigurationList",
      buildConfigurations: [
        { value: debugConfigUuid, comment: "Debug" },
        { value: releaseConfigUuid, comment: "Release" },
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: "Release",
    };
    objects["XCConfigurationList"][`${configListUuid}_comment`] = configListComment;

    // ----------------------------------------------------------------
    // 8. Native target
    // ----------------------------------------------------------------
    const targetUuid = gen();
    objects["PBXNativeTarget"][targetUuid] = {
      isa: "PBXNativeTarget",
      buildConfigurationList: configListUuid,
      buildConfigurationList_comment: configListComment,
      buildPhases: [
        { value: sourcesBuildPhaseUuid, comment: "Sources" },
        { value: frameworksBuildPhaseUuid, comment: "Frameworks" },
        { value: resourcesBuildPhaseUuid, comment: "Resources" },
      ],
      buildRules: [],
      dependencies: [],
      name: `"${WIDGET_TARGET_NAME}"`,
      productName: `"${WIDGET_TARGET_NAME}"`,
      productReference: productFileRefUuid,
      productReference_comment: productFileName,
      productType: '"com.apple.product-type.app-extension"',
    };
    objects["PBXNativeTarget"][`${targetUuid}_comment`] = WIDGET_TARGET_NAME;

    // ----------------------------------------------------------------
    // 9. Add target to the project's targets list
    // ----------------------------------------------------------------
    const projectSection = project.pbxProjectSection();
    const projectUuid = project.getFirstProject().uuid;
    projectSection[projectUuid].targets.push({
      value: targetUuid,
      comment: WIDGET_TARGET_NAME,
    });

    // ----------------------------------------------------------------
    // 10. Add product file ref to the "Products" PBXGroup
    // ----------------------------------------------------------------
    const productsGroup = project.pbxGroupByName("Products");
    if (productsGroup) {
      productsGroup.children.push({
        value: productFileRefUuid,
        comment: productFileName,
      });
    }

    // ----------------------------------------------------------------
    // 11. Create a PBXGroup for the widget extension sources
    // ----------------------------------------------------------------
    const widgetGroupUuid = gen();
    objects["PBXGroup"][widgetGroupUuid] = {
      isa: "PBXGroup",
      children: [
        ...sourceBuildFiles.map((f) => ({
          value: f.fileRefUuid,
          comment: f.fname,
        })),
        { value: infoPlistRefUuid, comment: infoPlistFile },
      ],
      name: `"${WIDGET_TARGET_NAME}"`,
      path: `"${WIDGET_TARGET_NAME}"`,
      sourceTree: '"<group>"',
    };
    objects["PBXGroup"][`${widgetGroupUuid}_comment`] = WIDGET_TARGET_NAME;

    // Add the widget group as a child of the main project group
    const mainGroup = project.pbxGroupByName(project.getFirstProject().firstProject.mainGroup);
    const rootGroup =
      mainGroup ||
      (() => {
        // Fall back: find the top-level group that is the mainGroup
        const mainGroupUuid = projectSection[projectUuid].mainGroup;
        return objects["PBXGroup"][mainGroupUuid];
      })();
    if (rootGroup && rootGroup.children) {
      rootGroup.children.push({
        value: widgetGroupUuid,
        comment: WIDGET_TARGET_NAME,
      });
    }

    // ----------------------------------------------------------------
    // 12. Embed Foundation Extensions build phase on the main app target
    // ----------------------------------------------------------------
    const embedBuildFileUuid = gen();
    objects["PBXBuildFile"][embedBuildFileUuid] = {
      isa: "PBXBuildFile",
      fileRef: productFileRefUuid,
      fileRef_comment: productFileName,
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    };
    objects["PBXBuildFile"][`${embedBuildFileUuid}_comment`] =
      `${productFileName} in Embed Foundation Extensions`;

    const embedPhaseUuid = gen();
    objects["PBXCopyFilesBuildPhase"][embedPhaseUuid] = {
      isa: "PBXCopyFilesBuildPhase",
      buildActionMask: 2147483647,
      dstPath: '""',
      dstSubfolderSpec: 13,
      files: [
        {
          value: embedBuildFileUuid,
          comment: `${productFileName} in Embed Foundation Extensions`,
        },
      ],
      name: '"Embed Foundation Extensions"',
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects["PBXCopyFilesBuildPhase"][`${embedPhaseUuid}_comment`] =
      "Embed Foundation Extensions";

    // Append the embed phase to the main app target's buildPhases array.
    const mainTarget = project.getFirstTarget();
    if (mainTarget) {
      const mainTargetObj = objects["PBXNativeTarget"][mainTarget.uuid];
      if (mainTargetObj && mainTargetObj.buildPhases) {
        mainTargetObj.buildPhases.push({
          value: embedPhaseUuid,
          comment: "Embed Foundation Extensions",
        });
      }
    }

    return cfg;
  });
}

/**
 * The composed plugin — chains all four modifications.
 *
 * Register in `app.json`:
 *   "plugins": ["./plugins/withVoiceProcessingLiveActivityWidget"]
 */
module.exports = function withVoiceProcessingLiveActivityWidget(config) {
  config = withLiveActivityInfoPlist(config);
  config = withLiveActivityEntitlements(config);
  config = withCopyWidgetSources(config);
  config = withWidgetTarget(config);
  return config;
};
