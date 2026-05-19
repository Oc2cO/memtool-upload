# MEMTOOL HOME ATRIUM SOT

Purpose: Home Memory Atrium sub-brain for the active Home lane.

## Current Status

Active lane:
- APP HOME - Safe V1 Doorway Structure

Current pushed checkpoint:
- `4649d57 fix: narrow home atrium to v1 doorways`

Validation before push:
- `npm.cmd run typecheck` PASS
- `npx.cmd jest --runTestsByPath "app/(app)/(tabs)/index.test.tsx" --runInBand` PASS, 7 tests passed
- `git diff --check` PASS

Superseded / curated note:
- `71b9b11 feat: polish home atrium premium object identity` is not the final Home V1 truth.
- That checkpoint represented an overbuilt 3-panel immersive/snap-scroll direction.
- The current Home truth is the later narrowed checkpoint `4649d57`.

## Current Home Direction

Home should be a safe V1 Memory Atrium doorway structure, not a final immersive 3-panel snap-scroll system.

The current direction keeps Quick Capture as the strongest top action, then adds a compact Memory Atrium doorway area that makes primary destinations visible without replacing navigation or overbuilding the final dream.

## Current V1 Doorways

The compact Home Atrium doorway area should preserve:
- MeMChat -> `/ai-guide`
- Daily Chapter / Recap -> `/recap`
- Memory Book / Archive -> `/archive`
- Game Room -> child actions for `/memory-match` and `/game-24`

Existing lower Home content should remain available where practical:
- Log a Call
- Wellness
- Capture streak / Today stats
- Daily Boost
- Did You Know
- MemNoticedCard
- Recent memories
- Train Your Mind utility tiles

## Curated History

The following commits are historical/experimental Home Atrium work, not the current final V1 target:
- `2fb2a77 feat: shape home memory atrium panels`
- `eec39b3 feat: layer home atrium visual system`
- `669528b feat: polish home atrium foreground objects`
- `0ba50c8 feat: tune home atrium motion spacing and hierarchy`
- `71b9b11 feat: polish home atrium premium object identity`

The current curated Home V1 checkpoint is:
- `4649d57 fix: narrow home atrium to v1 doorways`

## Next Home Work

Next Home work should be small review/tuning against the V1 doorway structure:
- Check readability and touch targets.
- Tune spacing and hierarchy.
- Confirm route behavior.
- Avoid reintroducing snap-scroll.
- Avoid re-expanding to 3 panels unless Steve explicitly opens a later immersive Home lane.

## Parked Work

- Final cinematic snap-scroll Atrium is parked.
- Full immersive panel system is parked.
- MeMChat internals are parked for a separate lane.
- Voice capture visual work is parked.
- Games visual polish is parked.
- Splash/intro/loading polish is parked.
- Avatar asset wiring is parked.

## No-Touch Rules

- Do not run EAS build.
- Do not spend build credits.
- Do not touch Voice Capture.
- Do not touch splash or intro.
- Do not redesign MeMChat internals.
- Do not touch native/prebuild/build config.
- Do not add dependencies unless Steve approves.

## Screenshots / Assets

Home-specific screenshots belong in the image manifest and screenshot intake docs.

Reference images belong in `MEMTOOL_IMAGE_MANIFEST.md` and `MEMTOOL_ASSET_MANIFEST.md`.

Do not let games/loading/voice screenshots derail the Home lane.
