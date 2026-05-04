/**
 * Forgot-password screen — Task #299.
 *
 * Four-step in-app flow:
 *   1. enter_email  — user types their address and requests a reset code.
 *   2. check_email  — non-enumerating confirmation; user is asked to check
 *                     their inbox and enter the 6-digit code.
 *   3. enter_code   — user enters the code + new password + confirmation.
 *   4. done         — success banner; auto-navigates back to sign-in.
 *
 * Network errors (offline, server 5xx) surface inline with retry guidance.
 * The screen never reveals whether an email address is registered.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useHaptics } from "@/lib/haptics";
import { GradientButton } from "@/components/GradientButton";
import { apiForgotPassword, apiResetPassword } from "@/lib/accountApi";
import { EMAIL_MAX_LENGTH } from "@/lib/inputLimits";
import { AuthCinematicStage } from "@/components/alive/AuthCinematicStage";

type Step = "enter_email" | "check_email" | "enter_code" | "done";

const MIN_PASSWORD_LENGTH = 8;

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const haptics = useHaptics();
  // When the user opens the deep link from the reset email
  // (memtool://forgot-password?code=NNNNNN), pre-fill the code and skip
  // straight to the "enter new password" step.
  const params = useLocalSearchParams<{ code?: string }>();
  const initialCode = typeof params.code === "string" ? params.code.trim() : "";

  const [step, setStep] = useState<Step>(initialCode ? "enter_code" : "enter_email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(initialCode);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ---- Step 1: request reset code ----------------------------------------

  const handleRequestCode = async () => {
    if (loading) return;
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await apiForgotPassword(trimmedEmail);
      haptics.play("capture");
      setStep("check_email");
    } catch (err: unknown) {
      haptics.play("error");
      // Only surface genuine network/server failures — not "email not found"
      // (the server never reveals that — see account.ts).
      setError(err instanceof Error ? err.message : "Couldn't send the reset email — try again.");
    } finally {
      setLoading(false);
    }
  };

  // ---- Step 2→3: user has their code ------------------------------------

  const handleHaveCode = () => {
    setError("");
    setStep("enter_code");
  };

  // ---- Step 3: submit new password ----------------------------------------

  const handleResetPassword = async () => {
    if (loading) return;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Please enter the 6-digit code from your email.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await apiResetPassword(trimmedCode, newPassword);
      haptics.play("capture");
      setStep("done");
      // Navigate back to login after a brief celebration pause.
      setTimeout(() => {
        router.replace("/login");
      }, 2_200);
    } catch (err: unknown) {
      haptics.play("error");
      setError(err instanceof Error ? err.message : "Couldn't reset password — try again.");
    } finally {
      setLoading(false);
    }
  };

  // ---- Render helpers -------------------------------------------------------

  const renderError = () =>
    error ? (
      <Text
        style={[styles.errorText, { color: colors.destructive }]}
        testID="forgot-password-error"
      >
        {error}
      </Text>
    ) : null;

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (step === "check_email" || step === "enter_code") {
      setError("");
      setStep("enter_email");
    } else {
      router.back();
    }
  };

  // ---- Render ---------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {step !== "done" && (
          <Pressable
            onPress={handleBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            testID="forgot-password-back"
          >
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
        )}

        {/* Resting Memora composition (no cinematic on this screen — Task #350). */}
        {step !== "done" && (
          <AuthCinematicStage mode="forgot" height={160} />
        )}

        {/* ---- Step 1: Enter email ---- */}
        {step === "enter_email" && (
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Reset password
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter your email and we'll send you a 6-digit code to reset your
              password.
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="Email address"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                maxLength={EMAIL_MAX_LENGTH}
                returnKeyType="send"
                onSubmitEditing={handleRequestCode}
                testID="forgot-password-email-input"
              />
              {renderError()}
              <GradientButton
                title={loading ? "Sending…" : "Send reset code"}
                onPress={handleRequestCode}
                disabled={loading}
                testID="forgot-password-send-code"
              />
            </View>
            <Pressable
              onPress={() => router.replace("/login")}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              testID="forgot-password-back-to-login"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                Back to sign in
              </Text>
            </Pressable>
          </View>
        )}

        {/* ---- Step 2: Check email ---- */}
        {step === "check_email" && (
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Check your email
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              If an account exists for{" "}
              <Text style={{ fontWeight: "600" }}>{email.trim()}</Text>, you'll
              receive a 6-digit reset code within a minute. Check your spam
              folder if it doesn't arrive.
            </Text>
            <GradientButton
              title="Enter reset code"
              onPress={handleHaveCode}
              testID="forgot-password-enter-code-btn"
            />
            <Pressable
              onPress={() => setStep("enter_email")}
              style={styles.secondaryBtn}
              accessibilityRole="button"
              testID="forgot-password-resend"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                Didn't receive it? Try a different email
              </Text>
            </Pressable>
          </View>
        )}

        {/* ---- Step 3: Enter code + new password ---- */}
        {step === "enter_code" && (
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Enter reset code
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter the 6-digit code from your email and choose a new password.
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="6-digit code"
                placeholderTextColor={colors.mutedForeground}
                value={code}
                onChangeText={(t) => { setCode(t); setError(""); }}
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="next"
                testID="forgot-password-code-input"
              />
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="New password"
                placeholderTextColor={colors.mutedForeground}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setError(""); }}
                secureTextEntry
                returnKeyType="next"
                testID="forgot-password-new-password-input"
              />
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.foreground,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setError(""); }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleResetPassword}
                testID="forgot-password-confirm-password-input"
              />
              {renderError()}
              <GradientButton
                title={loading ? "Updating…" : "Set new password"}
                onPress={handleResetPassword}
                disabled={loading}
                testID="forgot-password-submit-reset"
              />
            </View>
          </View>
        )}

        {/* ---- Step 4: Done ---- */}
        {step === "done" && (
          <View style={[styles.content, styles.doneContent]}>
            <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground, marginTop: 24 }]}>
              Password updated
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Your new password is set. Taking you back to sign in…
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  backBtn: {
    alignSelf: "flex-start",
    marginBottom: 24,
    padding: 4,
  },
  content: {
    flex: 1,
  },
  doneContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginBottom: 32,
  },
  card: {
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    marginBottom: 16,
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  secondaryBtn: {
    marginTop: 8,
    alignItems: "center",
    padding: 12,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
