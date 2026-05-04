require 'json'

# Local CocoaPod for the speech-to-text Expo module.
#
# Picked up by expo-modules-autolinking because the module is listed
# in `package.json`'s `expo.autolinking.nativeModulesDir` directory.
# The autolinker walks every `modules/<name>/` folder, finds the
# `expo-module.config.json` manifest, and then locates this podspec
# under `ios/`.

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SpeechToText'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'MemTool'
  s.homepage       = 'https://replit.com/'
  s.platforms      = { :ios => '13.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'SpeechToTextModule.swift'

  s.frameworks = 'Speech', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
