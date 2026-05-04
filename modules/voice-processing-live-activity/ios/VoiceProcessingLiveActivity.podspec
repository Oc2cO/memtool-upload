require 'json'

# Local CocoaPod for the voice-processing-live-activity Expo module.
#
# Picked up by expo-modules-autolinking because the module is listed
# in `package.json`'s `expo.autolinking.nativeModulesDir` directory.
# The autolinker walks every `modules/<name>/` folder, finds the
# `expo-module.config.json` manifest, and then locates this podspec
# under `ios/`.
#
# Only the main app target needs the Swift sources compiled here:
#   - VoiceProcessingLiveActivityModule.swift (the Expo module)
#   - VoiceProcessingAttributes.swift         (shared with the widget)
#
# The widget extension's own SwiftUI sources live under the
# `VoiceProcessingLiveActivityWidget/` subfolder and are added to a
# *separate* PBXNativeTarget by `plugins/withVoiceProcessingLive-
# ActivityWidget.js` at prebuild time. Excluding that subfolder here
# avoids compiling `@main`-annotated WidgetBundle code into the main
# app target (which would clash with Expo's own `@main` entry point).

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VoiceProcessingLiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'MemTool'
  s.homepage       = 'https://replit.com/'
  s.platforms      = { :ios => '16.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Compile only the module + shared attributes file into the main
  # app target. The widget extension's `@main` WidgetBundle and
  # SwiftUI views are intentionally excluded here — they're built by
  # the dedicated WidgetKit extension target the config plugin sets
  # up. Keeping the explicit list (instead of `**/*.swift`) prevents
  # accidental drift if more files are added under the widget folder.
  s.source_files = [
    'VoiceProcessingLiveActivityModule.swift',
    'VoiceProcessingAttributes.swift',
  ]

  s.exclude_files = 'VoiceProcessingLiveActivityWidget/**/*'

  s.frameworks = 'ActivityKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
