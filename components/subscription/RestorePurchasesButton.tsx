import React from "react";
import {
  Pressable,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { ScalePress } from "@/components/alive/ScalePress";
import { shouldShowRestoreButton } from "@/lib/restoreFlow";

export interface RestorePressComponentProps {
  onPress: () => void;
  disabled?: boolean;
  hitSlop?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export interface RestorePurchasesButtonProps {
  isApple: boolean;
  isPro: boolean;
  onPress: () => void;
  disabled: boolean;
  textColor: string;
  containerStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  // Test-only override; production callers omit this and get ScalePress.
  PressComponent?: React.ComponentType<RestorePressComponentProps>;
}

export function RestorePurchasesButton({
  isApple,
  isPro,
  onPress,
  disabled,
  textColor,
  containerStyle,
  textStyle,
  PressComponent = ScalePress,
}: RestorePurchasesButtonProps): React.ReactElement | null {
  if (!shouldShowRestoreButton(isApple, isPro)) return null;
  return (
    <PressComponent
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityLabel="Restore purchases"
      style={[containerStyle, disabled ? { opacity: 0.5 } : null]}
    >
      <Text style={[textStyle, { color: textColor }]}>Restore purchases</Text>
    </PressComponent>
  );
}

export { Pressable as DefaultTestPressComponent };
