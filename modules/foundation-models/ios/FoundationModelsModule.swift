import ExpoModulesCore
import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/**
 * Expo module bridging Apple's on-device FoundationModels framework
 * (iOS 26+, Apple Intelligence eligible devices) into JavaScript.
 *
 * Module name (`FoundationModels`) MUST match the string
 * `requireNativeModule(...)` is called with in
 * `modules/foundation-models/index.ts`. The Expo autolinking config
 * (`expo-module.config.json`) points at the class name
 * `FoundationModelsModule`.
 *
 * Two layers of guard wrap every framework call:
 *   - `#if canImport(FoundationModels)` so the file still compiles
 *     on toolchains that don't ship the iOS 26 SDK (Replit's Linux
 *     containers, Xcode 15, older CI images).
 *   - `if #available(iOS 26.0, *)` so the same binary runs on iOS
 *     25 devices without crashing — they just see the
 *     `ios_below_26` machine-readable reason.
 *
 * The module never throws into JS. Every failure path resolves with
 * `{ status: "unavailable", reason: "<machine_readable>" }` and the
 * JS wrapper's `normalizeReason` maps unknown strings to "unknown".
 *
 * Entry points:
 *   - `summarize(text)`        → 3-sentence neutral paraphrase (one-shot).
 *   - `summarizeStream(text)`  → same prompt, but streams partial text
 *                                chunks via `onSummarizeChunk` events and
 *                                a final `onSummarizeDone` event with
 *                                latency / approx tokens. Cancelled via
 *                                `cancelSummarizeStream()`.
 *   - `extractFacets(text)`    → `@Generable` `MemoryFacets` struct
 *                                with `tags`, `theme`, and `mood`.
 *
 * Both report wall-clock latency (from before the
 * `LanguageModelSession` constructor to after the response future
 * resolves) and an approximate token count (word-split — the public
 * `Response` type does not yet expose a real token count).
 */
public class FoundationModelsModule: Module {
  // Holds the in-flight streaming Swift Task so it can be cancelled
  // by `cancelSummarizeStream`. Access from the main actor only (Expo
  // Functions run on the main actor by default).
  private var activeStreamTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("FoundationModels")

    // Events emitted during summarizeStream:
    //   onSummarizeChunk  — partial accumulated text; payload { chunk: String }
    //   onSummarizeDone   — stream finished; payload { latencyMs: Int, approxTokens: Int }
    //   onSummarizeError  — stream failed; payload { reason: String }
    Events("onSummarizeChunk", "onSummarizeDone", "onSummarizeError")

    Function("getAvailability") { () -> [String: Any?] in
      return self.availabilityPayload()
    }

    AsyncFunction("summarize") { (text: String, promise: Promise) in
      self.summarize(text: text, promise: promise)
    }

    // Starts a streaming summarization. Returns immediately; progress
    // arrives via the three events above. Call `cancelSummarizeStream`
    // to abort. Callers should subscribe to events BEFORE calling this.
    Function("summarizeStream") { (text: String) in
      self.startSummarizeStream(text: text)
    }

    // Cancels any in-flight summarizeStream Task. Safe to call when
    // nothing is running — it becomes a no-op.
    Function("cancelSummarizeStream") { () in
      self.activeStreamTask?.cancel()
      self.activeStreamTask = nil
    }

    AsyncFunction("extractFacets") { (text: String, promise: Promise) in
      self.extractFacets(text: text, promise: promise)
    }
  }

  // MARK: - Availability

  private func availabilityPayload() -> [String: Any?] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let model = SystemLanguageModel.default
      switch model.availability {
      case .available:
        return ["available": true, "reason": nil]
      case .unavailable(let reason):
        return ["available": false, "reason": self.mapAvailabilityReason(reason)]
      @unknown default:
        return ["available": false, "reason": "unknown"]
      }
    } else {
      return ["available": false, "reason": "ios_below_26"]
    }
    #else
    return ["available": false, "reason": "framework_not_present"]
    #endif
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private func mapAvailabilityReason(
    _ reason: SystemLanguageModel.Availability.UnavailableReason
  ) -> String {
    switch reason {
    case .deviceNotEligible:
      return "device_not_eligible"
    case .appleIntelligenceNotEnabled:
      return "apple_intelligence_not_enabled"
    case .modelNotReady:
      return "model_not_ready"
    @unknown default:
      return "unknown"
    }
  }
  #endif

  // MARK: - Summarize (one-shot)

  private func summarize(text: String, promise: Promise) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      promise.resolve(["status": "unavailable", "reason": "empty_input"])
      return
    }

    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_26"])
      return
    }
    let model = SystemLanguageModel.default
    if case .unavailable(let reason) = model.availability {
      promise.resolve([
        "status": "unavailable",
        "reason": self.mapAvailabilityReason(reason),
      ])
      return
    }

    Task {
      let start = Date()
      do {
        let session = LanguageModelSession(
          model: model,
          instructions: Instructions(
            "Summarize the user's memory in three short sentences. "
              + "Stay neutral, do not invent facts, keep the user's tense, "
              + "and describe the memory rather than the user."
          )
        )
        let response = try await session.respond(to: trimmed)
        let latencyMs = Int(Date().timeIntervalSince(start) * 1000)
        let summary = response.content
        let approxTokens = self.approximateTokenCount(summary)
        promise.resolve([
          "status": "ok",
          "summary": summary,
          "latencyMs": latencyMs,
          "approxTokens": approxTokens,
        ])
      } catch {
        // Any FoundationModels-thrown error (model unloaded mid-call,
        // safety filter, transient) surfaces as "unknown" rather than
        // bubbling — the JS layer treats unknown as a user-facing
        // generic and the spike screen still renders the fallback
        // card. We deliberately do NOT promise.reject because the JS
        // typed surface promises a structured result, not a throw.
        promise.resolve(["status": "unavailable", "reason": "unknown"])
      }
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "framework_not_present"])
    #endif
  }

  // MARK: - Summarize (streaming)

  private func startSummarizeStream(text: String) {
    // Cancel any previous in-flight stream before starting a new one.
    activeStreamTask?.cancel()
    activeStreamTask = nil

    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      sendEvent("onSummarizeError", ["reason": "empty_input"])
      return
    }

    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else {
      sendEvent("onSummarizeError", ["reason": "ios_below_26"])
      return
    }
    let model = SystemLanguageModel.default
    if case .unavailable(let reason) = model.availability {
      sendEvent("onSummarizeError", ["reason": self.mapAvailabilityReason(reason)])
      return
    }

    let task = Task {
      let start = Date()
      do {
        let session = LanguageModelSession(
          model: model,
          instructions: Instructions(
            "Summarize the user's memory in three short sentences. "
              + "Stay neutral, do not invent facts, keep the user's tense, "
              + "and describe the memory rather than the user."
          )
        )
        let stream = session.streamResponse(to: trimmed)
        var lastChunk = ""
        for try await partial in stream {
          // Each `partial` is the accumulated text so far. Emit it
          // so the JS side can set partialSummary = chunk directly
          // rather than appending — this avoids duplication if the
          // model yields overlapping prefixes.
          if Task.isCancelled { return }
          lastChunk = partial
          sendEvent("onSummarizeChunk", ["chunk": partial])
        }
        if Task.isCancelled { return }
        let latencyMs = Int(Date().timeIntervalSince(start) * 1000)
        let approxTokens = self.approximateTokenCount(lastChunk)
        sendEvent("onSummarizeDone", [
          "latencyMs": latencyMs,
          "approxTokens": approxTokens,
        ])
      } catch is CancellationError {
        // Swallow — cancellation is intentional (user tapped Reset).
      } catch {
        if !Task.isCancelled {
          sendEvent("onSummarizeError", ["reason": "unknown"])
        }
      }
      // Clear the stored reference once finished so `cancelSummarizeStream`
      // becomes a true no-op when called after natural completion.
      await MainActor.run { self.activeStreamTask = nil }
    }
    activeStreamTask = task
    #else
    sendEvent("onSummarizeError", ["reason": "framework_not_present"])
    #endif
  }

  // MARK: - Extract facets

  /**
   * Structured tag/theme/mood extractor backed by Apple's
   * `@Generable` macro. The macro tells the on-device model to
   * constrain its output to match this struct's shape so the JS
   * side can deserialize without prompt-engineering JSON parsing.
   *
   * Field guidance (kept in sync with the Instructions string
   * below):
   *   - tags  : 1-5 lowercase, single-word topical tags. No
   *             hashtags. No leading punctuation.
   *   - theme : a short noun phrase (≤ 6 words) describing the
   *             recurring pattern this entry belongs to.
   *   - mood  : a single lowercase emotion word, or empty string
   *             if the model can't infer one.
   */
  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  @Generable
  private struct MemoryFacets {
    @Guide(description: "1-5 lowercase, single-word topical tags. No hashtags or punctuation.")
    var tags: [String]

    @Guide(description: "A short noun phrase (max 6 words) describing the recurring pattern this entry belongs to.")
    var theme: String

    @Guide(description: "A single lowercase emotion word, or empty string if uncertain.")
    var mood: String
  }
  #endif

  private func extractFacets(text: String, promise: Promise) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      promise.resolve(["status": "unavailable", "reason": "empty_input"])
      return
    }

    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_below_26"])
      return
    }
    let model = SystemLanguageModel.default
    if case .unavailable(let reason) = model.availability {
      promise.resolve([
        "status": "unavailable",
        "reason": self.mapAvailabilityReason(reason),
      ])
      return
    }

    Task {
      let start = Date()
      do {
        let session = LanguageModelSession(
          model: model,
          instructions: Instructions(
            "Extract structured facets from the user's memory. "
              + "Return up to 5 lowercase, single-word topical tags. "
              + "Return a short theme (max 6 words) describing the "
              + "recurring pattern this entry belongs to. Return a "
              + "single lowercase emotion word for mood, or an empty "
              + "string if uncertain. Do not invent details — only "
              + "describe what the entry actually says."
          )
        )
        let response = try await session.respond(
          to: trimmed,
          generating: MemoryFacets.self
        )
        let latencyMs = Int(Date().timeIntervalSince(start) * 1000)
        let facets = response.content
        // Defensive normalization on the Swift side so the JS layer
        // receives clean values even if the model produced empty /
        // whitespace tags. The JS layer also re-validates shape, but
        // doing it here keeps the wire payload tidy.
        let cleanTags = facets.tags
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
          .filter { !$0.isEmpty }
        let approxTokens = self.approximateTokenCount(
          cleanTags.joined(separator: " ") + " " + facets.theme + " " + facets.mood
        )
        promise.resolve([
          "status": "ok",
          "facets": [
            "tags": cleanTags,
            "theme": facets.theme.trimmingCharacters(in: .whitespacesAndNewlines),
            "mood": facets.mood.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
          ],
          "latencyMs": latencyMs,
          "approxTokens": approxTokens,
        ])
      } catch {
        // Same swallow-and-resolve policy as `summarize` above —
        // see the comment there.
        promise.resolve(["status": "unavailable", "reason": "unknown"])
      }
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "framework_not_present"])
    #endif
  }

  // MARK: - Helpers

  /// Word-split approximation of token count. The public
  /// `Response` type doesn't yet surface a real token count from
  /// the model; replace with the real value if/when Apple exposes
  /// it. Used for the dev spike's "≈ tokens" / "tok/s" metrics so
  /// reviewers can sanity-check throughput.
  private func approximateTokenCount(_ text: String) -> Int {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return 0 }
    return trimmed.split(separator: " ").count
  }
}
