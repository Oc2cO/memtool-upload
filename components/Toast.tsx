import { Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  Animated as RNAnimated,
  Dimensions,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");

interface ToastProps {
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  visible: boolean;
}

export function Toast({ message, icon = "checkmark-circle", iconColor, visible }: ToastProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new RNAnimated.Value(-100)).current;
  const opacity = useRef(new RNAnimated.Value(0)).current;

  // Track the last announced (visible, message) pair so unrelated re-renders
  // (e.g. safe-area insets changing on rotation, color theme flips) don't
  // re-trigger VoiceOver. We only want to announce on a false→true visibility
  // edge or on a message swap while the toast is still visible.
  const lastAnnouncedRef = useRef<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  React.useEffect(() => {
    if (visible) {
      const last = lastAnnouncedRef.current;
      const becameVisible = !last.visible;
      const messageChanged = last.message !== message;
      if (Platform.OS === "ios" && message && (becameVisible || messageChanged)) {
        AccessibilityInfo.announceForAccessibility(message);
      }
      lastAnnouncedRef.current = { visible: true, message };
      RNAnimated.parallel([
        RNAnimated.spring(translateY, {
          toValue: insets.top + 16,
          useNativeDriver: true,
          tension: 60,
          friction: 10,
        }),
        RNAnimated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      lastAnnouncedRef.current = { visible: false, message: "" };
      RNAnimated.parallel([
        RNAnimated.timing(translateY, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }),
        RNAnimated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, message, insets.top, translateY, opacity]);

  return (
    <RNAnimated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="none"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion={visible ? "polite" : "none"}
      accessibilityLabel={message}
      importantForAccessibility={visible ? "yes" : "no-hide-descendants"}
    >
      <Ionicons name={icon} size={20} color={iconColor ?? colors.primary} />
      <Text style={[styles.text, { color: colors.foreground }]}>{message}</Text>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // 20: deliberate one-off, between spacing.base (16) and spacing.lg (24).
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 100,
  },
  text: {
    ...text.bodyMedium,
  },
});
