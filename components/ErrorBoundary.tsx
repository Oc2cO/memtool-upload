import React, { Component, PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";

import { spacing } from "@/constants/spacing";

export type ErrorBoundaryProps = PropsWithChildren<{
  onError?: (error: Error, stackTrace: string) => void;
}>;

// Production fallback: a minimal, calm "Something went wrong — restart"
// screen (Task #371). We never want to surface a raw stack trace to a
// real user — Sentry already has the full error via the `onError`
// forward in `app/_layout.tsx`. In dev (`__DEV__`) we keep the
// stack-trace fallback because it's the most useful debugging signal
// when an engineer hits a render crash locally.
function MinimalCrashFallback() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0a0a0f",
        padding: spacing.lg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#ffffff",
          fontSize: 20,
          fontWeight: "700",
          marginBottom: spacing.base,
          textAlign: "center",
        }}
      >
        Something went wrong
      </Text>
      <Text
        style={{
          color: "#9ca3af",
          fontSize: 15,
          lineHeight: 22,
          textAlign: "center",
        }}
      >
        Please force-quit and reopen MemTool. Your saved memories are safe.
      </Text>
    </View>
  );
}

type ErrorBoundaryState = { error: Error | null };

/**
 * This is a special case for using class components. Error boundaries must be class components because React only provides error boundary functionality through lifecycle methods (componentDidCatch and getDerivedStateFromError) which are not available in functional components.
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    if (typeof this.props.onError === "function") {
      this.props.onError(error, info.componentStack);
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (!__DEV__) {
        return <MinimalCrashFallback />;
      }
      return (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 64 }}>
            <Text
              selectable
              style={{ color: "#ff5555", fontSize: 16, fontFamily: "monospace" }}
            >
              {this.state.error.message}
            </Text>
            {this.state.error.stack ? (
              <Text
                selectable
                style={{
                  color: "#ff5555",
                  fontSize: 12,
                  fontFamily: "monospace",
                  marginTop: spacing.base,
                }}
              >
                {this.state.error.stack}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}
