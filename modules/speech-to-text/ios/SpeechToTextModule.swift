import ExpoModulesCore
import Foundation

#if canImport(Speech)
import Speech
#endif

#if canImport(AVFoundation)
import AVFoundation
#endif

/**
 * Expo module bridging Apple's on-device `SFSpeechRecognizer` into
 * JavaScript for the voice-capture screen.
 *
 * Module name (`SpeechToText`) MUST match the string
 * `requireNativeModule(...)` is called with in
 * `modules/speech-to-text/index.ts`. The Expo autolinking config
 * (`expo-module.config.json`) points at the class name
 * `SpeechToTextModule`.
 *
 * Hard contract: every transcription request runs with
 * `requiresOnDeviceRecognition = true`. Apple's docs guarantee that
 * setting this flag makes the request fail (rather than silently
 * fall back to the cloud) when on-device is unsupported for the
 * active locale or device. That's exactly what we want — MemTool's
 * positioning is "your memories never leave your phone", and a
 * silent server-side fallback would break that guarantee.
 *
 * All Speech-framework calls are wrapped in two layers of guard:
 *   - `#if canImport(Speech)` so the file still compiles on
 *     toolchains that pre-date the framework.
 *   - `if #available(iOS 13.0, *)` so the module never crashes on a
 *     device running an iOS version below the framework's minimum.
 *
 * The module never throws into JS; every failure path resolves with
 * `{ status: "unavailable", reason: "<machine_readable>" }` and the
 * JS wrapper's `normalizeReason` maps unknown strings to "unknown".
 *
 * Streaming transcription (Task #265):
 * `startStreamingTranscription` wires an `AVAudioEngine` microphone
 * tap into an `SFSpeechAudioBufferRecognitionRequest` and returns a
 * UUID session token in `{ status: "ok", token: "<uuid>" }`. The
 * caller must pass that token to `stopStreamingTranscription(token:)`
 * — if the token doesn't match the currently active session the stop
 * call is a no-op. This makes stale JS session handles safe to call:
 * they resolve immediately with "unavailable" and never disturb a
 * newer concurrent session.
 *
 * Finalization race fix:
 *   - `streamFinalPromise` is stored INSIDE the lock and only AFTER
 *     we confirm an active engine exists — no promise is stored when
 *     there is no session to finalize, so the safety timeout can
 *     never resolve a promise that was already handled inline.
 *   - The promise is stored before `endAudio()`/`engine.stop()` so
 *     the recognition-task callback can never fire `isFinal` and
 *     miss a promise that hasn't been stored yet.
 *   - `streamLatestFinalText` captures any `isFinal` callback that
 *     fires before `stop` is called, so `stop` can resolve
 *     immediately in that case.
 *
 * Threading: `streamLock` guards every mutation of streaming state.
 * `sendEvent` is always dispatched on the main queue.
 */
public class SpeechToTextModule: Module {

  // MARK: - Streaming state (guarded by streamLock)

  #if canImport(Speech) && canImport(AVFoundation)
  private var streamEngine: AVAudioEngine?
  private var streamRequest: SFSpeechAudioBufferRecognitionRequest?
  private var streamTask: SFSpeechRecognitionTask?
  /// UUID string assigned when a session starts; cleared when it ends.
  /// `stopStreamingTranscription` validates this token before acting so
  /// a stale JS session handle can never terminate a newer session.
  private var streamActiveToken: String?
  /// Set by the recognition-task callback the first time it receives
  /// `isFinal == true`. Read by `stopStreaming` to resolve immediately
  /// when the recognizer finalised before stop was called.
  private var streamLatestFinalText: String?
  /// Stored by `stopStreamingTranscription` BEFORE triggering `endAudio`.
  /// Resolved by the recognition-task `isFinal` callback (or inline
  /// when `streamLatestFinalText` is already set).
  private var streamFinalPromise: Promise?
  #endif

  private let streamLock = NSLock()

  // MARK: - Module definition

  public func definition() -> ModuleDefinition {
    Name("SpeechToText")

    Events("onSpeechPartialResult")

    Function("getAvailability") { () -> [String: Any?] in
      return self.availabilityPayload()
    }

    AsyncFunction("transcribe") { (audioFileUri: String, promise: Promise) in
      self.transcribe(audioFileUri: audioFileUri, promise: promise)
    }

    AsyncFunction("startStreamingTranscription") { (promise: Promise) in
      self.startStreaming(promise: promise)
    }

    // `token` must match the value returned by `startStreamingTranscription`.
    // A mismatched token resolves immediately with `unavailable` and never
    // disturbs the active session — this makes stale JS handles safe.
    AsyncFunction("stopStreamingTranscription") { (token: String, promise: Promise) in
      self.stopStreaming(token: token, promise: promise)
    }
  }

  // MARK: - Availability

  private func availabilityPayload() -> [String: Any?] {
    #if canImport(Speech)
    if #available(iOS 13.0, *) {
      guard let recognizer = SFSpeechRecognizer() else {
        return ["available": false, "reason": "recognizer_unavailable"]
      }
      if !recognizer.isAvailable {
        return ["available": false, "reason": "recognizer_unavailable"]
      }
      if !recognizer.supportsOnDeviceRecognition {
        return ["available": false, "reason": "on_device_unsupported"]
      }
      return ["available": true, "reason": nil]
    } else {
      return ["available": false, "reason": "ios_too_old"]
    }
    #else
    return ["available": false, "reason": "framework_not_present"]
    #endif
  }

  // MARK: - Transcribe (file-based, existing path)

  private func transcribe(audioFileUri: String, promise: Promise) {
    #if canImport(Speech)
    guard #available(iOS 13.0, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_too_old"])
      return
    }

    guard let url = URL(string: audioFileUri) else {
      promise.resolve(["status": "unavailable", "reason": "invalid_uri"])
      return
    }

    let resolveLock = NSLock()
    var didResolve = false
    let resolveOnce: ([String: Any?]) -> Void = { payload in
      resolveLock.lock()
      if didResolve {
        resolveLock.unlock()
        return
      }
      didResolve = true
      resolveLock.unlock()
      promise.resolve(payload)
    }

    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else {
        resolveOnce(["status": "unavailable", "reason": "authorization_denied"])
        return
      }
      guard let recognizer = SFSpeechRecognizer() else {
        resolveOnce(["status": "unavailable", "reason": "recognizer_unavailable"])
        return
      }
      if !recognizer.isAvailable {
        resolveOnce(["status": "unavailable", "reason": "recognizer_unavailable"])
        return
      }
      if !recognizer.supportsOnDeviceRecognition {
        resolveOnce(["status": "unavailable", "reason": "on_device_unsupported"])
        return
      }

      let request = SFSpeechURLRecognitionRequest(url: url)
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = false

      recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
          NSLog("[SpeechToText] recognitionTask error: %@", error.localizedDescription)
          resolveOnce(["status": "unavailable", "reason": "transcription_failed"])
          return
        }
        guard let result = result else { return }
        if !result.isFinal { return }
        let text = result.bestTranscription.formattedString
        resolveOnce(["status": "ok", "text": text])
      }
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "framework_not_present"])
    #endif
  }

  // MARK: - Streaming transcription (Task #265)

  /**
   * Begins a streaming recognition session.
   *
   * Returns `{ status: "ok", token: "<uuid>" }` on success. The caller
   * must pass the token to `stopStreamingTranscription` — this is the
   * mechanism that prevents stale session handles from terminating a
   * newer concurrent session.
   */
  private func startStreaming(promise: Promise) {
    #if canImport(Speech) && canImport(AVFoundation)
    guard #available(iOS 13.0, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_too_old"])
      return
    }

    SFSpeechRecognizer.requestAuthorization { [weak self] status in
      guard let self = self else { return }
      guard status == .authorized else {
        promise.resolve(["status": "unavailable", "reason": "authorization_denied"])
        return
      }
      guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
        promise.resolve(["status": "unavailable", "reason": "recognizer_unavailable"])
        return
      }
      guard recognizer.supportsOnDeviceRecognition else {
        promise.resolve(["status": "unavailable", "reason": "on_device_unsupported"])
        return
      }

      let token = UUID().uuidString
      let engine = AVAudioEngine()
      let request = SFSpeechAudioBufferRecognitionRequest()
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = true

      let inputNode = engine.inputNode
      let recordingFormat = inputNode.outputFormat(forBus: 0)
      inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
        request.append(buffer)
      }

      do {
        try engine.start()
      } catch {
        NSLog("[SpeechToText] AVAudioEngine start error: %@", error.localizedDescription)
        inputNode.removeTap(onBus: 0)
        promise.resolve(["status": "unavailable", "reason": "transcription_failed"])
        return
      }

      let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
        guard let self = self else { return }

        if let error = error {
          NSLog("[SpeechToText] streaming task error: %@", error.localizedDescription)
          self.streamLock.lock()
          // Only act on the error if we're still the active session.
          let isActive = self.streamActiveToken == token
          let pending = isActive ? self.streamFinalPromise : nil
          if isActive { self.streamFinalPromise = nil }
          self.streamLock.unlock()
          pending?.resolve(["status": "unavailable", "reason": "transcription_failed"])
          return
        }

        guard let result = result else { return }
        let text = result.bestTranscription.formattedString

        if result.isFinal {
          self.streamLock.lock()
          let isActive = self.streamActiveToken == token
          if isActive {
            self.streamLatestFinalText = text
            // Clear the active token so the safety timeout's guard
            // (`streamActiveToken == token`) evaluates false and
            // doesn't attempt a second resolve on the nil promise.
            self.streamActiveToken = nil
          }
          let pending = isActive ? self.streamFinalPromise : nil
          if isActive { self.streamFinalPromise = nil }
          self.streamLock.unlock()
          pending?.resolve(["status": "ok", "text": text])
        } else {
          DispatchQueue.main.async {
            // Only broadcast if still the active session; a stale
            // recognizer should not pollute the caption of a newer one.
            self.streamLock.lock()
            let isActive = self.streamActiveToken == token
            self.streamLock.unlock()
            if isActive {
              self.sendEvent("onSpeechPartialResult", ["text": text])
            }
          }
        }
      }

      // Store all state under lock before resolving the start promise
      // so a concurrent stop call always sees a consistent view.
      self.streamLock.lock()
      self.streamEngine = engine
      self.streamRequest = request
      self.streamTask = task
      self.streamActiveToken = token
      self.streamLatestFinalText = nil
      self.streamFinalPromise = nil
      self.streamLock.unlock()

      promise.resolve(["status": "ok", "token": token])
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "framework_not_present"])
    #endif
  }

  /**
   * Tears down the streaming session identified by `token` and waits
   * for the recognizer's final transcript before resolving.
   *
   * Token mismatch: resolves immediately with "unavailable" without
   * touching the currently active session — stale JS handles are safe.
   *
   * Finalization ordering:
   *   - Hardware refs are snapshotted and cleared under lock so a
   *     concurrent start or a second stop call sees a clean slate.
   *   - If `streamLatestFinalText` is set (isFinal fired before stop),
   *     the promise is resolved inline and hardware is torn down.
   *   - Otherwise `streamFinalPromise` is stored INSIDE the lock BEFORE
   *     `endAudio()`/`engine.stop()`, so the recognition-task callback
   *     can resolve it even if isFinal fires during teardown.
   *   - `streamActiveToken` is left intact after locking so the
   *     recognition-task callback can still match on it; the callback
   *     (or the 5 s safety timeout) is responsible for clearing it.
   */
  private func stopStreaming(token: String, promise: Promise) {
    #if canImport(Speech) && canImport(AVFoundation)
    guard #available(iOS 13.0, *) else {
      promise.resolve(["status": "unavailable", "reason": "ios_too_old"])
      return
    }

    streamLock.lock()

    // Token mismatch — stale handle, no-op.
    guard streamActiveToken == token else {
      streamLock.unlock()
      promise.resolve(["status": "unavailable", "reason": "transcription_failed"])
      return
    }

    // Snapshot hardware refs and clear them so a duplicate stop call
    // (or a new startStreaming call) sees a clean slate.
    let engine = streamEngine
    let request = streamRequest
    let alreadyFinalText = streamLatestFinalText
    streamEngine = nil
    streamRequest = nil
    streamTask = nil
    streamLatestFinalText = nil

    if alreadyFinalText == nil {
      // Store the promise BEFORE endAudio so the isFinal callback can
      // find it even if it fires during or immediately after teardown.
      // We intentionally do NOT clear streamActiveToken here — the
      // recognition-task callback still needs to match on it to know
      // which promise to resolve. The callback (or safety timeout)
      // is responsible for clearing streamActiveToken.
      streamFinalPromise = promise
    }
    // alreadyFinalText != nil path: clear the active token now since
    // we're resolving inline and don't need any more callbacks.
    if alreadyFinalText != nil {
      streamActiveToken = nil
    }

    streamLock.unlock()

    // Clean up hardware.
    engine?.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    engine?.stop()

    // Inline resolution when isFinal already fired before stop was called.
    if let text = alreadyFinalText {
      promise.resolve(["status": "ok", "text": text])
      return
    }

    // Safety timeout: if the recognizer never fires isFinal (e.g. OS
    // cancelled the task), resolve with empty text so the JS caller
    // is never left hanging. Also clears the active token so a future
    // startStreaming call starts from a clean state.
    DispatchQueue.global().asyncAfter(deadline: .now() + 5.0) { [weak self] in
      guard let self = self else { return }
      self.streamLock.lock()
      // Only act if this token is still the active one (i.e. the
      // isFinal callback hasn't already resolved and cleared it).
      guard self.streamActiveToken == token else {
        self.streamLock.unlock()
        return
      }
      let pending = self.streamFinalPromise
      self.streamFinalPromise = nil
      self.streamActiveToken = nil
      self.streamLock.unlock()
      if pending != nil {
        NSLog("[SpeechToText] stopStreaming: final callback timed out — resolving with empty")
        pending?.resolve(["status": "ok", "text": ""])
      }
    }
    #else
    promise.resolve(["status": "unavailable", "reason": "framework_not_present"])
    #endif
  }
}
