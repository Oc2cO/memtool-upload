# App Store Connect — App Preview videos

Apple allows up to **three** App Preview videos per device class on each
app's App Store listing. They autoplay (muted) in App Store search
results and on the product page, so they're the single most valuable
piece of marketing media on the listing.

MemTool ships **iOS-only**. Only the iPhone 6.7" device class is
populated; Apple downscales 6.7" previews for smaller iPhone classes
automatically and we don't ship to iPad.

## Files (upload in this order)

| # | Filename                              | Story beat                                                  |
|---|---------------------------------------|-------------------------------------------------------------|
| 1 | `iphone-6.7/01-capture-and-recap.mp4` | Home scroll → Capture (live typing) → Recap → switch to "Past 30 days" heatmap |
| 2 | `iphone-6.7/02-mem-ai-guide.mp4`      | Home → AI Guide thread (slow scroll through Mem ⇄ Memora exchange) → user types a follow-up |
| 3 | `iphone-6.7/03-illustrate-a-moment.mp4` | Archive polaroid pan → AI Guide hero close             |

## Hard requirements (App Store Connect rejects on mismatch)

- **Container:** MP4 (`-f mp4`)
- **Video codec:** H.264 (`-c:v libx264`)
- **Audio:** **none** (`-an`) — voiceover is not used; Apple still
  accepts silent previews
- **Frame size:** **886 × 1920** (portrait, the App Store Connect
  iPhone 6.7" preview spec — 1080 × 1920 is also accepted)
- **Frame rate:** 30 fps
- **Pixel format:** `yuv420p` (Apple validator rejects `yuv444p`)
- **Duration:** ≤ **30 s** per file (current set is 21.9 – 28.0 s)
- **Faststart:** `-movflags +faststart` so the moov atom is at the
  front of the file and the App Store player can start immediately

## Regen command

The previews are now **screen-recorded from the live Expo web build**
rather than composited from still images. A Playwright script
(`scripts/src/capture-app-preview-videos.mjs`) drives the running
MemTool app at the Apple-required 886 × 1920 portrait viewport,
scripts a real interaction sequence per storyboard (navigation,
typing into the capture surface, switching the recap heatmap range,
scrolling the AI Guide thread, panning the archive polaroids), and
records each pass through Playwright's `recordVideo` API. The
captured WebM is then transcoded to App Store-compliant H.264 MP4
with `ffmpeg` (886 × 1920, yuv420p, 30 fps, no audio, `+faststart`,
hard-capped to 28 s so we stay safely under Apple's 30 s ceiling).

Prereqs:
1. The MemTool Expo workflow must be running and reachable at
   `http://localhost:80/` — restart `artifacts/memtool: expo` if
   needed.
2. Playwright's Chromium must be installed (`pnpm --filter
   @workspace/scripts exec playwright install chromium` once per
   environment).

Then run from the workspace root:

```sh
pnpm --filter @workspace/scripts run capture-app-previews
```

The script writes intermediate WebM under
`.tmp/app-preview-recordings/` and the final MP4s straight to
`artifacts/memtool/app-store/assets/app-previews/iphone-6.7/`,
overwriting the previous set. Backend calls are stubbed in-process
the same way the screenshot script stubs them, so no live API or
RevenueCat call is required for capture.

The previous still-image cross-fade recipe is preserved in git
history if you ever need to fall back to a deterministic, no-server
build.

## Verifying the output

```sh
for v in artifacts/memtool/app-store/assets/app-previews/iphone-6.7/*.mp4; do
  ffprobe -v error -show_entries stream=width,height,codec_name,duration \
    -of default=noprint_wrappers=1 "$v"
  echo "---"
done
```

Each file must report `codec_name=h264`, `width=886`, `height=1920`,
and `duration ≤ 30.0`. ASC's upload validator enforces the same
constraints — failing this check locally guarantees a failed upload.
