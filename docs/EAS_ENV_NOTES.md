# EAS Environment Variable Notes

This document records intent for sensitive or non-obvious environment
variable values configured in `eas.json`. It exists so that future
config edits don't accidentally replace a deliberately chosen
production value with a development URL.

**Updated 2026-07-09** — Grok MemTool swarm + FORK_HANDOFF cutover:
production API host is `mem-tool.polsia.app` (not `oc2coos-2.polsia.app`).

## `EXPO_PUBLIC_AUTH_API_BASE_URL`

- **Production value:** `https://mem-tool.polsia.app/api/memtool`
- **What it is:** Polsia JWT MemTool gateway (auth, sync, recap, AI guide, etc.).
- **Consumed by:** `lib/config.ts` → `resolveAuthApiBase()` → `lib/auth.ts` `authFetch`.
- **Fallback constant:** `FALLBACK_AUTH_API_BASE` in `lib/config.ts` (same host).

## `EXPO_PUBLIC_REPLIT_API_BASE_URL`

- **Production value:** `https://mem-tool.polsia.app/api/memtool`
- **Status:** Pointed at the same MemTool API host as auth (unified Polsia deploy).
  Historical name says "Replit"; raw-fetch modules (`accountApi`, illustrations,
  profile, streak, etc.) still join paths relative to this base.
- **If you need to change it:** Update both `preview` and `production` `env`
  blocks in `eas.json`, both `FALLBACK_*` constants in `lib/config.ts`,
  `app.json` expo-router `origin`, legal fallbacks in `lib/legal.ts`, and this doc.

## Do not use

- `https://oc2coos-2.polsia.app` — wrong service for MemTool JWT API (swarm probe 2026-07-09).
- `https://memtool.replit.app` — retired Replit deploy (docs only).
