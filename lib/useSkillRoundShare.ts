import { useCallback } from "react";
import { Alert, Share } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { trackEvent } from "./analytics";
import {
  buildChallengeShareText,
  buildChallengeUrl,
} from "./skillChallenge";
import type { SkillId } from "./skillsBundle";

/**
 * Hook returning a function that opens the OS share sheet with a
 * pre-filled friend-challenge link (Task #337). Centralised here so
 * every game route shares the exact same link/text format and
 * analytics shape.
 */
export function useSkillRoundShare(): (input: {
  skillId: SkillId;
  skillTitle: string;
  seed: number;
  score: number;
}) => Promise<void> {
  const { user } = useAuth();
  const senderName =
    user?.display_name?.trim() || user?.email?.trim() || "A friend";
  return useCallback(
    async ({ skillId, skillTitle, seed, score }) => {
      const url = buildChallengeUrl({
        skillId,
        seed,
        senderName,
        senderScore: score,
        sentAt: Date.now(),
      });
      const message = buildChallengeShareText({
        skillTitle,
        senderName,
        senderScore: score,
        url,
      });
      trackEvent("challenge_sent", { skillId, score });
      try {
        await Share.share({ message, url });
      } catch (err) {
        if (__DEV__) console.log("[skillShare] failed", err);
        Alert.alert("Couldn't open share sheet", "Try again in a moment.");
      }
    },
    [senderName],
  );
}
