# MEMTOOL BRAIN HUB COVERAGE MAP

Purpose: Map what context lives where, who can access it, and what still needs manifest indexing across GPT, Codex, repo docs, local files, and uploads.

This is context documentation only. It is not app code.

## Context Containers

### Canvas

Canvas is the GPT workbench for drafting, organizing, and refining shared plans or brain-block text before it becomes durable repo context.

Best for:
- Drafting lane prompts.
- Editing shared summaries.
- Preparing Brain Hub updates before repo commits.

Limits:
- Codex/local agents cannot automatically see Canvas unless content is pasted, committed, or copied into local files.

### `docs/brainbridge`

`docs/brainbridge` is the shared repo Brain Hub.

Access:
- Codex can read it locally.
- GPT can read it after the docs are committed and pushed to GitHub, or if the content is pasted/uploaded.
- Future agents should treat it as durable shared context.

Use for:
- Master brain block.
- Workflow gates.
- Lane status.
- Agent rules.
- Sub-brain SOTs.
- Brain Hub curation and work logs.
- Image/screenshot/asset manifests.
- Durable context that should survive across chats and agents.

### `.agent_sync`

`.agent_sync` is local fast active-agent context.

Access:
- Codex/local agents can read it locally.
- GPT cannot automatically browse it unless content is pasted, uploaded, or committed/pushed.
- It is usually not committed unless Steve explicitly decides otherwise.

Use for:
- Active local board.
- Fast lane state.
- Agent handoff notes.
- Local SOT while work is in progress.

### File Library / Uploads

File Library/uploads are the GPT evidence vault.

Access:
- GPT can use uploaded files in the current chat/context.
- Codex cannot automatically see GPT uploads unless they are copied/synced into repo/local files or described in manifests.

Use for:
- Uploaded screenshots.
- Workbench markdown.
- Visual evidence.
- Reference files shared directly in GPT.

### Local OneDrive / Desktop Folders

Local OneDrive/Desktop folders are large image/asset vaults.

Access:
- Codex can access local paths only when the workflow and permissions allow.
- GPT cannot automatically browse `C:\Users\Sagou` folders unless files are uploaded, pasted, or committed/pushed.

Known current local asset folder:

```text
C:\Users\Sagou\OneDrive\Desktop\MemTool Home Atrium References
```

Known prior inventory:
- 86 image/video files in the active folder, confirmed by HUB-04 local inventory.
- 102 likely avatar-related files in wider scan.
- Memora, Sagous, and Oc2cO/brand creature groups exist.

Use for:
- Large reference sets.
- Character/brand exploration.
- App-ready candidate source files.

Rule:
- Do not copy all big images into the repo by default. Manifest first. Only selected app-ready assets enter repo assets.

### Git / GitHub

Git/GitHub is repo/code truth.

Access:
- Codex can verify local repo state.
- GPT can use GitHub content after push or when content is pasted/uploaded.
- Agents should verify with `git status --short --branch` and `git log -1 --oneline`.

Use for:
- Code truth.
- Committed docs.
- Pushed shared Brain Hub.
- Technical proof.

### Saved Memory

Saved memory is compact guardrails only.

Use for:
- Stable user/project preferences.
- High-level guardrails.

Do not use for:
- Detailed lane state.
- Exact commit truth.
- Full image evidence.
- Current repo proof.

## Access Truth

- GPT cannot automatically browse `C:\Users\Sagou` or `.agent_sync` unless content is uploaded, pasted, or committed/pushed.
- Codex cannot automatically see ChatGPT Canvas/File Library uploads unless they are copied/synced into repo/local files or described in manifests.
- Both GPT and Codex can use `docs/brainbridge` after commit/push.
- Images need manifest entries to become usable context across agents.
- Repo/Git/GitHub remain technical truth.
- Manifests turn scattered screenshots/assets into durable evidence.

## Current Known Local Asset Folder

Active local reference folder:

```text
C:\Users\Sagou\OneDrive\Desktop\MemTool Home Atrium References
```

Known prior inventory:
- 86 image/video files in active folder.
- 102 likely avatar-related files in wider scan.
- Memora asset group exists.
- Sagous asset group exists.
- Oc2cO / brand creature asset group exists.

Current status:
- Reference-only until app-ready exports are selected.
- Do not generate more assets by default.
- Do not wire generated sheets into app assets by default.

HUB-04 inventory status:
- Local folder exists.
- 86 `.png`, `.jpg`, `.jpeg`, `.webp`, `.mp4`, and `.mov` files indexed.
- Raw inventory location: `.agent_sync/MEMTOOL_LOCAL_IMAGE_INVENTORY.md`
- Inventory entries are `needs classification`.
- No large images/videos were copied into the repo.

## Current Uploaded / Current-Chat Evidence

Known current evidence:
- Full Memory Match Level 1 screenshot.
- Browser screenshot showing prior screenshot thumbnails.
- Uploaded markdown/workbench with screenshot intake and asset inventory.
- Game/loading screenshot summary.

Current interpretation:
- Memory Match evidence belongs to Games Visual Polish / Memory Match Premium Pass.
- Browser thumbnails are proof-of-existence, not full audit-quality evidence.
- Loading/download screenshots belong to Loading / Splash / First-Impression Polish.
- Asset inventory belongs to Avatar asset wiring / asset prep.

## What Still Needs Indexing

Still needs manifest indexing when available:
- Individual Home screenshots if uploaded later.
- Individual game screenshots as full-size files.
- Loading/download screenshots.
- Avatar identity lock candidates.
- App-ready asset candidates.
- Reference-only generated sheets.
- Future marketing/intro/video materials.

## Standard Image Manifest Entry Template

```text
Image name:
Storage location:
GPT upload/file id if known:
Local path:
Repo path if committed:
Lane:
Status:
What it shows:
Problem observed:
Future action:
App-ready/reference-only/delete-candidate:
Last reviewed:
```

Status suggestions:
- `proof-only`
- `reference-only`
- `app-ready candidate`
- `app-ready selected`
- `delete-candidate`
- `needs review`

## Update Workflow For New Files / Images / Screenshots

When a new file/image/screenshot is created or uploaded:

1. Save or upload it.
2. Add or update a manifest entry.
3. Link it to the correct lane.
4. Decide whether it is app-ready, proof-only, or reference-only.
5. Update `docs/brainbridge` if the information should be durable.
6. Update `.agent_sync` if the active local lane needs immediate local context.
7. Do not copy all big images into the repo by default.
8. Only selected app-ready assets should enter repo assets.

## Practical Rule

Manifest first. Commit selected context second. Promote assets into the app only in a dedicated asset/app lane.

## Curation / Work Log Coverage

Durable curation and operational history live in:

```text
docs/brainbridge/MEMTOOL_BRAIN_HUB_CURATION.md
docs/brainbridge/MEMTOOL_WORK_LOG.md
```

Use these files to prevent stale or conflicting project truth from looking current.

Do not use saved memory, old chat, uploads, or local-only notes as current truth when Brain Hub and Git proof disagree.
