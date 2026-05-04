// Wires the pure mapper to the generated UserProfileTrait runtime
// enum so the closed trait set has a single source.
import {
  UserProfileTrait,
  type UserProfileInput,
} from "@workspace/api-client-react";

import {
  buildProfileFromAnswersCore,
  FOCUS_AREA_CHAR_MAX,
  FOCUS_AREA_MAX,
  TRAITS_MAX,
} from "./profileMapperCore";

export const ALLOWED_TRAIT_VALUES: readonly UserProfileTrait[] =
  Object.values(UserProfileTrait) as UserProfileTrait[];

export const ALLOWED_TRAIT_SET: ReadonlySet<UserProfileTrait> = new Set(
  ALLOWED_TRAIT_VALUES,
);

export { FOCUS_AREA_CHAR_MAX, FOCUS_AREA_MAX, TRAITS_MAX };

export function buildProfileFromAnswers(
  selectedTraits: readonly unknown[],
  freeTextAnswers: readonly unknown[],
): UserProfileInput {
  return buildProfileFromAnswersCore<UserProfileTrait>(
    ALLOWED_TRAIT_SET,
    selectedTraits,
    freeTextAnswers,
  );
}
