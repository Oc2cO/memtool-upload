require 'json'

# Local CocoaPod for the foundation-models Expo module.
#
# Picked up by expo-modules-autolinking because the module is listed
# in `package.json`'s `expo.autolinking.nativeModulesDir` directory.
# The autolinker walks every `modules/<name>/` folder, finds the
# `expo-module.config.json` manifest, and then locates this podspec
# under `ios/`.
#
# The Swift source compiles against the iOS 26 SDK when present and
# falls back gracefully via `#if canImport(FoundationModels)` on
# older toolchains — see `FoundationModelsModule.swift` for the
# guard pattern. We intentionally do NOT add `s.weak_frameworks =
# 'FoundationModels'` because the symbol-level `canImport` check
# already gates every reference, and a weak-link declaration would
# fail when the toolchain doesn't ship the framework at all.

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'FoundationModels'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'MemTool'
  s.homepage       = 'https://replit.com/'
  # iOS 16 baseline matches the rest of the MemTool app's deployment
  # target. The `if #available(iOS 26.0, *)` runtime guards inside
  # the module take care of older OS users at call time.
  s.platforms      = { :ios => '16.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'FoundationModelsModule.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
