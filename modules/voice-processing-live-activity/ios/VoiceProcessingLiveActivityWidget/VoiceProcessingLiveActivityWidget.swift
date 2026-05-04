import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

// Brand palette — keep in sync with `constants/colors.ts`.
private enum Brand {
    static let purple = Color(red: 0x8b / 255, green: 0x5c / 255, blue: 0xf6 / 255)
    static let purpleDeep = Color(red: 0x1f / 255, green: 0x17 / 255, blue: 0x40 / 255)
    static let purpleDeeper = Color(red: 0x15 / 255, green: 0x10 / 255, blue: 0x2a / 255)
    static let success = Color(red: 0x5e / 255, green: 0xea / 255, blue: 0xd4 / 255)
    static let textOnDark = Color(red: 0xf5 / 255, green: 0xf3 / 255, blue: 0xff / 255)
}

@available(iOS 16.1, *)
private func title(for phase: VoiceProcessingPhase) -> String {
    switch phase {
    case .processing: return "Processing memory…"
    case .ready: return "Memory ready"
    }
}

@available(iOS 16.1, *)
private func subtitle(for phase: VoiceProcessingPhase) -> String {
    switch phase {
    case .processing: return "Turning your voice note into a draft"
    case .ready: return "Tap to review"
    }
}

@available(iOS 16.1, *)
private struct PhaseIcon: View {
    let phase: VoiceProcessingPhase

    var body: some View {
        switch phase {
        case .processing:
            Image(systemName: "waveform")
                .symbolRenderingMode(.hierarchical)
                .foregroundColor(Brand.purple)
        case .ready:
            Image(systemName: "sparkles")
                .symbolRenderingMode(.hierarchical)
                .foregroundColor(Brand.success)
        }
    }
}

@available(iOS 16.1, *)
private struct PhaseTrailing: View {
    let phase: VoiceProcessingPhase

    var body: some View {
        switch phase {
        case .processing:
            ProgressView()
                .progressViewStyle(.circular)
                .tint(Brand.purple)
        case .ready:
            Image(systemName: "chevron.right")
                .foregroundColor(Brand.success)
        }
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<VoiceProcessingAttributes>

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Brand.purple.opacity(0.22))
                    .overlay(Circle().stroke(Brand.purple.opacity(0.45), lineWidth: 1))
                    .frame(width: 44, height: 44)
                PhaseIcon(phase: context.state.phase)
                    .font(.title3)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title(for: context.state.phase))
                    .font(.headline)
                    .foregroundColor(Brand.textOnDark)
                Text(subtitle(for: context.state.phase))
                    .font(.subheadline)
                    .foregroundColor(Brand.textOnDark.opacity(0.75))
            }

            Spacer(minLength: 8)

            PhaseTrailing(phase: context.state.phase)
                .font(.title3)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            LinearGradient(
                colors: [Brand.purpleDeep, Brand.purpleDeeper],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }
}

@available(iOS 16.1, *)
@main
struct VoiceProcessingLiveActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        VoiceProcessingLiveActivityWidget()
    }
}

@available(iOS 16.1, *)
struct VoiceProcessingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VoiceProcessingAttributes.self) { context in
            LockScreenView(context: context)
                .widgetURL(URL(string: context.attributes.deepLinkUrl))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PhaseIcon(phase: context.state.phase)
                        .font(.title3)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PhaseTrailing(phase: context.state.phase)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title(for: context.state.phase))
                            .font(.headline)
                            .foregroundColor(Brand.textOnDark)
                        Text(subtitle(for: context.state.phase))
                            .font(.subheadline)
                            .foregroundColor(Brand.textOnDark.opacity(0.75))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                PhaseIcon(phase: context.state.phase)
            } compactTrailing: {
                switch context.state.phase {
                case .processing:
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(Brand.purple)
                case .ready:
                    Text("Ready")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(Brand.success)
                }
            } minimal: {
                PhaseIcon(phase: context.state.phase)
            }
            .keylineTint(Brand.purple)
            .widgetURL(URL(string: context.attributes.deepLinkUrl))
        }
    }
}
#endif
