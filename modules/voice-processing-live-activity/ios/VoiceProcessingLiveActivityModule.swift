import ExpoModulesCore
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 * Expo module bridging the ActivityKit Live Activity for the voice-
 * capture "Processing memory…" pill into JavaScript.
 *
 * Module name (`VoiceProcessingLiveActivity`) MUST match the string
 * `requireNativeModule(...)` is called with in
 * `modules/voice-processing-live-activity/index.ts`. The Expo
 * autolinking config (`expo-module.config.json`) points at the class
 * name `VoiceProcessingLiveActivityModule`.
 *
 * All ActivityKit calls are wrapped in two layers of guard:
 *   - `#if canImport(ActivityKit)` so the file still compiles on
 *     simulator SDKs that pre-date ActivityKit.
 *   - `if #available(iOS 16.1, *)` so the module never crashes on a
 *     device running an iOS version below the ActivityKit minimum.
 *
 * The module never throws into JS; every failure path resolves with
 * `{ status: "unavailable", reason: "<machine_readable>" }` and the
 * JS wrapper's `normalizeReason` maps unknown strings to "unknown".
 *
 * iOS 16.1 / 16.2 API split:
 *   - 16.1 shipped `Activity.request(attributes:contentState:)` and
 *     `activity.update(using:)` taking a raw `ContentState`.
 *   - 16.2 deprecated those in favour of `ActivityContent<State>`
 *     wrappers via `Activity.request(attributes:content:pushType:)`
 *     and `activity.update(_:)`.
 *   We branch at runtime so the same dev client supports both.
 */
public class VoiceProcessingLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VoiceProcessingLiveActivity")

    Function("getAvailability") { () -> [String: Any?] in
      return self.availabilityPayload()
    }

    AsyncFunction("startActivity") { (args: [String: Any], promise: Promise) in
      let deepLinkUrl = (args["deepLinkUrl"] as? String) ?? ""
      self.startActivity(deepLinkUrl: deepLinkUrl, promise: promise)
    }

    AsyncFunction("updateActivity") { (activityId: String, phase: String, promise: Promise) in
      self.updateActivity(activityId: activityId, phase: phase, promise: promise)
    }

    AsyncFunction("endActivity") { (activityId: String, promise: Promise) in
      self.endActivity(activityId: activityId, promise: promise)
    }

    AsyncFunction("endAllActivities") { (promise: Promise) in
      self.endAllActivities(promise: promise)
    }
  }

  // MARK: - Availability

  private func availabilityPayload() -> [String: Any?] {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      let info = ActivityAuthorizationInfo()
      if info.areActivitiesEnabled {
        return ["available": true, "reason": nil]
      }
      return ["available": false, "reason": "live_activities_disabled"]
    } else {
      return ["available": false, "reason": "ios_below_16_1"]
    }
    #else
    return ["available": false, "reason": "ios_below_16_1"]
    #endif
  }

  // MARK: - Start

  private func startActivity(deepLinkUrl: String, promise: Promise) {
    #if canImport(ActivityKit)
    guard #available(iOS 16.1, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      promise.resolve([
        "status": "unavailable",
        "reason": "live_activities_disabled",
      ])
      return
    }

    let attributes = VoiceProcessingAttributes(deepLinkUrl: deepLinkUrl)
    let state = VoiceProcessingAttributes.ContentState(phase: .processing)

    do {
      let activity: Activity<VoiceProcessingAttributes>
      if #available(iOS 16.2, *) {
        let content = ActivityContent(state: state, staleDate: nil)
        activity = try Activity<VoiceProcessingAttributes>.request(
          attributes: attributes,
          content: content,
          pushType: nil
        )
      } else {
        activity = try Activity<VoiceProcessingAttributes>.request(
          attributes: attributes,
          contentState: state,
          pushType: nil
        )
      }
      promise.resolve(["status": "ok", "activityId": activity.id])
    } catch {
      promise.resolve(["status": "unavailable", "reason": "start_failed"])
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
    #endif
  }

  // MARK: - Update

  private func updateActivity(activityId: String, phase: String, promise: Promise) {
    #if canImport(ActivityKit)
    guard #available(iOS 16.1, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
      return
    }
    guard let mappedPhase = self.mapPhase(phase) else {
      promise.resolve(["status": "unavailable", "reason": "update_failed"])
      return
    }
    guard
      let activity = Activity<VoiceProcessingAttributes>.activities.first(where: {
        $0.id == activityId
      })
    else {
      promise.resolve(["status": "unavailable", "reason": "no_active_activity"])
      return
    }

    let state = VoiceProcessingAttributes.ContentState(phase: mappedPhase)
    Task {
      if #available(iOS 16.2, *) {
        let content = ActivityContent(state: state, staleDate: nil)
        await activity.update(content)
      } else {
        await activity.update(using: state)
      }
      promise.resolve(["status": "ok"])
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
    #endif
  }

  // MARK: - End

  private func endActivity(activityId: String, promise: Promise) {
    #if canImport(ActivityKit)
    guard #available(iOS 16.1, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
      return
    }
    guard
      let activity = Activity<VoiceProcessingAttributes>.activities.first(where: {
        $0.id == activityId
      })
    else {
      promise.resolve(["status": "unavailable", "reason": "no_active_activity"])
      return
    }

    Task {
      if #available(iOS 16.2, *) {
        let content = ActivityContent(
          state: activity.content.state,
          staleDate: nil
        )
        await activity.end(content, dismissalPolicy: .immediate)
      } else {
        await activity.end(using: activity.contentState, dismissalPolicy: .immediate)
      }
      promise.resolve(["status": "ok"])
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
    #endif
  }

  // MARK: - End All

  /**
   * Sweep up every in-flight `Activity<VoiceProcessingAttributes>`.
   *
   * Called from JS once on cold start so a force-quit (or OS-kill)
   * during a recording session doesn't leave a "Processing memory…"
   * pill on the lock screen / Dynamic Island that will never flip
   * to "Memory ready". Without this sweep the stale activity sticks
   * around until the user manually swipes it away or until iOS
   * hits its 8-hour stale-date timeout.
   *
   * Resolves with `{ status: "ok", endedCount: <n> }` on success
   * (including the common `n == 0` case) and with the same
   * `unavailable` envelope the rest of the module uses on every
   * failure path. Per-activity end errors are swallowed so a single
   * misbehaving activity can't stop the rest from being cleaned up.
   */
  private func endAllActivities(promise: Promise) {
    #if canImport(ActivityKit)
    guard #available(iOS 16.1, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
      return
    }

    let activities = Activity<VoiceProcessingAttributes>.activities
    if activities.isEmpty {
      promise.resolve(["status": "ok", "endedCount": 0])
      return
    }

    Task {
      var endedCount = 0
      for activity in activities {
        if #available(iOS 16.2, *) {
          let content = ActivityContent(
            state: activity.content.state,
            staleDate: nil
          )
          await activity.end(content, dismissalPolicy: .immediate)
        } else {
          await activity.end(
            using: activity.contentState,
            dismissalPolicy: .immediate
          )
        }
        endedCount += 1
      }
      promise.resolve(["status": "ok", "endedCount": endedCount])
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "ios_below_16_1"])
    #endif
  }

  // MARK: - Helpers

  #if canImport(ActivityKit)
  @available(iOS 16.1, *)
  private func mapPhase(_ raw: String) -> VoiceProcessingPhase? {
    return VoiceProcessingPhase(rawValue: raw)
  }
  #else
  private func mapPhase(_ raw: String) -> VoiceProcessingPhase? {
    return VoiceProcessingPhase(rawValue: raw)
  }
  #endif
}
