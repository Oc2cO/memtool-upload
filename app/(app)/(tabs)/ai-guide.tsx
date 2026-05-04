/**
 * Tab route file for the "Mem" chat surface.
 *
 * The screen implementation lives at `app/(app)/ai-guide.tsx` so it
 * can be deep-linked outside of the tab bar (e.g. from a future
 * push-notification handler or a Settings shortcut). This file is a
 * thin re-export so adding/removing the tab is a one-file change in
 * `_layout.tsx` without touching the screen.
 */
export { default } from "../ai-guide";
