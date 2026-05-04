import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useMemories } from "@/context/MemoriesContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { clearDraft, loadDraft, saveDraft } from "@/lib/captureDraftStore";
import { Toast } from "@/components/Toast";
import { DraftSavedCue } from "@/components/DraftSavedCue";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import {
  CAPTURE_COOLDOWN_ALERT_BODY,
  CAPTURE_COOLDOWN_ALERT_TITLE,
  CaptureBlockedError,
  CaptureLimitReachedError,
} from "@/lib/subscription";
import { getCaptureLimitState } from "@/lib/captureLimits";
import { MEMORY_CONTENT_MAX_LENGTH, PERSON_NAME_MAX_LENGTH } from "@/lib/inputLimits";
import { useHaptics } from "@/lib/haptics";

export default function LogCallScreen() {
  const [person, setPerson] = useState("");
  const [content, setContent] = useState("");
  const [selectedTags] = useState<string[]>(["call"]);
  const [showToast, setShowToast] = useState(false);
  const [toastSynced, setToastSynced] = useState(true);
  // Same Round 3 double-tap guard as capture.tsx — see the comment
  // there for the rationale. Two rapid Save taps used to enqueue two
  // outbox entries before the disabled state could react.
  const [submitting, setSubmitting] = useState(false);

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { addCall, todayMemories } = useMemories();
  const { status: subscriptionStatus, freeDailyCaptureLimit } = useSubscription();
  const haptics = useHaptics();

  // Same gate as the main capture screen — log-call also creates a
  // memory, so it has to count against the same daily cap or the cap
  // would be trivially bypassable. Pro is read from useSubscription
  // (single source of truth post-Task #22). Math comes from
  // `getCaptureLimitState` so all three layers stay in sync.
  // `freeDailyCaptureLimit` (Task #144) is the live server cap so the
  // upsell copy below ("You've logged N entries today...") matches
  // on-call's current override during a promotion.
  const { atLimit: limitReached, limit } = getCaptureLimitState(
    todayMemories.length,
    subscriptionStatus?.is_pro === true,
    freeDailyCaptureLimit,
  );

  // Draft persistence (Task #319). Same shape as the Capture screen
  // — see the comment block there for the why behind the hydration
  // gate, the debounce window, the empty-state collapse, and the
  // `draftClosedRef` post-clear write suppressor.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftClosedRef = useRef(false);

  // "Draft saved" cue (Task #322 follow-up to #319). Mirror of the
  // Capture-screen wiring — see capture.tsx for the rationale on
  // gating, hold time, and reduce-motion handling.
  const [draftCueVisible, setDraftCueVisible] = useState(false);
  const draftCueHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // See capture.tsx — one-shot suppressor that swallows the cue for
  // the no-op write triggered by hydrating a non-empty draft.
  const skipNextCueRef = useRef(false);

  const showDraftCue = useCallback(() => {
    setDraftCueVisible(true);
    if (draftCueHideTimerRef.current) {
      clearTimeout(draftCueHideTimerRef.current);
    }
    draftCueHideTimerRef.current = setTimeout(() => {
      draftCueHideTimerRef.current = null;
      setDraftCueVisible(false);
    }, 1400);
  }, []);

  const hideDraftCue = useCallback(() => {
    if (draftCueHideTimerRef.current) {
      clearTimeout(draftCueHideTimerRef.current);
      draftCueHideTimerRef.current = null;
    }
    setDraftCueVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (draftCueHideTimerRef.current) {
        clearTimeout(draftCueHideTimerRef.current);
        draftCueHideTimerRef.current = null;
      }
    };
  }, []);

  const cancelPendingDraftWrite = useCallback(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, []);

  const closeDraft = useCallback(() => {
    cancelPendingDraftWrite();
    draftClosedRef.current = true;
    hideDraftCue();
    void clearDraft("log-call", userId);
  }, [cancelPendingDraftWrite, hideDraftCue, userId]);

  useEffect(() => {
    let cancelled = false;
    // Reset hydration + close flags for the new user so any pending
    // debounce write from the previous account can't fire against a
    // half-loaded next-account state.
    draftClosedRef.current = false;
    setDraftHydrated(false);
    if (!userId) {
      setDraftHydrated(true);
      return;
    }
    void loadDraft("log-call", userId).then((draft) => {
      if (cancelled) return;
      if (draft) {
        setContent(draft.content);
        setPerson(draft.person);
        // Hydration writes the same blob back on the next debounce
        // tick — suppress the cue for that one write so a restored
        // draft doesn't flash "Draft saved" without any user input.
        skipNextCueRef.current = true;
      } else {
        // Account-switch isolation: wipe leftover fields when the
        // new user has no draft, so prior text can't leak across
        // accounts on a hot swap (no remount).
        setContent("");
        setPerson("");
      }
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!draftHydrated || !userId) return;
    if (draftClosedRef.current) return;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      if (draftClosedRef.current) return;
      // Cue gate: either field carrying real content is enough to
      // justify a "Draft saved" flash. Both empty → saveDraft
      // collapses to clearDraft, nothing to advertise.
      const hasContent =
        content.trim().length > 0 || person.trim().length > 0;
      const suppress = skipNextCueRef.current;
      skipNextCueRef.current = false;
      void saveDraft("log-call", userId, { content, person, tags: [] }).then(
        () => {
          if (draftClosedRef.current) return;
          if (suppress) return;
          if (hasContent) showDraftCue();
        },
      );
    }, 800);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [content, person, userId, draftHydrated, showDraftCue]);

  const handleSave = async () => {
    if (submitting) return;
    if (!person.trim() || !content.trim() || limitReached) return;
    setSubmitting(true);
    // Same "capture" signature as capture.tsx — logging a call is a
    // capture verb, not a generic save, so we want the same haptic
    // texture so the brain learns "MemTool just caught something".
    haptics.play("capture");
    let syncedToCloud = true;
    try {
      const result = await addCall({ person: person.trim(), content: content.trim(), tags: selectedTags });
      syncedToCloud = result.syncedToCloud;
    } catch (err) {
      // Same Layer 2 catch as capture.tsx: if MemoriesContext throws
      // CaptureLimitReachedError (e.g. the main capture surface
      // captured into the same day-bucket while this screen was
      // open), route to upsell instead of crashing.
      if (err instanceof CaptureLimitReachedError) {
        haptics.play("error");
        // Drop the draft on cap-block so the next visit starts clean.
        closeDraft();
        router.replace("/subscription");
        return;
      }
      // Server-side auto-block — same cooldown treatment as
      // capture.tsx. Distinct from the cap upsell because there's
      // no Pro tier the user can buy out of this; the block
      // self-clears at UTC midnight.
      if (err instanceof CaptureBlockedError) {
        haptics.play("error");
        // Per Task #319: cooldown block also clears the draft so it
        // doesn't reappear on the next visit. In-memory text stays
        // visible for the current session.
        closeDraft();
        Alert.alert(CAPTURE_COOLDOWN_ALERT_TITLE, CAPTURE_COOLDOWN_ALERT_BODY);
        // Stay on the screen with the form usable — see capture.tsx
        // for the matching comment.
        setSubmitting(false);
        return;
      }
      throw err;
    }
    // Successful save — drop the draft so reopening the screen
    // doesn't restore an already-logged call.
    closeDraft();
    setToastSynced(syncedToCloud);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
      router.back();
    }, 1500);
  };

  const saveDisabled = !person.trim() || !content.trim() || limitReached || submitting;

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            // Explicit discard via the cancel gesture — drop the draft
            // so the next visit starts fresh.
            closeDraft();
            router.back();
          }}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Discard log call"
        >
          <Ionicons name="close" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Log Call</Text>
        <Pressable 
          onPress={() => handleSave()} 
          style={[styles.saveButton, saveDisabled && { opacity: 0.5 }]}
          disabled={saveDisabled}
        >
          <Text style={[styles.saveText, { color: colors.primary }]}>{submitting ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
      <DraftSavedCue visible={draftCueVisible} topOffset={insets.top + 64} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {limitReached ? (
          <ProUpsellCard
            icon="infinite-outline"
            title="Daily capture limit reached"
            body={`You've captured ${limit} memories today on the free plan. Upgrade to MemTool Pro to capture unlimited memories every day.`}
          />
        ) : (
          <>
            <TextInput
              style={[styles.personInput, { color: colors.foreground, borderBottomColor: colors.border }]}
              placeholder="Who did you speak with?"
              placeholderTextColor={colors.mutedForeground}
              value={person}
              onChangeText={setPerson}
              autoFocus
              maxLength={PERSON_NAME_MAX_LENGTH}
            />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="What was discussed?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              value={content}
              onChangeText={setContent}
              textAlignVertical="top"
              maxLength={MEMORY_CONTENT_MAX_LENGTH}
            />
            {content.length >= MEMORY_CONTENT_MAX_LENGTH ? (
              <Text style={[styles.lengthHint, { color: colors.mutedForeground }]}>
                You've reached the {MEMORY_CONTENT_MAX_LENGTH.toLocaleString()}-character limit for one note.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
      <Toast
        message={toastSynced ? "Call logged" : "Saved offline — will sync when reconnected"}
        icon={toastSynced ? "checkmark-circle" : "cloud-offline-outline"}
        iconColor={toastSynced ? undefined : colors.mutedForeground}
        visible={showToast}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  iconButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  saveButton: { padding: 4, paddingHorizontal: 8 },
  saveText: { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  scrollContent: { padding: 24, paddingBottom: 100 },
  personInput: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    paddingVertical: 12,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  input: {
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    lineHeight: 26,
    minHeight: 200,
  },
  lengthHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
});
