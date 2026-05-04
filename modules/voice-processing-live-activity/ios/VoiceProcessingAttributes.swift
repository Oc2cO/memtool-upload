import Foundation

#if canImport(ActivityKit)
import ActivityKit

public enum VoiceProcessingPhase: String, Codable, Hashable {
    case processing
    case ready
}

@available(iOS 16.1, *)
public struct VoiceProcessingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public let phase: VoiceProcessingPhase

        public init(phase: VoiceProcessingPhase) {
            self.phase = phase
        }
    }

    public let deepLinkUrl: String

    public init(deepLinkUrl: String) {
        self.deepLinkUrl = deepLinkUrl
    }
}
#endif
