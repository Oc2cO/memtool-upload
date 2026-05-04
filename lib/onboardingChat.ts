// Declarative onboarding chat script. Free-text answers go to
// focus_areas; chip selections go to traits. Mapping is enforced in
// `lib/profileMapper.ts:buildProfileFromAnswers`. Chip options come
// from the generated `UserProfileTrait` runtime enum so the closed
// set has a single source.
import { UserProfileTrait } from "@workspace/api-client-react";

import { ALLOWED_TRAIT_VALUES } from "./profileMapper";

export interface MemSay {
  kind: "mem-say";
  id: string;
  text: string;
}

export interface AskFreeText {
  kind: "ask-free-text";
  id: string;
  prompt: string;
  placeholder?: string;
  skippable: boolean;
}

export interface AskTraits {
  kind: "ask-traits";
  id: string;
  prompt: string;
  options: readonly UserProfileTrait[];
  min: number;
  max: number;
  skippable: boolean;
}

export type Turn = MemSay | AskFreeText | AskTraits;

// Locked celebration: total duration is exactly CELEBRATION.durationMs.
// All beats (scale, opacity, bg color shift + return) complete inside
// this single window. There is no extra animated hold.
export const CELEBRATION = {
  message: "Got it. I'll learn the rest as we go.",
  durationMs: 350,
} as const;

export const SKIP_ALL_LABEL = "Skip — Mem will learn as we go";

export const ONBOARDING_SCRIPT: readonly Turn[] = [
  {
    kind: "mem-say",
    id: "hello",
    text: "Hi, I'm Mem.",
  },
  {
    kind: "mem-say",
    id: "intro",
    text: "I'll help you keep the small things — names, memories, ideas. Mind if I ask a couple of questions so I get a feel for you?",
  },
  {
    kind: "ask-free-text",
    id: "good-thing",
    prompt: "What's something good that happened lately, big or small?",
    placeholder: "a memory, a person, a feeling…",
    skippable: true,
  },
  {
    kind: "ask-traits",
    id: "vibe",
    prompt: "Pick the words that feel like you. (a few is plenty)",
    options: ALLOWED_TRAIT_VALUES,
    min: 0,
    max: 4,
    skippable: true,
  },
  {
    kind: "mem-say",
    id: "noted-vibe",
    text: "Noted. I'll keep this in mind when we look back at your week.",
  },
  {
    kind: "ask-free-text",
    id: "remember-more",
    prompt: "One last thing — what's something you'd like to remember more often?",
    placeholder: "a habit, a person, an intention…",
    skippable: true,
  },
  {
    kind: "mem-say",
    id: "wrap",
    text: "Lovely. That's enough to get us started.",
  },
] as const;
