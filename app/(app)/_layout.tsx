import { Redirect, Stack } from "expo-router";
import React from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import { useAuth } from "@/context/AuthContext";

const APP_BG = "#0a0a0f";

export default function AppLayout() {
  const { user, isLoading, hasSeenOnboarding } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (!hasSeenOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerShown: false,
        contentStyle: { backgroundColor: APP_BG },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="capture" options={{ presentation: "modal" }} />
      <Stack.Screen name="voice-capture" options={{ presentation: "modal" }} />
      <Stack.Screen name="memory-match" />
      <Stack.Screen name="game-24" />
      <Stack.Screen name="recap" />
      <Stack.Screen name="insights" />
      <Stack.Screen name="ai-guide" />
      <Stack.Screen
        name="intro-video"
        options={{
          presentation: "modal",
          animation: "fade",
          gestureEnabled: true,
          gestureDirection: "vertical",
        }}
      />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="support" />
      <Stack.Screen name="about" />
      <Stack.Screen name="licenses" />
      <Stack.Screen name="wellness" options={{ presentation: "modal" }} />
      <Stack.Screen
        name="photo/[clientId]"
        options={{
          presentation: "modal",
          animation: "fade",
          gestureEnabled: true,
          gestureDirection: "vertical",
          contentStyle: { backgroundColor: "#000" },
        }}
      />
      <Stack.Screen name="log-call" options={{ presentation: "modal" }} />
      <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
      <Stack.Screen
        name="tip-archive"
        options={{
          title: "Daily Boost Archive",
          headerShown: true,
          headerStyle: { backgroundColor: "#0a0612" },
          headerTintColor: "#f5f3ff",
        }}
      />
    </Stack>
  );
}
