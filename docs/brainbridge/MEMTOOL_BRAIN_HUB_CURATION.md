# MEMTOOL BRAIN HUB CURATION

Purpose: Prevent the Brain Hub from accumulating stale, contradictory, missing, or counterproductive context.

This file is a curation rulebook. It does not replace Git proof, lane SOTs, or the workflow gate.

## Truth Labels

Use these labels when updating durable Brain Hub context:

- `CURRENT`: Verified current truth for active work.
- `SUPERSEDED`: Previously true or useful, but replaced by a newer decision, commit, lane, or proof.
- `PARKED`: Valid future work, intentionally out of scope for the current lane.
- `NEEDS PROOF`: Plausible but not yet verified by Git, runtime, screenshot, source file, or Steve confirmation.
- `HISTORY ONLY`: Kept for background or audit trail, not guidance for current implementation.
- `DO NOT USE FOR CURRENT WORK`: Explicitly unsafe, stale, wrong-lane, or blocked context.

## Curation Rule

Agents must not blindly append new truth if it contradicts existing Brain Hub files.

Before adding durable context, compare the new statement against existing files. If it conflicts:

- Mark the older statement `SUPERSEDED`, `PARKED`, `HISTORY ONLY`, or `DO NOT USE FOR CURRENT WORK`; or
- Stop and ask Steve/GPT to resolve the conflict.

Do not leave two conflicting statements both looking current.

## Contradiction Guard

Before updating `docs/brainbridge`, search relevant brain files for overlapping:

- Lane names.
- Commit hashes.
- Active-lane statements.
- Current-stage statements.
- No-touch rules.
- Image/screenshot entries.
- Asset locations.
- Source-of-truth statements.
- Workflow/ENTER/EXIT instructions.

Suggested command:

```powershell
rg -n "lane|stage|commit|current|parked|superseded|no-touch|screenshot|asset|workflow|ENTER|EXIT" docs/brainbridge
```

Use more specific searches for the actual lane, commit, asset, or rule being changed.

## Conflict Report Instruction

If conflict is found, stop and report:

- File A says:
- File B says:
- Likely current truth:
- Recommended correction:
- Whether Steve approval is required:

Do not resolve significant product, policy, route, asset, build, or lane conflicts by guessing.

## End-Lane Curation Checklist

When a lane closes or a durable checkpoint is created, check:

- Latest commit updated?
- Active lane updated?
- Next lane/stage updated?
- Old lane marked completed or parked?
- Conflicting directions resolved?
- Image/screenshot evidence assigned to the correct lane?
- `.agent_sync` updated if active local state changed?
- `docs/brainbridge` updated if durable truth changed?
- Work log entry added if this was a meaningful session/checkpoint?

## Daily / End-Of-Work Cleanup Rule

Before closing a work session, run a Brain Hub closeout check:

```powershell
git status --short --branch
git log -1 --oneline
```

Then confirm:

- Current lane.
- Next lane.
- Whether any Brain Hub docs need updates.
- Whether `.agent_sync` needs updates.
- Whether image/screenshot manifests need updates.
- Whether a work-log entry is needed.

If any of those are uncertain, report that uncertainty instead of silently appending context.

## Work Log Relationship

Use `MEMTOOL_WORK_LOG.md` for concise operational history:

- Lane starts.
- Lane closeouts.
- Commit checkpoints.
- Major decisions.
- Image/screenshot intakes.
- Build/test proof.
- Parked work.
- Contradictions found and resolved.

Do not use the work log as a raw chat dump.
