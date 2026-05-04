# MemTool / Oc2cO LLC — Official Brand Bible

**Canonical source of truth for character lore, world, color, and asset deliverables. Any task agent producing visual or written content for MemTool MUST read this file first.**

Last updated: May 3, 2026.

---

## Mem's voice (TTS)

The "Mem voice" catalog (`lib/memVoiceCatalog.ts`) only ever promotes voices that:
1. Ship **free** with iOS / Android,
2. Run **on-device** via `AVSpeechSynthesizer` / Android TTS (no server round-trip, no rate limits, no API keys),
3. Have **no copyright restrictions** for normal app use through the OS speech synthesiser.

**Tier ranking (highest first):**
1. **Premium** — Apple's neural Siri voices (iOS 16+). The user must download them once from `Settings → Accessibility → Spoken Content → Voices → English`. The catalog auto-detects what's installed via the `.premium.` substring in each voice identifier.
2. **Enhanced** — built-in higher-quality voices, no download required.
3. **Compact** — never promoted (the legacy robotic ones the user explicitly wanted us to move away from).

**Curated default pair (first-launch behaviour):** when no voice id has been persisted yet, `useEffectiveMemVoiceId` resolves to:
- **Ava** (`com.apple.voice.premium.en-US.Ava`) — US English, female, "Calm" — Siri Voice 4
- **Evan** (`com.apple.voice.premium.en-US.Evan`) — US English, male, "Warm" — Siri Voice 5

Both are widely cited on Apple accessibility forums as the warmest, most-natural neural voices Apple ships. They're tagged `recommended: true` in the catalog and surfaced in Settings with a star icon. If neither is installed, `getRecommendedDefaultVoiceId` falls through Premium → Enhanced → system default.

**Other curated picks** (in catalog order): Zoe (Premium f), Nathan (Premium m), Serena (Premium f, UK), Tom (Premium m), Allison (Premium f), Samantha (Enhanced f), Daniel (Enhanced m, UK), Karen (Enhanced f, AU), Moira (Enhanced f, IE).

**Cadence:** rate `0.94`, pitch `1.0` (slightly slowed, neutral pitch — perceptual research consistently rates this range as warm/calming without sliding into "stoned" territory).

**Discoverability:** when zero Premium voices are installed, Settings shows a "Get warmer voices (free)" hint that opens iOS Settings (Apple doesn't expose a deep-link URL for the voice download pane, so it lands on the Settings root with text instructions).

**No third-party voice services.** ElevenLabs, Play.ht, Resemble.ai etc. are deliberately not integrated — they require API keys, have monthly cost ceilings, and most TOS forbid using cloned celebrity voices in shipping apps. On-device Apple voices give us "actually human" warmth with none of those risks.

---

## Asset → Screen wiring (canonical map)

This is the single source of truth for **where** each brand image lives in the running app. The `<BrandHero>` component (`components/BrandHero.tsx`) is the only sanctioned way to render these assets — never `require()` them inline. If you add a new use, update this table.

| Asset file | `BrandHero` variant | Surface |
|---|---|---|
| `assets/brand/splash-9x16.png` | (native splash, see `app.json`) | iOS launch screen — invisible in web preview |
| `assets/brand/app-icon-1024.png` | (launcher icon, see `app.json`) | Home-screen icon |
| `assets/brand/memora-fullbody.png` | `memora-fullbody` | Onboarding **MEET** stage — the photo reveal of Memora |
| `assets/brand/memora-fullbody-dark.png` | `memora-fullbody-dark` | reserved (dark-mode hero) |
| `assets/brand/memora-head-512.png` | `memora-head` | Home tab greeting strip (decorative, paired with "Welcome back") |
| `assets/brand/mem-hero-chat.png` | `memora-hero-chat` | AI Guide (Mem) chat — empty-state hero shown above the talking-Mem stage with a one-line greeting, fades out on first user message |
| `assets/brand/couple-hero.png` | `couple-hero` | Onboarding **REFLECT** stage — emotional close |
| `assets/brand/oc2co-fullbody.png` | `sagous-fullbody` | reserved (About / tip card — pending surface) |
| `assets/brand/oc2co-head-512.png` | `sagous-head` | reserved |
| `assets/brand/memora-expr-*.png` (6) | not yet exposed | reserved as static fallback for vector `<MemCharacter>` expressions |
| `assets/brand/oc2co-expr-*.png` (6) | not yet exposed | reserved (Sagous expression sheet) |
| `assets/brand/seg-vo-0{1,2,3}.mp4` + `captions/*.ass` | not yet wired | reserved — no "watch the brand story" surface exists yet |

**Open gaps (assets on disk, no screen yet):**
- Sagous (`oc2co-fullbody*`, `oc2co-expr-*`, `oc2co-head-512`) — needs an About / brand-story surface.
- Voiceover MP4s with captions — would belong on a "Why MemTool" intro page or in the Settings → About area.
- Memora expression sheet (`memora-expr-*`) — reserved as a non-animated fallback if `MemCharacter` ever needs to render in a static-image context (e.g. PDF export, share card).

**Why two character systems coexist:**
- `<MemCharacter>` (vector, in `components/MemCharacter.tsx`) — used in chat (`ai-guide`), onboarding tour (`onboarding-chat`), and stages 2–3 of `onboarding`. Drives lip-sync and dynamic expressions; cannot be replaced by static images.
- `<BrandHero>` (photo, in `components/BrandHero.tsx`) — used for **first-meeting / emotional anchor moments** where the user should see the *real* designed Memora and Sagous, not the simplified vector.

> **NAMES — LOCKED:**
> - Wife: **Memora** (term of endearment from her husband: **"Sunshine"**)
> - Husband: **Sagous**
> - Homeworld / brand-soul / company name: **Oc2cO** — this is the place Memora and Sagous come from, AND the soul of the brand, AND the legal entity (Oc2cO LLC). It is **not a person**.
> - Old asset filenames `oc2co-*.png` predate the Sagous name and were a temporary codename for the husband; the art inside those files **is Sagous**. New art should be filed under `sagous-*.png` going forward.

---

## Company

- **Company:** Oc2cO LLC
- **App:** MemTool
- **Core meaning:** Organize Chaos
- **Long-term vision:** AI-first wellness, memory, games, reflection, marketplace, family-hearted tech.
- **Emotional philosophy:** "Us little people should not go down the path of greed, control, and no heart." This brand should feel **human, moral, warm, useful, and alive.**

---

## Oc2cO — the homeworld and brand-soul

**Oc2cO is not a character. Oc2cO is where Memora and Sagous are from — and it is the brand-soul of everything we build.**

**The story Oc2cO tells:**

> We loved hard in the 60s, 70s, and 80s — analog warmth, real human soul, chosen family, hand-built things, music that meant something, people who looked each other in the eye. Then somewhere along the way we lost track. We chased speed, scale, optimization, attention, control, "engagement" — and we forgot the soul place we came from in the universe.
>
> Oc2cO is the jump forward that does not forget. New age, new world, new thinking — **smarter, more kind, more caring** — but rooted in that original soul. It is humbling. It reminds us we are tiny inside a very large universe, and that being kind is not weakness — it is the whole point.
>
> Memora and Sagous come from Oc2cO. When they show up inside MemTool, they bring that homeworld with them: the calm, the warmth, the humility, the refusal to manipulate the user.

**Brand voice that flows from Oc2cO:**

- Smarter, more kind, more caring (never clever-at-the-user's-expense, never dark-pattern, never fear-driven).
- Forward-thinking but soul-rooted — 2026 craft on top of 1970s warmth.
- Humbling — never preachy, never grandiose. We are small inside something large.
- Quiet confidence over hype. Few words, full meaning.
- Treats the user as a real adult human being with a real life.

**Use Oc2cO when you need to:**

- Sign off marketing copy ("From Oc2cO. With heart.").
- Explain *why* MemTool exists in About / onboarding / press copy.
- Anchor the design when something starts feeling cold, mechanical, or growth-hacky — pull it back to Oc2cO.
- Frame the universe in art and video: the dark cosmic backdrop, the soft golden-ratio spiral, the warm + cool aurora is **Oc2cO** — the world Memora and Sagous step out of.

**Reject anything that:** feels cold, manipulative, addictive, mocking, growth-hacky, dark-pattern, fear-marketing, "alpha-bro", or that frames Oc2cO as a single character/mascot.

---

## Characters — the relationship is HUSBAND AND WIFE

> **CRITICAL:** Memora and Sagous are **husband and wife**. They are NOT siblings, brother and sister, twins, or roommates. Any copy, art prompt, or animation that frames them otherwise is wrong and must be corrected before merging. Sagous's pet name for Memora is **Sunshine** — use it sparingly in copy where intimacy or warmth is appropriate (e.g. AI-Mem responses to the user, marketing taglines).

Together they represent:

- yin and yang
- organized chaos
- calm signal + moving spark
- wife and husband
- love, building, nature, family, adventure
- two opposites that protect each other
- the emotional engine behind Oc2cO LLC

### MEMORA — wife — "the signal" (nickname: Sunshine)

**Personality:** organized, soulful, reserved, deeply observant, warm but not loud, feminine but not human, quietly witty, full of knowledge, few words / full meaning, safe, calm, emotionally intelligent. She sees everything but never judges. Her husband Sagous calls her **Sunshine** because she is the steady warm light he comes home to.

**Visual (v2 — locked from `attached_assets/MEMTOOL_vIDEO_v2.0_*.mp4` and `assets/brand/references/CANON_*.jpg`. The earlier "soft bunny" v1 set has been archived to `assets/brand/_v1_bunny_archived_2026-05-03/` — do NOT reintroduce floppy lop ears or lavender hoodies):**
- small fluffy baby-yoda-style creature with **balanced healthy proportions** (head ≈ 1/3 of body height, visible small paws as hands, visible small feet, hoodie hangs to her hip)
- soft sage-green peach-fuzz fur with a **pink interior** in the ears
- **large rounded POINTED fox-like ears flaring outward / upward** (NOT floppy, NOT bunny, NOT lop)
- very large soulful ocean-blue eyes with bright multi-point catchlights — feminine, with a longer, softer eyelash line than Sagous
- soft round face, tiny pink nose, gentle rosy cheek blush, subtle quiet closed-mouth smile
- a small tuft of cream-pale hair peeking between the hood opening
- wears a **heather-brown soft hoodie** with the hood up, drawstrings out, and a glowing **warm amber OC2CO emblem** (yin-yang with a tiny hourglass and gear nested inside, "OC2CO" beneath)
- enveloped in a soft cyan / blue-white aura
- not a solid human body — more like light, fur, and soul inside a hooded form
- elegant, premium, 2026 mobile-app mascot

**Expression:** calm, observant, deep, safe.

She should look like she could say:
> "That wasn't random. That was the pattern finally showing itself."
> "I'm listening. Say the messy part first."

**Reject if she looks like:** a human woman, a fairy, an anime girl, a robot, hard metal, a scary alien, a floating head only, a babyish mascot, an over-glamorous goddess, or carries medical / therapy symbolism.

### SAGOUS — husband — "the spark"

**Personality:** energetic, adventurous, heart-first, playful, impulsive in a good way, protective, chaotic-good, outgoing, inviting, warm, brave, fun. Calls his wife Memora **Sunshine**. From Oc2cO, like Memora.

**Visual (v2 — locked from `attached_assets/MEMTOOL_vIDEO_v2.0_*.mp4`. Asset filenames keep the legacy `oc2co-*` prefix; the art inside IS Sagous):**
- same baby-yoda-style creature species as Memora with **balanced healthy proportions** (head ≈ 1/3 of body height, visible small paws as hands, visible small feet, hoodie hangs to his hip)
- **sunshine-gold / warm yellow** peach-fuzz fur (NOT sage — sage is Memora) with a **pink interior** in the ears
- **large rounded POINTED fox-like ears flaring upward** (NOT floppy, NOT bunny, NOT lop)
- very large soulful ocean-blue eyes with bright multi-point catchlights — slightly shorter eyelash line than Memora, warmer brow
- soft round face, tiny pink nose, gentle rosy cheek blush, warm open joyful grin (more open / playful than Memora's)
- a small tuft of pale hair sticking up between the hood opening
- wears a warm **amber-orange hoodie** with the hood up, drawstrings out, and the same glowing **warm amber OC2CO emblem** as Memora (yin-yang + tiny hourglass + gear, "OC2CO" beneath)
- surrounded by warm golden firefly sparks dancing around his hands — more motion than Memora
- not a solid human body — more like light, fur, and soul inside a hooded form
- protective but playful — not aggressive, not childish, not a robot

**Expression:** warm, alive, real, inviting.

He should look like he could say:
> "Tiny chaos. Big heart. Let's go."
> "We'll figure it out while moving."

### Composition rules when together

- Memora slightly **left** or slightly **elevated**, calm blue-white light.
- Sagous slightly **right** or slightly **forward**, warm amber-gold light.
- Between them: a glowing pattern made from memory sparks, roots, water, stars, and subtle golden-ratio spiral lines.
- The result reads as: **Organize Chaos.**

---

## World

Dark cosmic mobile-app universe.

| Token | Hex | Use |
|-------|------|-----|
| Base | `#0A0F1E` | dark cosmic backdrop |
| Primary glow | `#00E5FF` | Memora cyan |
| Secondary glow | `#9B7AE8` | violet accents, joint glow |
| Warm glow | `#FFB74D` | Sagous golden amber |
| Coral spark | `#FF6B5B` | Sagous impulse / mischief sparks |

Background blends:
- deep dark cosmic space
- soft blue energy rings
- warm gold light trails
- subtle glassmorphic phone-UI panels
- nature woven in: water, roots, stars, light, breath
- **golden-ratio spiral motif**, subtle and premium

Forbidden: clutter, cheap neon, corporate stock look, horror, creepy alien energy, watermarks, text artifacts.

---

## Style direction

Premium 2026 app mascot design.
Soft 3D / CGI / luminous clay-glass-fur hybrid.
Rich gradients. Soft bloom. High detail but clean.

| Want | Don't want |
|------|------------|
| Cute but mature | Babyish |
| Fun but not silly | Comedic / cartoonish |
| Alive but not creepy | Uncanny / horror |
| Spiritual but not religious | Iconography of any faith |
| Tech but not corporate | Stock-photo polish |

**Reference direction:** soft creature-like luminous beings, big soulful eyes, hooded / hoodie silhouette, glowing chest emblem, cosmic blue/gold app background, warm and alive.

**Hard rejects:**
- the old yellow circle head
- generic robots
- anime characters
- Disney / Pixar copies
- floating-head-only compositions
- watermarks or misspelled text artifacts
- if the two don't read as a married pair from the same world → reject

---

## Asset deliverables (planned — not yet produced)

This list is the canonical scope for the next round of art work. Each item should be staged in BOTH `artifacts/memtool/assets/brand/` and `artifacts/memtool/assets/games/` per the existing convention.

### 1. Full-body characters
- `memora-fullbody.png` — 1024×1024+, transparent PNG
- `memora-fullbody-dark.png` — same on cosmic dark bg
- `oc2co-fullbody.png` — 1024×1024+, transparent PNG
- `oc2co-fullbody-dark.png` — same on cosmic dark bg

### 2. Expressions

Memora: `calm`, `happy`, `sad`, `anxious`, `thinking`, `proud-celebration`.

Oc2cO: `calm`, `happy`, `mischievous`, `focused`, `surprised`, `celebrating`.

(File naming convention: `<character>-<expression>.png`, transparent.)

### 3. Close-up heads (app-safe, readable at small sizes)
- `memora-head-512.png` — 512×512, transparent
- `oc2co-head-512.png` — 512×512, transparent

### 4. Couple hero art
- `couple-hero.png` — yin-yang composition, golden-ratio spiral behind, dark cosmic background, safe empty space for the MemTool wordmark.

### 5. App splash background
- `splash-9x16.png` — 9:16 vertical, no text, dark cosmic blue / gold / cyan, subtle phone-app glow, room for characters in center.

### 6. Social thumbnails (6 total, no baked-in text)
- `thumb-memora-quiet-pattern.png`
- `thumb-oc2co-playful-spark.png`
- `thumb-couple-organize-chaos.png`
- `thumb-memtool-capture-mood.png`
- `thumb-games-oc2co.png`
- `thumb-recap-memora.png`

### 7. Video assets

**VIDEO 1 — App splash** (4–5 s, 9:16, in-app intro)
- 0–1s: dark cosmic field, tiny golden spark appears
- 1–2s: Oc2cO flashes in playfully, nudges the spark
- 2–3s: spark scatters into chaos
- 3–4s: Memora appears calmly, blue-white glow organizes chaos into pattern
- 4–5s: both look toward the user, pattern becomes the MemTool glow
- No text baked in unless approved later.

**VIDEO 2 — Brand intro** (10 s, 9:16 + 16:9, social / website / App Store accent)
- Chaos particles, water light, roots and stars.
- Oc2cO brings motion. Memora brings meaning.
- Together they form the golden-ratio spiral and the MemTool memory constellation.

**VIDEO 3 — App Store preview intro/outro clips**
- 2-second intro: MemTool cosmic logo / Memora + Oc2cO glow
- 2-second outro: "Turn thoughts into patterns" mood (no hardcoded text unless editable)
- These get stitched with real device footage because Apple App Previews must demonstrate real app UI.

**VIDEO 4–8 — App functionality demo clips** (added per user May 2, 2026)
- Captured / rendered from the real MemTool app to show what the product actually does. These are the screen-recording-driven Apple App Preview clips and the social/marketing demo clips.
- Each clip 15–30 s, 9:16 portrait (Apple App Preview spec) plus 16:9 export for social.
- One clip per core flow:
  1. **Capture a memory** — open app → "Speak a memory" or "Type a memory" → AI tags + facets land → memory glows into the timeline.
  2. **Daily Recap** — open Recap tab → "Past 30 days" heatmap fills in → tap a day → AI summary expands.
  3. **Archive + facets** — scroll Archive → tap a person facet chip → list filters → tap a memory → illustration polaroid + AI tags.
  4. **Mem AI chat** — open AI Guide → Mem stage greets → user types → Mem speaks reply with animated mouth + word-by-word transcript.
  5. **Brain games (Fuse + Echo)** — Games hub → start Fuse → solve one round (chain shockwave) → start Echo → match a pair (gold pulse).
- Open with the 2 s VIDEO 3 intro, close with the 2 s VIDEO 3 outro, so all five demo clips share consistent brand bookends.
- Captions baked-in burn-in is OK and encouraged for social cuts; Apple App Preview cuts must follow Apple's "no marketing copy overlays" rule (real UI only, intro/outro brand bookend allowed).

### Format requirements
- PNG transparent for characters
- PNG dark-background versions where listed
- MP4 video, H.264 preferred
- 9:16 vertical and 16:9 horizontal where listed
- no watermarks, no generated-text errors, no random logos, no existing-IP resemblance
- no fake Apple UI unless it's actual app footage

### Quality bar (any one of these = reject)
- Looks like 2008 clip art
- Memora reads as generic fairy / human / anime girl
- Oc2cO loses the warm creature-like reference energy
- Either character is only a floating head
- Watermark appears
- Text is misspelled
- The two do not read as a married pair from the same world

---

## Visual reference set (canonical — May 2, 2026)

User-supplied reference images live in `artifacts/memtool/assets/brand/references/`. **These are the gold standard for the look.** Any AI prompt or hand illustration must be evaluated against these images. If a generated asset doesn't match this look, it is rejected.

| File | Character | Notes |
|------|-----------|-------|
| `memora-portrait-purple-cosmic.png` | Memora | close-up, purple hoodie, cosmic swirl backdrop |
| `memora-portrait-lavender-ui.png` | Memora | close-up, lavender hoodie, faint UI panel behind |
| `memora-magic-constellation.png` | Memora | hand outstretched, organizing memory sparks into a spiral |
| `memora-tech-hoodie.png` | Memora | techy cyan-circuit hoodie variant |
| `memora-fullbody-podium.png` | Memora | full body, lavender hoodie, glowing podium, UI cards orbiting |
| `oc2co-portrait-yinyang.png` | Oc2cO | close-up, brown hoodie, large golden yin-yang emblem |
| `oc2co-portrait-cosmic-rings.png` | Oc2cO | close-up, brown hoodie, blue + gold cosmic rings backdrop |
| `oc2co-puzzle-cube.png` | Oc2cO | holding a glowing puzzle cube, surrounded by drifting puzzle tiles |
| `oc2co-celebrating-phone.png` | Oc2cO | arms up celebrating in front of an iPhone silhouette |
| `oc2co-fullbody-phone-frame.png` | Oc2cO | full body, brown hoodie, framed by glowing phone outline |

The first AI-generated foundation pass (May 2) did not match these references and has been moved to `assets/brand/_archived_2026-05-02/`.

---

## Where currently-staged art lives (May 2, 2026 baseline)

`artifacts/memtool/assets/brand/` and `artifacts/memtool/assets/games/` each contain:
- `mem-hero-chat.png` (Memora — purple/cyan hooded creature)
- `oc2co-hero.png`, `oc2co-portrait.png`, `oc2co-puzzle.png`, `oc2co-celebrate.png`
- `mem-pic-1..7` (Memora variants from earlier dump)

These are the **current production assets** until the deliverables in the section above land.

---

## How to use this file

- **Task agents:** read this file before producing any prompt, image, video, or character description. The husband/wife relationship is a hard fact — never describe them as siblings.
- **Image / video generation:** copy the relevant character section verbatim into the prompt; do not paraphrase.
- **Code / copy:** never refer to either character as the other's brother, sister, or sibling. The audit run during Task #283 confirmed no such language exists in code today; keep it that way.
- **Adding a new character or asset:** PR this file first.

---

## Voice Cast (locked May 2, 2026 — branded video voiceover)

Every character in the brand universe has a distinct voice with its own
tone, pacing, and emotional register. Voices are generated via OpenAI's
`gpt-audio` model (chat-completions API with `audio` modality). When we
add voice to new videos, app onboarding, or audio markers, **always
match the voice to the character below** — never let voices drift between
characters.

| Character | Role | OpenAI voice | Tone direction | Pace | Caption color |
|-----------|------|--------------|----------------|------|---------------|
| **Memora "Sunshine"** | Wife. Calm cyan signal. The "I'm here" presence. | `nova` | Warm, gentle, reassuring — bedtime-story tone. Slightly playful when she says "sunshine". | Medium-slow (0.95×) | Cyan `#4DD8E6` |
| **Sagous** | Husband. Warm amber spark. The "watch this" energy. | `ash` | Warm, curious, lightly excited — a friend showing you a neat trick. Never frantic. | Medium-fast (1.0–1.05×) | Amber `#FFB85C` |
| **Mem (the AI Guide)** | The in-app guide. Smart wise-friend. | `sage` | Mellow, wise, kind. Thoughtful pauses. Never preachy. | Medium-slow (0.92×) | Lavender `#C4A6FF` |
| **Narrator (Oc2cO voice)** | Closing taglines, brand bookends. | `alloy` | Neutral, gentle, slightly distant — the voice of the homeworld. | Medium (1.0×) | White `#FFFFFF` |

Generation pipeline (reusable for new lines):

```sh
node .local/scripts/generate-character-tts.mjs
# Edit the `clips` array in the script. Outputs MP3 to:
# artifacts/memtool/assets/brand/voice/<name>.mp3
```

Composite + caption pipeline:

```sh
bash .local/scripts/render-voiced-videos.sh
# Edit the script's render_one calls + write_ass calls to add new videos.
# Outputs to artifacts/memtool/assets/brand/<name>-vo.mp4
```

**Cast continuity rules:**

- Memora and Sagous are **husband and wife** — they may finish each other's
  lines but never overlap competitively. When both speak in one shot,
  Memora opens softer, Sagous answers with energy, then they harmonize on
  the closing beat (see brand seg 4).
- Mem is **not** Memora. Mem is the in-app guide voiced separately (lavender
  caption, `sage` voice). If a script has both Memora and Mem, label captions
  clearly so users do not conflate them.
- Oc2cO is **not** a voice — Oc2cO is the homeworld. The Narrator voice
  is the *voice of* the homeworld speaking on behalf of it ("From Oc2cO.
  With heart."). Use sparingly: closing taglines and brand bookends only.

---

## Accessibility doctrine (videos, app, store assets)

> "Smarter, more kind, more caring" — accessibility is not an afterthought,
> it is part of the kindness.

Every brand video, App Preview cut, social teaser, and onboarding clip
**must** ship with all four of the following baked in. No exceptions.

### 1. Burned-in captions (deaf / HoH / autism / quiet-context viewers)

Every line of voiceover gets a burned-in caption with:

- **Character name label** above the line (e.g. `MEMORA`, `SAGOUS`, `MEM`)
  in the character's caption color (see Voice Cast table).
- **Line text** below the label in white, larger font, with a 2px black
  outline + soft shadow so it stays readable on busy backgrounds.
- Both anchored bottom-center with a 90px bottom margin so they clear the
  iPhone home indicator and Instagram/TikTok safe-area overlays.

The reference style block lives in `.local/scripts/render-voiced-videos.sh`
under `write_ass()`. Do not invent ad-hoc caption styles — extend the
helper.

### 2. Voiceover with calm pacing (autism / cognitive disabilities / non-native English)

- Default voice speed is **0.92×–1.05×** depending on character — never
  faster than 1.05×. If a line feels rushed, rewrite the line shorter
  rather than speeding the voice.
- No stacked dialogue (one speaker at a time).
- A minimum **0.3s pause** between speakers when a video has multiple
  voices in one segment.

A **calm-pace alternate** of the brand 30s (further slowed to ~0.85× with
larger captions and extended dwell on every shot) is a planned follow-up
deliverable for cognitive-accessibility users; tracked in the post-launch
backlog.

### 3. Plain-language scripts (cognitive disabilities / non-native English)

- Sentences ≤ 8 words where possible. Two short sentences beat one long one.
- Concrete nouns over abstract ("each evening" not "in the temporal cadence").
- No idioms that require cultural context. "Read your day back to you" is
  fine; "circle the wagons" is not.
- The Mem in-app guide is held to the same bar — see
  `artifacts/memtool/lib/aiGuidePrompts.ts`.

### 4. Visual contrast (low-vision / colorblind viewers)

- Caption text is white on a black-outlined shadow band — passes WCAG AAA
  contrast on every brand background we ship.
- Character caption colors (cyan / amber / lavender) are
  **deuteranopia + protanopia safe** — verified against the
  [Color Brewer](https://colorbrewer2.org) palettes. Never use
  red/green pairs to distinguish characters.
- Important UI elements in screenshots/store assets carry text labels in
  addition to color (icon + label, never icon alone).

### 5. App-side accessibility (in-app, not video — but adjacent)

These are owned by the app code, not the brand bible, but listed here for
cross-reference so the brand team does not contradict them:

- Dynamic Type respected app-wide (`useFontScale` in `lib/typography.ts`).
- VoiceOver labels on every interactive element
  (`accessibilityLabel`/`accessibilityHint` audited per
  `docs/PRELAUNCH_AUDIT_ROUND_4.md`).
- Reduced-motion respected (`useReducedMotion` gate on every animation
  ≥250ms).
- Haptics are an enhancement, never the only feedback — every haptic is
  paired with a visual or auditory cue.

When a future video, store asset, or marketing piece is created and any of
the five doctrines above is missing, **stop the render and fix the
doctrine first**. Shipping inaccessible brand work would contradict the
"more kind, more caring" promise on which the entire universe is built.

