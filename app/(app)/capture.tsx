import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useMemories } from "@/context/MemoriesContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { clearDraft, loadDraft, saveDraft } from "@/lib/captureDraftStore";
import { stripPhotoMetadata } from "@/lib/memoryPhotos";
import { useMemoryFacets } from "@/lib/useMemoryFacets";
import { Toast } from "@/components/Toast";
import { DraftSavedCue } from "@/components/DraftSavedCue";
import { SettleOnMount } from "@/components/alive/SettleOnMount";
import { ScalePress } from "@/components/alive/ScalePress";
import { MemCharacter } from "@/components/MemCharacter";
import { MEM_STATES } from "@/lib/memStates";
import { ProUpsellCard } from "@/components/ProUpsellCard";
import { VoicePromptControl } from "@/components/VoicePromptControl";
import { IllustrationLoader } from "@/components/IllustrationLoader";
import { IllustrationPolaroid } from "@/components/IllustrationPolaroid";
import {
  CAPTURE_COOLDOWN_ALERT_BODY,
  CAPTURE_COOLDOWN_ALERT_TITLE,
  CaptureBlockedError,
  CaptureLimitReachedError,
} from "@/lib/subscription";
import { MAX_PHOTOS_PER_MEMORY } from "@/lib/memoryPhotos";

interface PickedPhoto {
  uri: string;
  mimeType?: string;
  takenAt?: string;
}
import {
  getCaptureLimitState,
  getIllustrationQuotaState,
  getLocalDayKey,
  ILLUSTRATION_OUT_INLINE,
} from "@/lib/captureLimits";
import {
  DAILY_SELFIE_TAG,
  computeSelfieStreak,
  findSelfieForDay,
  selfieLateDayNudge,
  selfieStreakMilestone,
  selfieStreakMilestoneCopy,
} from "@/lib/dailySelfie";
import { MEMORY_CONTENT_MAX_LENGTH } from "@/lib/inputLimits";
import { useHaptics } from "@/lib/haptics";
import { useCognitiveAudio } from "@/lib/cognitiveAudio";
import { radius, spacing } from "@/constants/spacing";
import { text } from "@/constants/typography";

const SUGGESTED_TAGS_POOL = ["social", "work", "health", "idea", "errand", "call", "reflection"];

export default function CaptureScreen() {
  const [content, setContent] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [toastSynced, setToastSynced] = useState(true);
  // Pre-launch Round 3 guard: a rapid double-tap on Save fired
  // `addMemory` twice before the first await resolved (the disabled
  // state only flips after `setContent("")` runs, which is after the
  // outbox enqueue). The duplicate landed in the outbox and synced as
  // two separate memories. `submitting` blocks the second tap until
  // the first save fully settles.
  const [submitting, setSubmitting] = useState(false);

  // Once a memory is saved we swap the form for a confirmation card
  // (Task #184). The card holds the saved text + an Illustrate button
  // so the user can illustrate the memory they just captured without
  // having to tab over to Archive and find it. `savedId` is the
  // returned client_id so we know which memory to call illustrate on.
  // `savedContent` is held locally because we clear `content` on save
  // to reset the input for the next capture (if user dismisses the
  // confirm card to capture another).
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [savedIllustrationUrl, setSavedIllustrationUrl] = useState<string | null>(null);
  const [savedIllustrationThumbUrl, setSavedIllustrationThumbUrl] = useState<
    string | null
  >(null);
  const [illustrating, setIllustrating] = useState(false);
  const [illustrateError, setIllustrateError] = useState<string | null>(null);

  // User-attached photo state (Tasks #372, #385). Up to
  // MAX_PHOTOS_PER_MEMORY (4) photos per memory. The picker
  // appends new picks instead of replacing — re-tapping "Add
  // photo" with 2 already attached pops the picker bounded at
  // 2 more selections. We keep local URIs in state until save
  // fires, at which point each photo is handed to
  // `attachPhotoToMemory` and dropped from local state (the
  // confirmation card reads its thumbnails from
  // `savedPhotoUris`). Available to every tier — the existing
  // daily capture cap and cooldown are the gates.
  const [pickedPhotos, setPickedPhotos] = useState<PickedPhoto[]>([]);
  const [savedPhotoUris, setSavedPhotoUris] = useState<string[]>([]);

  // Last transcript the voice control delivered. Tracked so we can
  // tell if the user has since typed over it (Task #376).
  const [voicePromptText, setVoicePromptText] = useState<string | null>(
    null,
  );

  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const {
    addMemory,
    todayMemories,
    memories,
    deleteMemory,
    illustrateMemory,
    deleteIllustration,
    illustrationsUsedToday,
    illustrationsLimit,
    attachPhotoToMemory,
  } = useMemories();
  const { status: subscriptionStatus, freeDailyCaptureLimit } = useSubscription();
  const haptics = useHaptics();
  useCognitiveAudio("capture");

  // ---- Photo picker (Task #372) ------------------------------------------
  // Defined here (after `subscriptionStatus`/`router`/`useColors` are in
  // scope) so the picker callbacks close over the latest router. Photos
  // are NOT a Pro-only feature; the existing daily capture cap (and
  // server cooldown) is the only gate, identical to a text-only memory.

  const pickPhoto = useCallback(
    async (source: "camera" | "library") => {
      // Album cap (Task #385). Compute "slots remaining" off the
      // current `pickedPhotos` length so a multi-pick library
      // selection can't exceed MAX_PHOTOS_PER_MEMORY even if the
      // user re-opens the picker after attaching a few. Camera
      // shots are always one at a time.
      const remaining = MAX_PHOTOS_PER_MEMORY - pickedPhotos.length;
      if (remaining <= 0) return;
      try {
        if (source === "camera") {
          // Web has no camera path through expo-image-picker.
          if (Platform.OS === "web") return;
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert(
              "Memora needs the camera",
              "I can't see what you're capturing without camera access. You can turn it on in Settings whenever you're ready.",
            );
            return;
          }
          const res = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: true,
          });
          if (res.canceled || !res.assets[0]) return;
          const asset = res.assets[0];
          // Capture takenAt from the original EXIF before stripping
          // (Task #387). After `stripPhotoMetadata` re-encodes the
          // image to a fresh JPEG, GPS + camera EXIF is gone — but
          // we still want the photo's date alongside the memory, so
          // we read it here from the picker's exif blob.
          const exif = (asset.exif ?? {}) as Record<string, unknown>;
          const taken =
            (exif.DateTimeOriginal as string | undefined) ||
            (exif.DateTime as string | undefined);
          const sanitized = await stripPhotoMetadata(asset.uri);
          setPickedPhotos((prev) =>
            prev.length >= MAX_PHOTOS_PER_MEMORY
              ? prev
              : [
                  ...prev,
                  {
                    uri: sanitized.uri,
                    mimeType: sanitized.mimeType,
                    takenAt: taken ?? new Date().toISOString(),
                  },
                ],
          );
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert(
              "Memora needs your photo library",
              "I'll only pull in the pictures you pick. Turn on photo access in Settings when you're ready.",
            );
            return;
          }
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
            exif: true,
            // Bound multi-select to the open slot count so the OS
            // picker enforces the cap visibly instead of letting
            // the user pick 7 and silently dropping the overflow.
            allowsMultipleSelection: remaining > 1,
            selectionLimit: remaining,
          });
          if (res.canceled || !res.assets || res.assets.length === 0) return;
          // See Task #387 note above — read takenAt from the
          // original EXIF, then re-encode each picked asset to drop
          // GPS + camera tags before the bytes ever leave the device.
          const next: PickedPhoto[] = [];
          for (const asset of res.assets) {
            const exif = (asset.exif ?? {}) as Record<string, unknown>;
            const taken =
              (exif.DateTimeOriginal as string | undefined) ||
              (exif.DateTime as string | undefined);
            const sanitized = await stripPhotoMetadata(asset.uri);
            next.push({
              uri: sanitized.uri,
              mimeType: sanitized.mimeType,
              takenAt: taken,
            });
          }
          setPickedPhotos((prev) =>
            [...prev, ...next].slice(0, MAX_PHOTOS_PER_MEMORY),
          );
        }
      } catch (err) {
        if (__DEV__) console.warn("[capture] pickPhoto failed", err);
        // Task #387: surface the failure so the user understands why
        // the photo didn't attach. We deliberately let
        // `stripPhotoMetadata` throw rather than fall back to the raw
        // bytes — silent fallback would re-introduce the GPS leak the
        // task is here to fix. The alert keeps the rest of the
        // capture screen interactive so the user can pick a different
        // image or save the memory text-only.
        Alert.alert(
          "Couldn't attach that photo",
          "Memora had trouble preparing your picture. Try picking it again, or save the memory without a photo.",
        );
      }
    },
    [pickedPhotos.length],
  );

  const promptPickPhoto = useCallback(() => {
    if (pickedPhotos.length >= MAX_PHOTOS_PER_MEMORY) return;
    if (Platform.OS === "web") {
      void pickPhoto("library");
      return;
    }
    Alert.alert(
      "Add a photo",
      `Memora can keep up to ${MAX_PHOTOS_PER_MEMORY} pictures next to this memory.`,
      [
        { text: "Take photo", onPress: () => void pickPhoto("camera") },
        { text: "Pick from library", onPress: () => void pickPhoto("library") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [pickPhoto, pickedPhotos.length]);

  const removePickedPhoto = useCallback((uri: string) => {
    setPickedPhotos((prev) => prev.filter((p) => p.uri !== uri));
  }, []);

  const clearPickedPhotos = useCallback(() => {
    setPickedPhotos([]);
    // Clearing the album also drops the voice-derived text
    // (HEAD's Task #375 behavior). Per-photo `removePickedPhoto`
    // does not, so the transcript stays put while the user
    // reshuffles the album.
    setVoicePromptText(null);
  }, []);

  // Removing the photo also drops the voice-derived text. If the
  // user has typed over the transcript, confirm first.
  const handleClearPickedPhoto = useCallback(() => {
    if (voicePromptText && content.trim() !== voicePromptText.trim()) {
      Alert.alert(
        "Discard voice transcript?",
        "Removing the photo also clears the voice transcript you've edited. Keep the text or discard it?",
        [
          { text: "Keep text", onPress: () => clearPickedPhotos() },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              clearPickedPhotos();
              setContent("");
            },
          },
        ],
      );
      return;
    }
    if (voicePromptText) {
      setContent("");
    }
    clearPickedPhotos();
  }, [clearPickedPhotos, content, voicePromptText]);

  // Daily selfie ritual state lives next to the rest of the
  // capture-flow state; the actual handlers are declared below
  // `limitReached` since they need to read it.
  const [savingSelfie, setSavingSelfie] = useState(false);
  // On-device structured tag/theme/mood extraction (Task #195). The
  // hook is the same status machine the dev spike uses; here we only
  // care about the inline `run` return value so we can attach facets
  // to the new memory before persisting. When the device can't run
  // the model (older iOS, non-eligible hardware, Apple Intelligence
  // off, simulator) `run` resolves to `null` and the save flow
  // proceeds exactly as it did before this task.
  const facets = useMemoryFacets();

  // Draft persistence (Task #319). Load any in-progress note the
  // last session left behind so a force-kill / iOS bundle eviction
  // doesn't cost the user their text. We only restore once per
  // mount, and only when there's no confirmation card showing — a
  // restored draft mid-confirmation would be confusing.
  // `draftHydrated` flips after the first load attempt so the
  // debounced save effect doesn't write the empty initial state on
  // top of a saved draft before we've had a chance to read it.
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `draftClosedRef` is the post-clear write suppressor. Once any
  // path has fired a clear (successful save, cooldown block, cap
  // upsell, discard), we flip this to `true` so a debounce timer
  // that was already armed at the moment of clear cannot revive
  // the draft on its next tick. The hydration effect resets it on
  // a fresh mount.
  const draftClosedRef = useRef(false);

  // "Draft saved" cue state (Task #322 follow-up to #319). Flipped
  // true after each successful background write that had real content
  // to save, then auto-cleared after `DRAFT_CUE_HOLD_MS`. The cue
  // component fades the value in/out and respects reduce-motion.
  const [draftCueVisible, setDraftCueVisible] = useState(false);
  const draftCueHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // One-shot suppressor for the very first auto-save after a
  // hydration that *restored* content. Without this, restoring a
  // non-empty draft would re-run the debounce effect (state went
  // from "" → restored value), write the same blob back, and flash
  // the cue without any user interaction. Flipped on by hydration
  // when it actually loads something, consumed by the next timer.
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
    void clearDraft("capture", userId);
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
    void loadDraft("capture", userId).then((draft) => {
      if (cancelled) return;
      if (draft) {
        setContent(draft.content);
        setSelectedTags(draft.tags);
        // The next debounced write is a no-op (we just rehydrated
        // the same blob) — don't let it flash the cue. The flag
        // only suppresses the cue, not the write itself, so the
        // updatedAt stamp still refreshes if the user edits.
        skipNextCueRef.current = true;
      } else {
        // Account-switch isolation: if the new user has no draft,
        // wipe whatever the previous user had on screen so leftover
        // text doesn't leak across accounts on a hot swap.
        setContent("");
        setSelectedTags([]);
      }
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Debounced write: ~0.8s after the last keystroke / tag toggle the
  // current state lands in AsyncStorage. We deliberately re-arm the
  // timer on every change so a fast typist only writes once at the
  // end of a burst. `draftClosedRef` blocks a write from sneaking
  // through after a clear (e.g. the user hit Save before the timer
  // fired); the next genuine edit would re-mount the effect and
  // re-arm. The save call itself collapses an "everything empty"
  // state to a clear so toggling a tag back off doesn't leave a
  // phantom row behind.
  useEffect(() => {
    if (!draftHydrated || !userId) return;
    if (savedId) return; // confirmation card up — don't keep the draft alive
    if (draftClosedRef.current) return;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      if (draftClosedRef.current) return;
      // Capture the "had content?" check at the moment the timer
      // fires so the cue only flashes for writes that actually
      // persisted something. An empty body collapses to clearDraft
      // inside the helper — nothing to advertise. Tag-only changes
      // don't trigger the cue either: the brief pins it to "field
      // has content" so a chip flicker on a blank note doesn't
      // produce a misleading "saved" signal.
      const hasContent = content.trim().length > 0;
      // Consume the post-hydration suppressor regardless of
      // whether the write had content — a restored empty draft
      // wouldn't have flashed anyway, but consuming keeps the
      // flag's lifetime to "exactly the next write".
      const suppress = skipNextCueRef.current;
      skipNextCueRef.current = false;
      void saveDraft("capture", userId, {
        content,
        person: "",
        tags: selectedTags,
      }).then(() => {
        if (draftClosedRef.current) return;
        if (suppress) return;
        if (hasContent) showDraftCue();
      });
    }, 800);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [content, selectedTags, userId, draftHydrated, savedId, showDraftCue]);

  // All math + wording for the illustration meter on the
  // confirmation card lives in `getIllustrationQuotaState` so this
  // screen, the home hint, and the Archive row footer can never
  // disagree on "X of Y illustrations left today" or the
  // pluralization edge case at exactly 1 left.
  const illustrationQuota = getIllustrationQuotaState(
    illustrationsUsedToday,
    illustrationsLimit,
    subscriptionStatus?.is_pro === true,
  );
  const illustrateLimitReached = illustrationQuota.atLimit;

  // Pro is the source of truth — read from useSubscription (Task #22),
  // never AuthContext.user.is_pro which doesn't refresh after upgrade.
  // Default to false while status is loading so we err on the side of
  // enforcing the cap; once status loads, Pro users see the form again.
  // All cap math comes from `getCaptureLimitState` so this screen
  // can never disagree with the home hint or the data-layer throw.
  // `atLimit` is renamed to `limitReached` here for screen-local
  // readability — same value, just the name capture.tsx already used.
  //
  // `freeDailyCaptureLimit` (Task #144) carries the live server cap so
  // both the "X of Y left" hint and the upsell copy show on-call's
  // current value during a promotion instead of the compiled-in 10.
  const { isPro, remainingToday, atLimit: limitReached, limit } = getCaptureLimitState(
    todayMemories.length,
    subscriptionStatus?.is_pro === true,
    freeDailyCaptureLimit,
  );

  // ---- Daily selfie ritual (Task #375) -----------------------------------
  // Single-tap entry that opens the front camera, enforces one
  // selfie per local calendar day, and reuses Task #372's photo
  // pipeline (no new storage). Counts toward the existing daily
  // capture cap exactly like a typed memory does — `addMemory`
  // is the only path through which a row enters the outbox.
  //
  // Replacement is **capture-first then swap**: we never delete
  // the existing same-day selfie until the new asset is in hand.
  // If the user cancels the camera or the picker fails, the old
  // selfie stays. The replacement path also bypasses the daily
  // cap throw (the user's net row count is unchanged) so a user
  // who has hit their cap can still retake today's selfie.

  /**
   * Open the right picker for a daily selfie and return the asset.
   * - native: front camera (`cameraType: front`).
   * - web: library picker (no front-camera path through expo-image-
   *   picker on web). The asset still flows through the same
   *   addMemory + attachPhotoToMemory pipeline below, so the web
   *   user gets a real `daily-selfie` tagged memory exactly like
   *   the native one.
   * Returns `null` on cancel or permission denial; never throws.
   */
  const acquireSelfieAsset = useCallback(async (): Promise<{
    uri: string;
    mimeType?: string;
    takenAt: string;
  } | null> => {
    try {
      let res: ImagePicker.ImagePickerResult;
      if (Platform.OS === "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            "Memora needs your photo library",
            "I'll only pull in the one picture you pick. Turn on photo access in Settings when you're ready.",
          );
          return null;
        }
        res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          exif: true,
        });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            "Memora needs the camera",
            "I can't take today's selfie without camera access. Turn it on in Settings whenever you're ready.",
          );
          return null;
        }
        res = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          cameraType: ImagePicker.CameraType.front,
          quality: 0.85,
          exif: true,
        });
      }
      if (res.canceled || !res.assets[0]) return null;
      const asset = res.assets[0];
      const exif = (asset.exif ?? {}) as Record<string, unknown>;
      const takenAt =
        (exif.DateTimeOriginal as string | undefined) ||
        (exif.DateTime as string | undefined) ||
        new Date().toISOString();
      return { uri: asset.uri, mimeType: asset.mimeType, takenAt };
    } catch (err) {
      if (__DEV__) console.warn("[capture] acquireSelfieAsset failed", err);
      return null;
    }
  }, []);

  /** Persist a selfie asset as a `daily-selfie` memory and attach
   *  the photo. Caller decides whether to bypass the cap (used for
   *  the replacement flow — the old same-day selfie is deleted
   *  immediately before this runs, so the user's net count is
   *  unchanged). */
  const persistSelfie = useCallback(
    async (
      asset: { uri: string; mimeType?: string; takenAt: string },
      opts: { bypassCaptureLimit: boolean },
    ) => {
      setSavingSelfie(true);
      try {
        const result = await addMemory("Daily selfie", {
          tags: [DAILY_SELFIE_TAG],
          dailySelfieDate: getLocalDayKey(),
          bypassCaptureLimit: opts.bypassCaptureLimit,
        });
        if (result.id) {
          await attachPhotoToMemory(result.id, {
            localUri: asset.uri,
            takenAt: asset.takenAt,
            mimeType: asset.mimeType,
          });
          haptics.play("capture");
          setToastSynced(result.syncedToCloud);
          setShowToast(true);
          setTimeout(() => setShowToast(false), 1500);
        }
      } catch (err) {
        if (err instanceof CaptureLimitReachedError) {
          haptics.play("error");
          router.replace("/subscription");
          return;
        }
        if (err instanceof CaptureBlockedError) {
          haptics.play("error");
          Alert.alert(CAPTURE_COOLDOWN_ALERT_TITLE, CAPTURE_COOLDOWN_ALERT_BODY);
          return;
        }
        throw err;
      } finally {
        setSavingSelfie(false);
      }
    },
    [addMemory, attachPhotoToMemory, haptics, router],
  );

  const handleDailySelfie = useCallback(() => {
    if (savingSelfie) return;
    Haptics.selectionAsync().catch(() => {});
    const todayKey = getLocalDayKey();
    const existing = findSelfieForDay(memories, todayKey);
    if (existing) {
      // Replace prompt — one selfie per local day, so a second tap
      // is interpreted as "retake today's". Capture-first-then-swap:
      // we only delete the old row after the user has actually
      // produced a replacement asset, so a cancel preserves the
      // original selfie.
      Alert.alert(
        "Replace today's selfie?",
        "You've already added a selfie for today. Take a new one to replace it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Retake",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const asset = await acquireSelfieAsset();
                if (!asset) return; // cancelled / denied — keep old
                await deleteMemory(existing.id);
                await persistSelfie(asset, { bypassCaptureLimit: true });
              })();
            },
          },
        ],
      );
      return;
    }
    // First-of-day path: enforce the cap up front. addMemory will
    // also throw on the back end, but the early bounce keeps us
    // from opening the camera just to fail at save time.
    if (limitReached) {
      router.push("/subscription");
      return;
    }
    void (async () => {
      const asset = await acquireSelfieAsset();
      if (!asset) return;
      await persistSelfie(asset, { bypassCaptureLimit: false });
    })();
  }, [
    savingSelfie,
    memories,
    deleteMemory,
    acquireSelfieAsset,
    persistSelfie,
    limitReached,
    router,
  ]);

  const handleSave = async () => {
    if (submitting) return;
    // Photo-only captures are allowed (Task #372) — a picked photo
    // counts as enough content to save the memory. The cap still
    // applies the same way, so a photo-only save consumes one of
    // the user's daily allotment just like a text-only one.
    if ((!content.trim() && pickedPhotos.length === 0) || limitReached) return;
    setSubmitting(true);
    // MemTool's signature "capture" haptic — soft-then-firm double tap
    // — replaces the generic iOS Success notification. See
    // assets/haptics/capture.ahap.
    haptics.play("capture");
    let syncedToCloud = true;
    let savedResult: { syncedToCloud: boolean; id: string | null } | null = null;
    const trimmed = content.trim();
    // Run on-device facet extraction BEFORE the addMemory call so
    // the new row lands in the AsyncStorage cache with facets
    // already attached — no second write, no flicker. The hook
    // returns `null` whenever the device can't run the model (the
    // exact "fall back silently" requirement of Task #195), in
    // which case `addMemory` simply omits the field. We deliberately
    // await rather than fire-and-forget so the user's saved row is
    // immediately self-describing if facets are available; the
    // typical on-device latency is well under the perceptual
    // threshold for "tap save → see toast".
    let extractedFacets: Awaited<ReturnType<typeof facets.run>> = null;
    if (facets.availability.available) {
      try {
        extractedFacets = await facets.run(trimmed);
      } catch {
        // Defensive: useMemoryFacets already swallows native errors
        // into the `error` state, but a future refactor could let
        // them throw. Save flow MUST NOT fail because facet
        // extraction did.
        extractedFacets = null;
      }
    }
    try {
      savedResult = await addMemory(trimmed, {
        tags: selectedTags,
        facets: extractedFacets ?? undefined,
      });
      syncedToCloud = savedResult.syncedToCloud;
    } catch (err) {
      // Layer 2 catch-net for the case where local UI state thinks
      // we're under the cap but MemoriesContext (Layer 3) sees the
      // current memories list and disagrees (e.g. another open
      // surface saved a memory in between). Route to the upsell
      // instead of crashing — anything else re-throws to the error
      // boundary so real bugs aren't silently swallowed.
      if (err instanceof CaptureLimitReachedError) {
        haptics.play("error");
        // Cap-block routes the user away — drop the draft so the
        // next visit starts fresh (per task brief).
        closeDraft();
        router.replace("/subscription");
        return;
      }
      // Server-side auto-block (cap-bypass abuse pattern detected).
      // This is NOT an upsell case — there's no Pro plan to sell our
      // way out of it; the account is locked out until UTC midnight.
      // Show a calm, dedicated cooldown alert so the user understands
      // why the capture didn't go through, then leave them on the
      // screen instead of routing anywhere.
      if (err instanceof CaptureBlockedError) {
        haptics.play("error");
        // Per Task #319 brief: cooldown block also clears the draft so
        // it doesn't reappear on the next visit. The in-memory text
        // stays in the field for now so the user can still see what
        // was rejected, but a background → relaunch starts fresh.
        closeDraft();
        Alert.alert(CAPTURE_COOLDOWN_ALERT_TITLE, CAPTURE_COOLDOWN_ALERT_BODY);
        // Stay on the screen — clear the submitting flag so the user
        // can edit their note (e.g. trim it down) without the form
        // staying visually disabled.
        setSubmitting(false);
        return;
      }
      throw err;
    }
    // Successful save — drop the persisted draft so the next visit
    // doesn't restore an already-captured note.
    closeDraft();
    setToastSynced(syncedToCloud);
    setShowToast(true);
    // Hold the saved text + id so the confirmation card can render
    // and offer Illustrate. The form's local input is cleared so the
    // user can capture another memory by tapping "New" without seeing
    // last memory's text linger in the box.
    const savedText = trimmed;
    setSavedContent(savedText);
    setSavedId(savedResult?.id ?? null);
    setSavedIllustrationUrl(null);
    setSavedIllustrationThumbUrl(null);
    // Attach the user-picked photo (Task #372). The queue handles
    // offline + retry; we keep the local URI on the confirmation
    // card so the user sees their photo immediately, even before
    // the server confirms.
    if (pickedPhotos.length > 0 && savedResult?.id) {
      setSavedPhotoUris(pickedPhotos.map((p) => p.uri));
      // Enqueue each photo independently. The queue mints a stable
      // photoId per entry so retries dedupe via the composite PK
      // and don't blow the per-memory cap.
      for (const p of pickedPhotos) {
        void attachPhotoToMemory(savedResult.id, {
          localUri: p.uri,
          takenAt: p.takenAt,
          mimeType: p.mimeType,
        });
      }
    } else {
      setSavedPhotoUris([]);
    }
    clearPickedPhotos();
    setContent("");
    setSelectedTags([]);
    // Auto-hide just the toast (the confirmation card stays visible
    // until the user explicitly hits Done or Illustrate). Removing
    // the auto-back here is intentional — Task #184 asks the capture
    // flow to give the user a moment to optionally illustrate.
    setTimeout(() => {
      setShowToast(false);
    }, 1500);
  };

  const handleIllustrateSaved = async () => {
    if (!savedId || illustrating) return;
    if (illustrateLimitReached) {
      router.push("/subscription");
      return;
    }
    setIllustrating(true);
    setIllustrateError(null);
    try {
      const result = await illustrateMemory(savedId);
      if (result.kind === "ok") {
        setSavedIllustrationUrl(result.url);
        setSavedIllustrationThumbUrl(result.thumbUrl ?? null);
      } else if (result.kind === "limit") {
        setIllustrateError(ILLUSTRATION_OUT_INLINE);
        setTimeout(() => router.push("/subscription"), 400);
      } else if (result.kind === "auth_error") {
        setIllustrateError("Please sign in again");
      } else {
        setIllustrateError("Couldn't illustrate — try again");
      }
    } finally {
      setIllustrating(false);
    }
  };

  // Regenerate the just-shown polaroid (Task #210). Reuses the
  // illustrate path so the server's quota gate fires identically;
  // a free user that's just used their slot gets bumped to the
  // paywall. While in-flight, swap the polaroid back to the
  // painting loader for consistency with the initial generate.
  const handleRegenerateSaved = async () => {
    if (!savedId || illustrating) return;
    if (illustrateLimitReached) {
      router.push("/subscription");
      return;
    }
    setIllustrating(true);
    setIllustrateError(null);
    setSavedIllustrationUrl(null);
    try {
      const result = await illustrateMemory(savedId);
      if (result.kind === "ok") {
        setSavedIllustrationUrl(result.url);
      } else if (result.kind === "limit") {
        setIllustrateError(ILLUSTRATION_OUT_INLINE);
        setTimeout(() => router.push("/subscription"), 400);
      } else if (result.kind === "auth_error") {
        setIllustrateError("Please sign in again");
      } else {
        setIllustrateError("Couldn't regenerate — try again");
      }
    } finally {
      setIllustrating(false);
    }
  };

  // Remove the just-shown polaroid (Task #210). The lightbox
  // already showed a confirm dialog before this fires. On success
  // we also clear the local `savedIllustrationUrl` so the screen
  // swaps the polaroid for the original "Illustrate" button —
  // mirroring how Archive's row recovers when the polaroid is
  // dropped. The illustration slot is intentionally not refunded
  // (see `deleteIllustration` in MemoriesContext).
  const handleRemoveSaved = async () => {
    if (!savedId) return;
    const result = await deleteIllustration(savedId);
    if (result.kind === "ok") {
      setSavedIllustrationUrl(null);
      setIllustrateError(null);
    } else if (result.kind === "auth_error") {
      setIllustrateError("Please sign in again");
    } else {
      setIllustrateError("Couldn't remove — try again");
    }
  };

  const handleNewCapture = () => {
    // Reset the confirmation state so the form re-renders empty for
    // a fresh capture. We deliberately don't navigate away — the
    // user explicitly asked to keep capturing.
    setSavedId(null);
    setSavedContent("");
    setSavedIllustrationUrl(null);
    setSavedIllustrationThumbUrl(null);
    setSavedPhotoUris([]);
    setIllustrating(false);
    setIllustrateError(null);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            // Explicit discard: dropping the draft so reopening the
            // screen starts fresh. If the user just hit Done after a
            // confirmation card the draft was already cleared on save;
            // calling clear again is a harmless no-op.
            closeDraft();
            router.back();
          }}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Discard capture"
        >
          <Ionicons name="close" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Capture</Text>
        {/* ScalePress now forwards `style` onto its inner Pressable
            (see components/alive/ScalePress.tsx) so the touch
            target matches the visible padded saveButton surface.
            The outer Animated.View only carries the scale
            transform. */}
        <ScalePress
          onPress={() => handleSave()}
          style={[styles.saveButton, ((!content.trim() && pickedPhotos.length === 0) || limitReached || submitting) && { opacity: 0.5 }]}
          disabled={(!content.trim() && pickedPhotos.length === 0) || limitReached || submitting}
          accessibilityLabel="Save this memory"
        >
          <Text style={[styles.saveText, { color: colors.primary }]}>{submitting ? "Saving…" : "Save"}</Text>
        </ScalePress>
      </View>
      <DraftSavedCue visible={draftCueVisible} topOffset={insets.top + 64} />

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {savedId ? (
          // Post-save confirmation card. The user lands here after a
          // successful capture; the form below is hidden so the
          // moment isn't immediately interrupted by a fresh blank
          // input. They can illustrate the memory, capture another,
          // or close — all three are explicit choices.
          //
          // Wrapped in SettleOnMount so the card lands with the same
          // gentle ~3px settle the rest of the alive surfaces use,
          // making the "Saved" moment feel arrived-at instead of
          // popping in (Mercury motion sweep, Task #401).
          <SettleOnMount
            style={[
              styles.confirmCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.confirmHeader}>
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.primary}
              />
              <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
                Saved
              </Text>
            </View>
            <Text
              style={[styles.confirmBody, { color: colors.mutedForeground }]}
              numberOfLines={6}
            >
              {savedContent}
            </Text>

            {savedPhotoUris.length > 0 ? (
              <View style={styles.confirmPhotoWrap}>
                {savedPhotoUris.length === 1 ? (
                  <Image
                    source={{ uri: savedPhotoUris[0] }}
                    style={styles.confirmPhoto}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  // Multi-photo (Task #385): show every picked
                  // photo as a smaller thumb in a horizontal row
                  // so the user immediately sees their full album
                  // landed. Wraps if more than fits on one line.
                  <View style={styles.confirmPhotoStrip}>
                    {savedPhotoUris.map((uri) => (
                      <Image
                        key={uri}
                        source={{ uri }}
                        style={styles.confirmPhotoStripThumb}
                        contentFit="cover"
                        transition={150}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            {savedIllustrationUrl ? (
              <View style={styles.confirmPolaroid}>
                <IllustrationPolaroid
                  imageUrl={savedIllustrationUrl}
                  thumbUrl={savedIllustrationThumbUrl ?? undefined}
                  caption={savedContent}
                  size={200}
                  onRegenerate={() => {
                    void handleRegenerateSaved();
                  }}
                  onRemove={() => {
                    void handleRemoveSaved();
                  }}
                  actionsBusy={illustrating}
                />
              </View>
            ) : illustrating ? (
              <View style={styles.confirmLoader}>
                <IllustrationLoader size={88} />
              </View>
            ) : (
              <View style={styles.confirmActionsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    illustrateLimitReached
                      ? "Upgrade to illustrate more memories"
                      : "Illustrate this memory"
                  }
                  onPress={() => {
                    void handleIllustrateSaved();
                  }}
                  style={({ pressed }) => [
                    styles.confirmIllustrateBtn,
                    {
                      backgroundColor: illustrateLimitReached
                        ? "transparent"
                        : colors.primary,
                      borderColor: illustrateLimitReached
                        ? colors.border
                        : colors.primary,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={illustrateLimitReached ? "lock-closed" : "sparkles"}
                    size={16}
                    color={
                      illustrateLimitReached
                        ? colors.mutedForeground
                        : colors.primaryForeground
                    }
                  />
                  <Text
                    style={[
                      styles.confirmIllustrateText,
                      {
                        color: illustrateLimitReached
                          ? colors.mutedForeground
                          : colors.primaryForeground,
                      },
                    ]}
                  >
                    {illustrateLimitReached ? "Upgrade for more" : "Illustrate"}
                  </Text>
                </Pressable>
              </View>
            )}

            {illustrationQuota.visible && !savedIllustrationUrl && !illustrating ? (
              <Text
                style={[styles.confirmMeter, { color: colors.mutedForeground }]}
              >
                {illustrationQuota.label}
              </Text>
            ) : null}
            {illustrateError ? (
              <Text style={[styles.confirmError, { color: colors.destructive }]}>
                {illustrateError}
              </Text>
            ) : null}

            <View style={styles.confirmFooter}>
              <Pressable
                onPress={handleNewCapture}
                style={({ pressed }) => [
                  styles.confirmSecondaryBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Capture another memory"
              >
                <Ionicons name="add" size={16} color={colors.foreground} />
                <Text
                  style={[styles.confirmSecondaryText, { color: colors.foreground }]}
                >
                  New
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.confirmDoneBtn,
                  {
                    backgroundColor: savedIllustrationUrl
                      ? colors.primary
                      : "transparent",
                    borderColor: colors.primary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <Text
                  style={[
                    styles.confirmDoneText,
                    {
                      color: savedIllustrationUrl
                        ? colors.primaryForeground
                        : colors.primary,
                    },
                  ]}
                >
                  Done
                </Text>
              </Pressable>
            </View>
          </SettleOnMount>
        ) : limitReached ? (
          // Replace the form entirely once the daily cap is hit so the
          // user can't tap Save and silently fail. The card deep-links
          // to /subscription via ProUpsellCard.
          <ProUpsellCard
            icon="infinite-outline"
            title="Daily capture limit reached"
            body={`You've captured ${limit} memories today on the free plan. Upgrade to MemTool Pro to capture unlimited memories every day.`}
          />
        ) : (
          <>
            {!isPro && (
              <View
                style={[
                  styles.usageBanner,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="hourglass-outline"
                  size={16}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.usageText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {remainingToday} of {limit} memories left
                  today on the free plan
                </Text>
              </View>
            )}

            {/*
              Small thoughtful Mem above the form (Task #340). She's
              decorative — `pointerEvents="none"` so she never steals
              taps from the input — and reads as "I'm listening"
              while you compose. Sized small so the input stays the
              hero of the screen.
            */}
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.memListening}
            >
              <MemCharacter
                size={64}
                expression={MEM_STATES.thoughtful.expression}
              />
              <Text style={[styles.memListeningHint, { color: colors.mutedForeground }]}>
                I'm listening.
              </Text>
            </View>

            {/*
              "Speak a memory" entry point (Task #171). Lives on the
              same screen as the typed-capture form so the user has
              both modes one tap apart, but routes to the dedicated
              voice-capture modal so the recording UI gets its own
              full-screen surface (mic button, timer, draft form).
              The voice screen reuses the same daily-cap math and
              memory-create pipeline as this typed flow.
            */}
            <ScalePress
              onPress={() => {
                Haptics.selectionAsync();
                // Cast required because the typed-routes manifest is
                // regenerated by `expo start` and may lag a fresh
                // route file on a clean checkout. Same `as any`
                // pattern the home screen's `handleNavigate` uses.
                router.push("/voice-capture" as never);
              }}
              style={[
                styles.voiceEntry,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              accessibilityLabel="Speak a memory instead of typing"
            >
              <Ionicons
                name="mic-outline"
                size={20}
                color={colors.primary}
              />
              <View style={styles.voiceEntryText}>
                <Text
                  style={[styles.voiceEntryTitle, { color: colors.foreground }]}
                >
                  Speak instead
                </Text>
                <Text
                  style={[
                    styles.voiceEntrySub,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Hold the mic, ramble for up to a minute, get an editable draft
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.mutedForeground}
              />
            </ScalePress>

            {/* Daily selfie ritual (Task #375). One tap → front
                camera → memory tagged `daily-selfie` for the local
                day. The handler enforces the one-per-day rule with
                a replace prompt. */}
            <ScalePress
              onPress={handleDailySelfie}
              disabled={savingSelfie}
              style={[
                styles.voiceEntry,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: savingSelfie ? 0.6 : 1,
                },
              ]}
              accessibilityLabel="Add today's daily selfie"
            >
              <Ionicons
                name="happy-outline"
                size={20}
                color={colors.primary}
              />
              <View style={styles.voiceEntryText}>
                <Text
                  style={[styles.voiceEntryTitle, { color: colors.foreground }]}
                >
                  {savingSelfie ? "Saving selfie…" : "Daily selfie"}
                </Text>
                <Text
                  style={[
                    styles.voiceEntrySub,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {(() => {
                    const todayKey = getLocalDayKey();
                    const streak = computeSelfieStreak(memories, todayKey);
                    const milestone = selfieStreakMilestone(streak);
                    if (streak.todayCaptured) {
                      if (milestone !== null) {
                        return selfieStreakMilestoneCopy(milestone).title;
                      }
                      if (streak.current >= 1) {
                        return `Day ${streak.current} of your selfie streak — tap to retake.`;
                      }
                      return "You've already added today's — tap to retake.";
                    }
                    const nudge = selfieLateDayNudge(
                      streak,
                      new Date().getHours(),
                    );
                    if (nudge !== null) return nudge;
                    if (streak.current >= 1) {
                      return `Day ${streak.current} streak — capture today's to keep it going.`;
                    }
                    return "Open the front camera and capture today's face.";
                  })()}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.mutedForeground}
              />
            </ScalePress>

            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoFocus
              value={content}
              onChangeText={setContent}
              textAlignVertical="top"
              // Cap input at the shared MEMORY_CONTENT_MAX_LENGTH
              // (5,000 chars). RN's TextInput truncates a paste at
              // this length too, so a user pasting an article hits
              // the cap visibly instead of silently corrupting the
              // outbox / failing on the server's embed limit.
              maxLength={MEMORY_CONTENT_MAX_LENGTH}
            />
            {/* Photo picker (Task #372). Available to every tier —
                the existing daily capture cap is the only gate. Once
                a photo is picked we show a small thumbnail with a
                clear button. */}
            <View style={styles.photoRow}>
              {pickedPhotos.length > 0 ? (
                // Multi-photo strip (Task #385). Each picked photo
                // gets its own thumbnail with an inline remove
                // button. The "Add photo" affordance stays visible
                // until the album hits MAX_PHOTOS_PER_MEMORY so
                // the user can keep appending without re-opening
                // the screen. The whole-album clear (HEAD's
                // handleClearPickedPhoto, which also drops the
                // voice transcript) is wired to the per-tile
                // remove via clearPickedPhotos when the last photo
                // comes off.
                <View style={styles.photoStrip}>
                  {pickedPhotos.map((p) => (
                    <View key={p.uri} style={styles.photoPreviewWrap}>
                      <Image
                        source={{ uri: p.uri }}
                        style={styles.photoPreview}
                        contentFit="cover"
                        transition={120}
                      />
                      <Pressable
                        onPress={() =>
                          pickedPhotos.length === 1
                            ? handleClearPickedPhoto()
                            : removePickedPhoto(p.uri)
                        }
                        style={[
                          styles.photoClearBtn,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Remove attached photo"
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={14} color={colors.foreground} />
                      </Pressable>
                    </View>
                  ))}
                  {pickedPhotos.length < MAX_PHOTOS_PER_MEMORY ? (
                    <Pressable
                      onPress={promptPickPhoto}
                      style={({ pressed }) => [
                        styles.photoAddTile,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.card,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add another photo (${pickedPhotos.length} of ${MAX_PHOTOS_PER_MEMORY})`}
                    >
                      <Ionicons
                        name="add"
                        size={22}
                        color={colors.primary}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Pressable
                  onPress={promptPickPhoto}
                  style={({ pressed }) => [
                    styles.photoAddBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo to this memory"
                >
                  <Ionicons
                    name="image-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.photoAddText,
                      { color: colors.foreground },
                    ]}
                  >
                    Add photo
                  </Text>
                </Pressable>
              )}
            </View>

            {pickedPhotoUri ? (
              <VoicePromptControl
                disabled={limitReached}
                onTranscript={({ text: transcriptText }) => {
                  setContent(transcriptText);
                  setVoicePromptText(transcriptText);
                }}
              />
            ) : null}

            {content.length >= MEMORY_CONTENT_MAX_LENGTH ? (
              <Text style={[styles.lengthHint, { color: colors.mutedForeground }]}>
                You've reached the {MEMORY_CONTENT_MAX_LENGTH.toLocaleString()}-character limit for one memory.
              </Text>
            ) : null}

            <View style={styles.tagContainer}>
              {SUGGESTED_TAGS_POOL.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[
                    styles.tagChip,
                    { borderColor: colors.border },
                    selectedTags.includes(tag) && { backgroundColor: colors.primary, borderColor: colors.primary }
                  ]}
                  onPress={() => toggleTag(tag)}
                >
                  <Text style={[
                    styles.tagText,
                    { color: colors.foreground },
                    selectedTags.includes(tag) && { color: colors.primaryForeground }
                  ]}>
                    #{tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <Toast
        message={toastSynced ? "Captured!" : "Saved offline — will sync when reconnected"}
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
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    borderBottomWidth: 1,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...text.cardLabel },
  saveButton: { padding: spacing.xs, paddingHorizontal: spacing.sm },
  saveText: {
    ...text.body,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  scrollContent: { padding: spacing.lg, paddingBottom: 100, flexGrow: 1 },
  usageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  usageText: {
    ...text.caption,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  voiceEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  voiceEntryText: { flex: 1 },
  voiceEntryTitle: {
    ...text.body,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  voiceEntrySub: {
    ...text.caption,
  },
  memListening: {
    alignItems: "center",
    gap: 4,
    marginBottom: spacing.base,
  },
  memListeningHint: {
    ...text.caption,
  },
  input: {
    fontSize: 20,
    fontFamily: "Inter_400Regular",
    fontWeight: "400",
    lineHeight: 28,
    minHeight: 150,
    marginBottom: 20,
  },
  lengthHint: {
    ...text.helperRegular,
    marginTop: -spacing.base,
    marginBottom: spacing.base,
  },
  suggestingText: {
    ...text.helperRegular,
    marginBottom: spacing.sm,
    fontStyle: "italic",
  },
  tagContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tagChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 14,
    fontWeight: "500",
  },
  eventPrompt: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  eventSub: {
    fontSize: 13,
  },
  calendarAddBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: spacing.sm,
  },
  calendarAddText: {
    fontSize: 14,
    fontWeight: "700",
  },
  confirmCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  confirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  confirmTitle: {
    ...text.cardHeading,
  },
  confirmBody: {
    ...text.body,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  confirmActionsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  confirmIllustrateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  confirmIllustrateText: {
    ...text.bodySemibold,
  },
  confirmLoader: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  confirmPolaroid: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  confirmPhotoWrap: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  confirmPhoto: {
    width: 200,
    height: 200,
    borderRadius: radius.md,
  },
  confirmPhotoStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmPhotoStripThumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
  },
  photoStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  photoAddTile: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  photoRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  photoAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  photoAddText: {
    ...text.bodySemibold,
  },
  photoPreviewWrap: {
    alignSelf: "flex-start",
    position: "relative",
  },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: radius.md,
  },
  photoClearBtn: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmMeter: {
    ...text.caption,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  confirmError: {
    ...text.caption,
    textAlign: "center",
    marginBottom: spacing.md,
    fontWeight: "500",
  },
  confirmFooter: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  confirmSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  confirmSecondaryText: {
    ...text.bodyMedium,
  },
  confirmDoneBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  confirmDoneText: {
    ...text.bodySemibold,
  },
});
