# MEMTOOL AGENT RULES

These rules apply to GPT, Codex, future chats, and future agents working in this repo.

## Before Acting

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

## Source Of Truth Rules

- Repo/Git/GitHub are technical truth.
- `docs/brainbridge` is shared durable project context.
- `.agent_sync` is the local active board and may be more immediate than committed docs.
- File Library/uploads are the evidence vault.
- Canvas first for drafting shared plans, summaries, and context blocks.
- Do not trust old chat without current proof.

## Hard No-Touch Rules

- Do not run EAS build unless Steve explicitly approves.
- Do not spend build credits unless Steve explicitly approves.
- Do not use Replit assumptions.
- Do not use Notepad workflow.
- Do not use `git add .`.
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
