# EAS Environment Variable Notes

This document records intent for sensitive or non-obvious environment
variable values configured in `artifacts/memtool/eas.json`. It exists so
that future config edits don't accidentally replace a deliberately
chosen production value with a development URL.

## `EXPO_PUBLIC_REPLIT_API_BASE_URL`

- **Production value:** `https://memtool.replit.app`
- **Status:** Confirmed intentional by Steven on 2026-05-03.
- **What it is:** The production API host used by the MemTool Expo app
  for Replit-hosted backend endpoints. It is consumed in
  `artifacts/memtool/app/_layout.tsx` (and elsewhere) via
  `process.env.EXPO_PUBLIC_REPLIT_API_BASE_URL`.
- **Why it looks like a Replit free-tier domain:** It is the project's
  Replit Deployment URL. This is the deliberate production host; do not
  replace it with a development URL or a localhost tunnel.
- **If you need to change it:** Confirm with Steven first and update
  both the `preview` and `production` `env` blocks in `eas.json`, plus
  this document.

## `EXPO_PUBLIC_AUTH_API_BASE_URL`

- **Production value:** `https://oc2coos-2.polsia.app/api/memtool`
- Polsia-owned domain used for authentication endpoints. Leave as-is
  unless the auth backend host changes.
