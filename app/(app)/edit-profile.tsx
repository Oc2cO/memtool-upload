import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useHaptics } from "@/lib/haptics";
import { useAuth } from "@/context/AuthContext";
import { apiUploadAvatar } from "@/lib/accountApi";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/inputLimits";
import { radius, spacing } from "@/constants/spacing";
import { text as typography } from "@/constants/typography";

function avatarKey(email: string): string {
  return `mt_avatar_${email}`;
}

function getInitials(name: string | undefined, email: string): string {
  if (name?.trim()) {
    return name.trim().slice(0, 2).toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const haptics = useHaptics();
  const { user, updateDisplayName, updateAvatar } = useAuth();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUri, setAvatarUri] = useState<string | null>(user?.avatar_uri ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [saved, setSaved] = useState(false);

  // Load the persisted avatar from AsyncStorage on mount so the screen
  // always reflects the device-local value even before AuthContext rehydrates.
  useEffect(() => {
    if (!user?.email) return;
    if (avatarUri) return; // already populated from context
    AsyncStorage.getItem(avatarKey(user.email))
      .then((stored) => {
        if (stored) setAvatarUri(stored);
      })
      .catch(() => {});
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = getInitials(displayName || user?.display_name, user?.email ?? "");

  const handlePickAvatar = async () => {
    Haptics.selectionAsync().catch(() => {});
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo access needed",
        "Allow MemTool to access your photo library in Settings to pick a profile photo.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const localUri = result.assets[0].uri;
      // Show the local preview immediately for snappy UX.
      setAvatarUri(localUri);
      // Upload to App Storage (presigned URL) and PATCH the resulting
      // server URL so the avatar persists across device reinstalls
      // (Task #309). On success swap the local URI out for the
      // server-served URL so other screens (settings, profile) render
      // the same persisted copy. Failures fall back to the local URI
      // — the in-memory AuthContext + AsyncStorage cache still works.
      try {
        const serverUrl = await apiUploadAvatar(localUri);
        setAvatarUri(serverUrl);
        await updateAvatar(serverUrl);
      } catch {
        await updateAvatar(localUri);
      }
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError("Display name can't be empty");
      haptics.play("error");
      return;
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      setNameError(`Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer`);
      haptics.play("error");
      return;
    }
    setNameError("");
    setIsSaving(true);
    try {
      await updateDisplayName(trimmed);
      haptics.play("capture");
      setSaved(true);
      setTimeout(() => {
        router.back();
      }, 800);
    } catch {
      haptics.play("error");
      Alert.alert(
        "Couldn't save",
        "We couldn't reach the server — your name is saved locally. Try again in a moment.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={handleBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>

        <Text style={[styles.title, { color: colors.foreground }]}>Edit profile</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Your display name and photo appear in greetings and prompts inside the app.
        </Text>

        {/* Avatar picker */}
        <Pressable
          onPress={handlePickAvatar}
          style={styles.avatarContainer}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          testID="edit-profile-avatar-picker"
        >
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={styles.avatarImage}
              contentFit="cover"
            />
          ) : (
            <LinearGradient
              colors={["#a78bfa", "#5eead4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarGradient}
            >
              <Text style={[styles.avatarInitials, { color: colors.background }]}>
                {initials}
              </Text>
            </LinearGradient>
          )}
          <View
            style={[
              styles.avatarEditBadge,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name="camera-outline" size={16} color={colors.foreground} />
          </View>
        </Pressable>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {nameError ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              {nameError}
            </Text>
          ) : null}

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Display name
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                color: colors.foreground,
                borderColor: nameError ? colors.destructive : colors.border,
              },
            ]}
            placeholder="How should Mem greet you?"
            placeholderTextColor={colors.mutedForeground}
            value={displayName}
            onChangeText={(t) => {
              setDisplayName(t);
              if (nameError) setNameError("");
            }}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleSave}
            testID="edit-profile-name-input"
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
            Email
          </Text>
          <View
            style={[
              styles.readonlyField,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.readonlyText, { color: colors.mutedForeground }]}>
              {user?.email ?? "—"}
            </Text>
          </View>
          <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
            Email changes require contacting support.
          </Text>

          <Pressable
            onPress={handleSave}
            disabled={isSaving || saved}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && !isSaving && { opacity: 0.85 },
              (isSaving || saved) && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={saved ? "Saved" : "Save changes"}
            testID="edit-profile-save"
          >
            <LinearGradient
              colors={["#a78bfa", "#5eead4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveBtnGradient}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {saved ? "Saved!" : "Save changes"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const AVATAR_SIZE = 96;

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
  title: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    marginBottom: 32,
  },
  avatarContainer: {
    alignSelf: "center",
    marginBottom: 32,
    position: "relative",
  },
  avatarGradient: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarInitials: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    padding: 24,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginBottom: 16,
  },
  fieldLabel: {
    ...typography.captionStrong,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.base,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  readonlyField: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.base,
    justifyContent: "center",
  },
  readonlyText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  helperText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    marginBottom: 8,
  },
  saveBtn: {
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 24,
  },
  saveBtnGradient: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
