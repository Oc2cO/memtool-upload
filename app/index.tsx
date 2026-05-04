import { Redirect } from "expo-router";
import React from "react";

import { LoadingScreen } from "@/components/LoadingScreen";
import { useAuth } from "@/context/AuthContext";

export default function Index() {
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

  return <Redirect href="/(app)/(tabs)" />;
}
