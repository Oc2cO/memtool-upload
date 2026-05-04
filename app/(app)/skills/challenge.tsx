import React, { useEffect, useMemo } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  decodeChallengeUrl,
  decodeChallengePayload,
  type ChallengePayload,
} from "@/lib/skillChallenge";
import { getSkill } from "@/lib/skillsBundle";
import { trackEvent } from "@/lib/analytics";

/**
 * Friend-challenge deep-link receiver (Task #337).
 *
 * Resolves `memtool://skills/challenge?p=...` (and the universal
 * link equivalent) to the matching game screen, passing the
 * sender's seed/score so the round mirrors theirs and the end-of-
 * round overlay can show "you scored N vs their M". The single
 * free round per challenge — even for users who don't own the skill
 * — is enforced by the game route via the `?challenge=1` flag.
 */
export default function ChallengeRouterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ p?: string; url?: string }>();

  const payload: ChallengePayload | null = useMemo(() => {
    if (typeof params.p === "string" && params.p.length > 0) {
      return decodeChallengePayload(params.p);
    }
    if (typeof params.url === "string" && params.url.length > 0) {
      return decodeChallengeUrl(params.url);
    }
    return null;
  }, [params.p, params.url]);

  useEffect(() => {
    if (!payload) {
      Alert.alert(
        "Challenge link looks invalid",
        "The friend who sent this may need to share it again.",
        [{ text: "OK", onPress: () => router.replace("/skills") }],
      );
      return;
    }
    trackEvent("challenge_accepted", {
      skillId: payload.skillId,
      senderScore: payload.senderScore,
    });
    const skill = getSkill(payload.skillId);
    router.replace({
      pathname: skill.route,
      params: {
        challenge: "1",
        seed: String(payload.seed),
        senderName: payload.senderName,
        senderScore: String(payload.senderScore),
      },
    });
  }, [payload, router]);

  return null;
}
