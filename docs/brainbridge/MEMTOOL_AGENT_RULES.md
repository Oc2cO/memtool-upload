# MEMTOOL AGENT RULES

These rules apply to GPT, Codex, future chats, and future agents working in this repo.

## Before Acting

Every agent must run the ENTER GATE in:

```text
docs/brainbridge/MEMTOOL_WORKFLOW.md
```

Read local active context when available:

```text
.agent_sync/ACTIVE_AGENT_SYNC_BOARD.md
.agent_sync/MEMTOOL_HOME_ATRIUM_SOT.md
.agent_sync/MEMTOOL_MASTER_BRAIN_BLOCK.md
```

Use the shared durable hub:

```text
docs/brainbridge/
```

Run scopecheck:

```powershell
git status --short --branch
git log -1 --oneline
```

Do not rely on chat memory alone.

## Source Of Truth Rules

- Repo/Git/GitHub are technical truth.
- `docs/brainbridge` is shared durable project context.
- `.agent_sync` is the local active board and may be more immediate than committed docs.
- File Library/uploads are the evidence vault.
- Canvas first for drafting shared plans, summaries, and context blocks.
- Do not trust old chat without current proof.
- Do not rely on chat memory alone.
- Use `MEMTOOL_BRAIN_HUB_CURATION.md` before changing durable truth.
- Do not blindly append new truth if it contradicts existing Brain Hub files.

## Hard No-Touch Rules

- Do not run EAS build unless Steve explicitly approves.
- Do not spend build credits unless Steve explicitly approves.
- Do not use Replit assumptions.
- Do not use Notepad workflow.
- Do not use `git add .`.
- Do not make mixed-lane edits.
- Do not make broad mixed-lane patches.
- Do not replace/delete/recreate files to make small edits.
- Do not touch native/prebuild/build config unless Steve opens that lane.
- Do not touch Voice Capture during Home lanes unless compile safety requires it.
- Do not touch splash or intro unless Steve opens that lane.
- Do not redesign MeMChat internals during Home lane.
- Do not commit, push, or stage unless Steve explicitly approves.

## Editing Rules

- Keep patches controlled and in-place.
- Preserve routes, state hooks, accessibility labels, and app behavior unless the lane explicitly changes them.
- Use existing components and dependencies whenever possible.
- Avoid new dependencies unless Steve explicitly opens that work.
- Validate with the requested command set for the lane.
- Report exact files changed, validation output, and whether a commit is recommended.
- Search relevant Brain Hub docs for conflicting lane, commit, no-touch, source-of-truth, image, or asset statements before editing durable docs.
- Mark stale entries `SUPERSEDED`, `PARKED`, `HISTORY ONLY`, `NEEDS PROOF`, or `DO NOT USE FOR CURRENT WORK` when needed.
- Stop and report conflicts instead of guessing.

## Important Work Quality Rule

For foundation AI systems, game creation, avatar/persona systems, major visual design, product-identity UI, memory synthesis, and core app functions, use High or Extra High reasoning/settings when available.

These lanes require deep product/design judgment, not shallow mechanical edits. Prompts should be detailed and should consider hierarchy, spacing, motion feel, visual rhythm, touch targets, emotional tone, system fit, future extensibility, and user-facing quality.

Routine checks, docs, and simple validation may use Low or Medium reasoning/settings, but important product-defining work should not be treated lazily or shallowly.

## Exit Rules

Before closing, every agent must run the EXIT GATE in:

```text
docs/brainbridge/MEMTOOL_WORKFLOW.md
```

The final report must include:
- Exact files changed.
- Validation results.
- Git status.
- Git diff stat.
- Suggested commit message.
- Whether `docs/brainbridge` needs updates.
- Whether `.agent_sync` needs updates.
- Whether image/screenshot manifest needs updates.
- Next recommended lane.
- Whether curation labels or a work-log entry are needed.
- Whether unresolved Brain Hub conflicts remain.

## Image Rules

- Every important uploaded/reference image needs a manifest entry.
- Reference sheets and generated character images are reference-only until app-ready exports are chosen.
- Game/loading screenshots are future-lane visual evidence unless Steve opens that lane.
- Do not wire assets into app code without an asset prep/wiring lane.

## Current Active Lane Guardrail

Active lane:
- LANE 27S-E - Home Memory Atrium V1 Build

Next Home stage:
- Stage 4 - Motion / Snap Feel / Spacing / Visual Hierarchy Tuning

Parked:
- Voice Capture Modal + Bubble/Text Sync Visual System.
- MeMChat Visual / Interaction Polish.
- Games Visual Polish / Memory Match Premium Pass.
- Loading / Splash / First-Impression Polish.
- Avatar asset wiring / asset prep.
