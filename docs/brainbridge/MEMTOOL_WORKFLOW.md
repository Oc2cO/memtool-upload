# MEMTOOL BBWAAS WORKFLOW

Purpose: Official reusable enter/exit workflow for MemTool / Oc2cO agents so Steve does not have to restate every guardrail manually.

BBWAAS means Brain Bridge Workflow Active Agent Sync.

## ENTER GATE

Before editing, every agent must read:

```text
docs/brainbridge/MEMTOOL_MASTER_BRAIN_BLOCK.md
docs/brainbridge/MEMTOOL_LANE_STATUS.md
docs/brainbridge/MEMTOOL_IMAGE_MANIFEST.md
docs/brainbridge/MEMTOOL_AGENT_RULES.md
docs/brainbridge/MEMTOOL_WORKFLOW.md
```

Also read local fast-sync if present:

```text
.agent_sync/ACTIVE_AGENT_SYNC_BOARD.md
```

Run scopecheck:

```powershell
git status --short --branch
git log -1 --oneline
```

Then decide:
- Is the requested work inside the active lane?
- Is the requested work docs-only, app-only, or asset-only?
- Does the request touch a parked lane?
- Does it require build credits, native/prebuild/build config, or broad mixed-lane work?
- Are screenshots/assets being used, and do they need manifest entries?
- Does the requested update conflict with existing Brain Hub truth?
- Does the work need a curation label or work-log entry?

Stop and ask Steve if:
- The repo is not in the expected state.
- Required hub files are missing.
- The requested work crosses multiple broad lanes.
- The work would spend EAS/build credits.
- The work touches native/prebuild/build config.
- The route/asset/source of truth is unclear and a safe assumption would be risky.

## DURING WORK

Use the smallest lane-sized patch that completes the task.

Rules:
- Do not rely on chat memory alone.
- Do not use Replit assumptions.
- Do not use Notepad workflow.
- Do not use `git add .`.
- Do not run EAS build or spend build credits unless Steve explicitly approves.
- Do not commit or push unless Steve explicitly approves.
- Keep app code, docs, assets, native config, and screenshots in their proper lanes.
- Do not blindly append new truth when existing Brain Hub files conflict.
- Use `MEMTOOL_BRAIN_HUB_CURATION.md` truth labels when context is current, superseded, parked, needs proof, history-only, or not usable for current work.

## WHEN TO CURATE BRAIN HUB TRUTH

Use `docs/brainbridge/MEMTOOL_BRAIN_HUB_CURATION.md` before changing durable project truth.

Agents must search relevant Brain Hub files for overlapping lane names, commit hashes, active-lane statements, no-touch rules, image entries, and source-of-truth statements before updating durable docs.

If conflict is found, stop and report:
- File A says:
- File B says:
- Likely current truth:
- Recommended correction:
- Whether Steve approval is required:

## WHEN TO UPDATE `docs/brainbridge`

Update `docs/brainbridge` when:
- A durable checkpoint is created.
- A lane opens, closes, or changes next stage.
- Shared agent rules or workflow changes.
- A new sub-brain/SOT is needed.
- Image/screenshot evidence should be durable across chats and agents.
- A curation label or work-log entry is needed to prevent stale/conflicting context.

Do not update it for tiny transient notes that only matter within one local agent session.

## WHEN TO UPDATE `.agent_sync`

Update `.agent_sync` when:
- Local active-board context needs to change quickly.
- A local Codex/agent lane needs immediate state that may not be committed yet.
- Steve explicitly asks to update the local board.

Treat `.agent_sync` as fast local coordination, not the durable shared hub unless Steve says otherwise.

## WHEN TO UPDATE IMAGE / SCREENSHOT MANIFESTS

Update image/screenshot manifests when:
- Steve uploads a new screenshot/reference image.
- A local reference folder is identified or changed.
- A generated sheet/reference image is used as evidence.
- An image graduates from reference-only to app-ready candidate.
- Screenshot evidence is tied to a future lane.

Keep observations separate from interpretation.

## WHEN TO COMMIT / PUSH

Commit only when Steve approves.

Push only when Steve approves or explicitly asks.

Never use `git add .`; stage explicit files only when a commit is approved.

Recommended commit report before approval:
- Exact files changed.
- Validation results.
- Git status.
- Diff stat.
- Suggested commit message.
- Any docs/manifest updates still needed.

## WHEN TO START A NEW LANE

Start a new lane when:
- The work changes feature area.
- Visual evidence belongs to a parked lane.
- The task would mix app code with assets/docs/native/build work.
- The work needs build credits or device/runtime proof.
- The work would meaningfully change policy, entitlement, backend, or native behavior.

## EXIT GATE

Before closing, every agent must report:

- Exact files changed.
- Validation results.
- Git status.
- Git diff stat.
- Suggested commit message.
- Whether `docs/brainbridge` needs updates.
- Whether `.agent_sync` needs updates.
- Whether image/screenshot manifest needs updates.
- Next recommended lane.

Also run the Brain Hub closeout check:

```powershell
git status --short --branch
git log -1 --oneline
```

Confirm:
- Current lane.
- Next lane.
- Whether curation labels are needed.
- Whether `MEMTOOL_WORK_LOG.md` needs an entry.
- Whether any conflicting directions remain unresolved.

If validation was not run, say exactly why.

If files are untracked, say that explicitly.
