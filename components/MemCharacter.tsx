/**
 * Legacy module — the yellow-blob `MemCharacter` has been replaced
 * by the photo-real `Memora` component (Task #334). This file is
 * kept as a thin alias so every existing call site (chat bubble
 * avatar, onboarding capture/train/reflect stages, AI Guide stage,
 * level-result overlay, brand docs, jest mocks targeting
 * `@/components/MemCharacter`) keeps working without a coordinated
 * rename.
 *
 * The richer companion-state expression vocabulary added on `main`
 * (Task #340 — `curious`, `resting`, `thoughtful`, `celebrating`,
 * `waiting`, `concerned`, `glowing`) is preserved by extending
 * `MemExpression` inside `Memora.tsx`; callers that pass
 * `expression="curious"` continue to typecheck and render via the
 * mapped sprite.
 */
export { Memora as MemCharacter, type MemExpression } from "./Memora";
