/**
 * UI-level coverage for the Settings → "Export your memories" catch
 * block. The decision logic lives in `handleExportError` so it's
 * mountable in jest (the real Settings screen pulls in expo-router /
 * fonts / animations and can't be rendered here, same reason as the
 * `useHandleRestore` extraction).
 *
 * Each test renders a tiny Host component that drives
 * `handleExportError` from a button press, with `fetchAllMemoriesForExport`
 * mocked to throw the error shape we want to exercise. We then assert
 * on the rendered error message and (for the 401 branch) on the alert
 * payload — including pressing the "Sign in" button to prove it calls
 * `logout()`.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import { AuthError } from "./auth";
import {
  GENERIC_EXPORT_ERROR_MESSAGE,
  SERVER_PROBLEM_EXPORT_MESSAGE,
  SESSION_EXPIRED_EXPORT_MESSAGE,
  handleExportError,
} from "./exportErrorHandler";

// Mocked stand-in for the real data-layer fetch. The tests inject the
// error they want by calling `mockFetch.mockRejectedValueOnce(...)`,
// matching the contract `fetchAllMemoriesForExport` provides in
// production (it re-throws AuthError with a numeric `status` on HTTP
// failures rather than silently returning cached data).
const mockFetch = jest.fn();

interface CapturedAlert {
  title: string;
  message?: string;
  buttons?: Array<{
    text?: string;
    style?: "default" | "cancel" | "destructive";
    onPress?: () => void;
  }>;
}

interface HostProps {
  logout: () => void;
  onAlert: (alert: CapturedAlert) => void;
}

function Host({ logout, onAlert }: HostProps) {
  const [exportError, setExportError] = useState<string | null>(null);

  const onPress = async () => {
    try {
      await mockFetch();
    } catch (err) {
      handleExportError(err, {
        setExportError,
        logout,
        alert: (title, message, buttons) => {
          onAlert({ title, message, buttons });
        },
      });
    }
  };

  return (
    <View>
      <Pressable onPress={onPress} accessibilityLabel="Run export">
        <Text>Run export</Text>
      </Pressable>
      {exportError !== null && (
        <Text testID="export-error">{exportError}</Text>
      )}
    </View>
  );
}

async function tapAndFlush(
  getByLabelText: ReturnType<typeof render>["getByLabelText"],
) {
  await act(async () => {
    fireEvent.press(getByLabelText("Run export"));
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("handleExportError — Settings export catch block", () => {
  test("AuthError 401 → renders 'session expired' message and pops a Sign in alert that calls logout", async () => {
    mockFetch.mockRejectedValueOnce(
      new AuthError("Invalid credentials", 401, { error: "Invalid credentials" }),
    );
    const logout = jest.fn();
    const onAlert = jest.fn();

    const view = render(<Host logout={logout} onAlert={onAlert} />);
    await tapAndFlush(view.getByLabelText);

    // 1. The inline banner shows the session-expired copy.
    expect(view.getByTestId("export-error").props.children).toBe(
      SESSION_EXPIRED_EXPORT_MESSAGE,
    );

    // 2. An alert was popped with the right title + message.
    expect(onAlert).toHaveBeenCalledTimes(1);
    const captured = onAlert.mock.calls[0][0] as CapturedAlert;
    expect(captured.title).toBe("Session expired");
    expect(captured.message).toBe(SESSION_EXPIRED_EXPORT_MESSAGE);

    // 3. The alert has both a Cancel and a Sign in button. The Sign in
    //    button must call `logout()` so the (app) auth guard redirects
    //    the user to /login. Cancel must NOT call logout.
    const signInBtn = captured.buttons?.find((b) => b.text === "Sign in");
    const cancelBtn = captured.buttons?.find((b) => b.text === "Cancel");
    expect(signInBtn).toBeDefined();
    expect(cancelBtn).toBeDefined();
    expect(cancelBtn?.style).toBe("cancel");

    expect(logout).not.toHaveBeenCalled();
    signInBtn?.onPress?.();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test("AuthError with non-401 HTTP status → renders the server-problem copy, no alert", async () => {
    mockFetch.mockRejectedValueOnce(
      new AuthError("Server error — please try again", 500, {
        error: "boom",
      }),
    );
    const logout = jest.fn();
    const onAlert = jest.fn();

    const view = render(<Host logout={logout} onAlert={onAlert} />);
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("export-error").props.children).toBe(
      SERVER_PROBLEM_EXPORT_MESSAGE,
    );
    // Server-problem branch is informational only — no sign-in alert,
    // no logout side-effect.
    expect(onAlert).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  test("generic non-AuthError → falls back to the calm 'try again in a moment' copy", async () => {
    mockFetch.mockRejectedValueOnce(new Error("kapow"));
    const logout = jest.fn();
    const onAlert = jest.fn();

    const view = render(<Host logout={logout} onAlert={onAlert} />);
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("export-error").props.children).toBe(
      GENERIC_EXPORT_ERROR_MESSAGE,
    );
    expect(onAlert).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  test("AuthError with no status (offline-shaped) → also uses the generic 'try again' copy", async () => {
    // `authFetch` constructs this exact shape when `fetch()` itself
    // rejects (e.g. genuine network failure). It must NOT trip the
    // 401 branch and must NOT pop a sign-in alert.
    mockFetch.mockRejectedValueOnce(
      new AuthError("Couldn't reach the server — check your connection"),
    );
    const logout = jest.fn();
    const onAlert = jest.fn();

    const view = render(<Host logout={logout} onAlert={onAlert} />);
    await tapAndFlush(view.getByLabelText);

    expect(view.getByTestId("export-error").props.children).toBe(
      GENERIC_EXPORT_ERROR_MESSAGE,
    );
    expect(onAlert).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
