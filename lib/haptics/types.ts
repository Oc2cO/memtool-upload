// Apple's AHAP (Apple Haptic and Audio Pattern) JSON shape.
// We type it strictly so the TS compiler catches typos in the .ahap
// files when we import them at compile time.
//
// Reference: https://developer.apple.com/documentation/corehaptics/representing_haptic_patterns_in_ahap_files

export type AhapEventType = "HapticTransient" | "HapticContinuous";

export type AhapParameterId = "HapticIntensity" | "HapticSharpness";

export type AhapEventParameter = {
  ParameterID: AhapParameterId;
  ParameterValue: number;
};

export type AhapEvent = {
  Time: number;
  EventType: AhapEventType;
  EventDuration?: number;
  EventParameters: AhapEventParameter[];
};

export type AhapPatternEntry = {
  Event: AhapEvent;
};

export type AhapPattern = {
  Version: number;
  Metadata?: Record<string, unknown>;
  Pattern: AhapPatternEntry[];
};

export type HapticName =
  | "capture"
  | "link-formed"
  | "streak-extended"
  | "day-recap-ready"
  | "error"
  | "undo";
