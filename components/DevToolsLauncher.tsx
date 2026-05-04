// Task #304: dev-only access surface for the debug screens that used
// to live as routes under `app/(app)/`. The screens themselves now
// live in `app/(app)/_dev/`, which expo-router treats as
// non-routable, so they cannot be reached via `router.push(...)`,
// a deep link, or the typed-routes table in any build profile.
//
// To preserve the development workflow, this component renders two
// buttons that mount the dev screens inside a React Native `Modal`.
// No routing is involved — the screens are imported and rendered as
// plain React components. The component returns `null` outside
// `__DEV__`, so the buttons and Modal never render in production
// builds. Note: because the imports are static, the dev screens may
// still be present in the JS bundle in production unless the Metro
// minifier prunes the `if (!__DEV__) return null` branch; the
// non-routability guarantee comes from the `_dev/` directory move
// (Task #304), not from this file.
//
// It is intended to be embedded inside the existing "Developer
// options" section in `settings.tsx`, which is itself gated on the
// `developerOptionsEnabled` preference (default ON in `__DEV__`,
// OFF in production).

import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import FoundationModelsSpikeScreen from "@/app/(app)/_dev/foundation-models-spike";
import HapticsDebugScreen from "@/app/(app)/_dev/haptics-debug";
import { useColors } from "@/hooks/useColors";

type DevTool = "foundation-models-spike" | "haptics-debug";

const TOOL_LABELS: Record<DevTool, string> = {
  "foundation-models-spike": "Foundation Models spike",
  "haptics-debug": "Haptics debug bench",
};

function DevToolModalBody({ tool }: { tool: DevTool }) {
  switch (tool) {
    case "foundation-models-spike":
      return <FoundationModelsSpikeScreen />;
    case "haptics-debug":
      return <HapticsDebugScreen />;
  }
}

export function DevToolsLauncher() {
  const colors = useColors();
  const [activeTool, setActiveTool] = useState<DevTool | null>(null);

  if (!__DEV__) return null;

  const tools: DevTool[] = ["foundation-models-spike", "haptics-debug"];

  return (
    <>
      {tools.map((tool) => (
        <Pressable
          key={tool}
          onPress={() => setActiveTool(tool)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`Open ${TOOL_LABELS[tool]}`}
          testID={`dev-tools-launcher-${tool}`}
        >
          <View style={styles.rowIcon}>
            <Ionicons name="bug-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.rowContent}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              {TOOL_LABELS[tool]}
            </Text>
            <Text style={[styles.rowSubtitle, { color: colors.mutedForeground }]}>
              Dev-only · not routable
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
      ))}

      <Modal
        visible={activeTool !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setActiveTool(null)}
      >
        <View style={[styles.modalRoot, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {activeTool ? TOOL_LABELS[activeTool] : ""}
            </Text>
            <Pressable
              onPress={() => setActiveTool(null)}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Close dev tool"
              testID="dev-tools-launcher-close"
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={styles.modalBody}>
            {activeTool ? <DevToolModalBody tool={activeTool} /> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowIcon: {
    width: 32,
    alignItems: "center",
  },
  rowContent: {
    flex: 1,
    marginLeft: 8,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalRoot: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
  },
  closeBtn: {
    padding: 4,
  },
  modalBody: {
    flex: 1,
  },
});
