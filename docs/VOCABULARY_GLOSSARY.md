# MemTool Vocabulary Glossary

**Status:** canonical for all user-facing copy in `artifacts/memtool/app/` and `artifacts/memtool/components/`.
**Background:** the [Round 1 audit](./PRELAUNCH_AUDIT_ROUND_1.md) found the app referred to a stored item by five different words (*memory*, *capture*, *moment*, *log*, *entry*). This doc locks the vocabulary so every screen feels like one product.

## The two words that matter

| Role | Canonical word | Use it as |
|---|---|---|
| Noun for a stored item | **memory** | "your memories", "Recent memories", "X memories left today", "No memories on Apr 14" |
| Verb for the act of saving one | **capture** | "Capture a memory", "captured 3 memories today", "Daily capture limit reached", "Upgrade to capture unlimited memories" |

That's it. Everywhere we used to say *capture* (noun), *moment*, *log*, *entry*, or *thought* for a stored item, say **memory**. Everywhere we used to say *log* or *save* for the action, say **capture**. This applies to **every** user-facing string: visible copy, button labels, placeholders, accessibility labels, accessibility hints, and even decorative on-screen words (e.g. the onboarding `ThoughtBubbles` floating words).

## Approved variations

These are the only places a different word is allowed.

- **call** — noun for the call-log subtype of memory. A user "logs a call" and the toast says "Call logged" because the user mental-models a call as a call, not a generic memory. The screen is titled **Log a Call**. Counters about calls roll up into "memories" (e.g. the daily-cap upsell on the Log-a-Call screen still reads "captured X memories today" because cap math is shared with capture.tsx).
- **thoughts** (plural) — allowed only inside marketing pain-point statements that describe what gets lost in your head, **not** the noun for a stored item. Currently this means exactly one string: the subscription hero headline `"Stop losing your thoughts. Start understanding yourself."` Do not introduce new uses.
- **MemTool product names** stay as-is: **Mem noticed…**, **Memory Match**, **Daily Recap**, **Daily Boost Archive**, **Capture** (screen title), **Log a Call** (screen title), **Speak a memory** (Voice Capture entry point).

## Not allowed in user-facing copy

- *capture* / *captures* as a **noun** for a stored item. Use **memory** / **memories**.
  - Wrong: "Recent captures", "View all captures", "3 of 10 captures left", "your captures", "month of captures".
  - Right: "Recent memories", "View all memories", "3 of 10 memories left", "your memories", "month of memories".
- *moment* / *moments* as the noun for a stored item. Use **memory** / **memories**.
  - Wrong: "Log as many moments as you want."
  - Right: "Capture as many memories as you want."
- *entry* / *entries* as the noun for a stored item. Use **memory** / **memories**.
  - Wrong: "logged 10 entries today".
  - Right: "captured 10 memories today".
- *log* as a verb for saving a memory, except in the dedicated call-log screen ("Log a Call", "Call logged"). Use **capture**.
- "Mem noticed" stays as the card name. Don't add new uses of *noticed* for stored items.

## Rule of thumb when adding a new screen

1. Naming a saved thing → **memory** / **memories**.
2. Naming the action of saving one → **capture** (verb), **Capture** (button).
3. Counter copy → `"X of Y memories left today"`, `"3 memories so far"`, `"1 memory couldn't sync"` (already the convention from the Round-1 reference).
4. Empty states → `"No memories …"` / `"Capture your first memory …"`.
5. Cooldown / cap copy → "captured X memories today" / "paused new memories".
6. Subscription marketing → memories (noun) + capture (verb). No "moments".

If you find yourself reaching for a sixth word, add it here first.
