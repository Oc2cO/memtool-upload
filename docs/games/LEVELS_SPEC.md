# Memory Match & 24 Game — Level ladders

**Owner:** Task #320
**Status:** v1 (locked for the Round 1 progression rollout)

The two MemTool brain-trainer games used to ship as a bare 3-button
Easy / Medium / Hard selector — same level played over and over, no
sense of forward motion. This doc pins the level-by-level ramp the
first real progression release implements. Anyone touching `gameLevels.ts`
should keep this file in sync.

## Shared rules

- **Level count per game:** 30. (Round figure that hits roughly an
  hour of total clear time on first sitting and leaves obvious room
  for a v2 expansion.)
- **Stars:** 1–3 per level. 3 = excellent, 2 = clear well, 1 = barely
  cleared. Stars never block progression — they're a replay incentive.
- **Unlock rule:** finish level N (≥ 1 star) to unlock level N+1.
  Level 1 is always unlocked.
- **Free vs Pro gate:** levels 1–10 are free for everyone; levels
  11–30 require Pro. Tapping a Pro-locked level routes to the
  existing `/subscription` paywall surface.
- **Replay:** any cleared level can be replayed; the recorded star
  rating is the best ever earned.

## Memory Match — 30 levels

Axes that ramp:

| Level band | Pairs | Grid (cols × rows) | Preview ms | Icon set |
|---|---|---|---|---|
| 1–3   | 3, 4, 4 | 2×3 / 4×2 / 4×2 | 2200 | shuffled global |
| 4–6   | 6, 6, 8 | 4×3 / 4×3 / 4×4 | 1800 | shuffled global |
| 7–10  | 8, 10, 10, 12 | 4×4 / 4×5 / 4×5 / 4×6 | 1500 | shuffled global |
| 11–15 | 12, 14, 14, 15, 16 | 4×6 / 4×7 / 4×7 / 5×6 / 4×8 | 1200 | shuffled global |
| 16–20 | 16, 18, 18, 18, 18 | 4×8 / 6×6 / 6×6 / 6×6 / 6×6 | 1000 | shuffled global |
| 21–25 | 12, 14, 14, 16, 16 | 4×6 / 4×7 / 4×7 / 4×8 / 4×8 | 900  | "similar" subset |
| 26–30 | 16, 18, 18, 18, 18 | 4×8 / 6×6 / 6×6 / 6×6 / 6×6 | 700  | "similar" subset |

Pair / grid pairs are picked so `pairs * 2 == cols * rows` always.
Icon-set "similar" means the level draws from the food / animal /
nature subsets so visually-near pairs compete (harder to fingerprint).

Success bar (per level):

- **3 stars:** clear in `≤ pairs + ceil(pairs * 0.5)` moves and within
  `pairs * 4` seconds (≈ perfect with one slip).
- **2 stars:** clear in `≤ pairs * 2` moves.
- **1 star:** clear (any moves / time). The minimum to advance.

## 24 Game — 30 levels

Axes that ramp:

| Level band | Number range | Operators | Time budget (s) | Curated tricky set |
|---|---|---|---|---|
| 1–3   | 1–6   | + −           | none | no |
| 4–6   | 1–9   | + − ×         | none | no |
| 7–10  | 1–9   | + − × ÷       | none | no |
| 11–15 | 1–10  | + − × ÷       | 90   | no |
| 16–20 | 1–13  | + − × ÷       | 75   | no |
| 21–25 | 1–13  | + − × ÷       | 60   | yes (rejects puzzles solvable with only + and ×) |
| 26–30 | 1–13  | + − × ÷       | 45   | yes |

All puzzles are validated solvable by the existing `solve24` solver
before being shown.

Success bar (per level):

- **3 stars:** solve in `≤ 30%` of the budget (or `≤ 15s` if no timer).
- **2 stars:** solve in `≤ 60%` of the budget (or `≤ 40s` if no timer).
- **1 star:** solve at all (within the budget).

## Tuning for first-session feel

- Level 1 of each game is intentionally trivial (3 pairs / range 1–6)
  so the very first tap of either game ends in a clear.
- Levels 1–5 should be clearable by a complete beginner in one sitting.
- The first real "wall" lands at the operator-set jump (Game 24
  level 7) and the "similar" icon-set jump (Memory Match level 21),
  not before.
