# Pre-Launch Readiness Audit

A single command that runs a full pre-launch readiness audit and prints a
categorized Markdown report — so anyone (or any CI agent) can verify the
launch checklist on demand and catch issues before submission.

---

## How to run

```sh
pnpm --filter @workspace/memtool run audit:prelaunch
```

The script:

1. Runs all checks (takes ~30–120 s depending on the test suite).
2. Prints a Markdown report to stdout.
3. Writes a copy to `artifacts/memtool/docs/PRELAUNCH_AUDIT_LATEST.md`.
4. **Exits non-zero** if any check has `FAIL` status (suitable for CI gating).

---

## What is checked

The audit covers seven categories. Each check reports one of three statuses.

### Status meanings

| Status | Meaning |
|--------|---------|
| ✅ PASS | Check passed — nothing to do. |
| ⚠️  WARN | Potential issue worth reviewing before submitting; not a hard blocker. |
| ❌ FAIL | Hard blocker — must be resolved before submission. The script exits non-zero when any FAIL is present. |

### Categories

#### 1. Submit Blockers

Checks that must be green before running `eas submit`:

| Check | What it verifies |
|-------|-----------------|
| ASC API key file present | `.asc-keys/AuthKey_7XBJCGMS4R.p8` exists on disk (never committed — re-download from ASC if missing). |
| `.env.example` documents required env vars | All of `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`, `METRICS_SHARED_SECRET`, `EXPO_PUBLIC_REPLIT_API_BASE_URL`, `EXPO_PUBLIC_AUTH_API_BASE_URL` are documented. (MemTool ships iOS-only — no Android key.) |
| `app.json` icon asset exists | `expo.icon` path resolves to a non-empty file on disk. |
| `app.json` splash asset exists | `expo.splash.image` path resolves to a non-empty file on disk. |
| `app.json` is iOS-only (no `expo.android` block) | Hard-fails if an `expo.android` block reappears in `app.json` — MemTool ships iOS-only. |
| `privacyManifests` block present | `expo.ios.privacyManifests` block is in `app.json` (required by Apple since spring 2024). |

#### 2. Dead-Link / Orphan-Route Detection

| Check | What it verifies |
|-------|-----------------|
| All `router.push`/`href` targets resolve | Every string route target found in `.tsx`/`.ts` source files maps to a real file under `app/(app)/` or `app/`. Dynamic segments (`[id]`) are skipped. |
| Dev-only debug screens are not routable | For each formerly routable dev path (`/foundation-models-spike`, `/haptics-debug`), confirms the path is absent from the route map (`buildKnownRoutes`) and is not the target of any `router.push`/`href` call in source. The screens now live under `app/(app)/_dev/` — expo-router's `_`-prefixed folders are non-routes, so they're excluded from the route map in every build profile. FAILs with file-level remediation guidance if either path reappears as a route or as a navigation target. |

#### 3. Stale Copy / TODO Scan

Walks all `.tsx`/`.ts` source files (excluding test files and comment-only
lines) for patterns that indicate unfinished user-facing copy:

- `"coming soon"` (case-insensitive)
- `"your-backend.example.com"`
- `"TBD"` (exact word boundary)
- `"placeholder"` (case-insensitive)

WARNs rather than FAILs — some of these may be intentional (e.g. in a
comment that explains a future feature). Review each hit before dismissing.

#### 4. Asset Reference Integrity

| Check | What it verifies |
|-------|-----------------|
| `require("./assets/...")` calls resolve | Every relative asset import in source files resolves to a real file on disk. |
| `@/assets/...` imports resolve | Every `@/assets/` import resolves. |
| No zero-byte files in `assets/images` or `assets/brand` | Catches placeholder files that got committed without content. |

#### 5. Store-Listing Completeness

| Check | What it verifies |
|-------|-----------------|
| App Store: no gap/TODO markers | `app-store/STORE_LISTING.md` contains no `"Known gap"`, `"TODO"`, `"TBD"`, or `"to be added"` markers. |
| App Store: required screenshots present | All 6 RGB screenshots in `app-store/assets/screenshots-marketing/` exist. |

(MemTool ships iOS-only — there is no Play Store listing check.)

#### 6. Client-Server Contract

| Check | What it verifies |
|-------|-----------------|
| OpenAPI codegen up-to-date | Runs `pnpm exec orval --config ./orval.config.ts` (the generation step), then runs `git diff --name-only` against both `lib/api-client-react/src/` and `lib/api-zod/src/`. FAILs with the file list if any generated file changed; PASSes if there is no diff — proving the committed output matches the current spec. |
| Raw `fetch()` calls in `lib/` | Dynamically scans every `lib/**/*.ts` (non-test) file for raw `fetch()` calls that bypass the generated API hooks. Reports each file and line number for manual review. |

#### 7. Account Deletion E2E

Runs `pnpm --filter @workspace/scripts run e2e:delete-account`, which is a
live end-to-end check of the GDPR-critical "delete my account" flow:

1. Registers a throwaway account against the Polsia auth gateway.
2. Signs in with the new credentials.
3. Calls `DELETE /api/auth/account` on the api-server.
4. Confirms a token-protected api-server route now returns 401 (local data + session gone).
5. Confirms a fresh login attempt with the same credentials returns 401 — i.e. the upstream Polsia identity record is verifiably gone.

Step 5 is the one unit tests can't reproduce: it catches a regression where
the api-server silently swallows or skips the upstream DELETE.

| Env var | Purpose |
|---------|---------|
| `SKIP_E2E_DELETE_ACCOUNT=1` | Skip the check (downgrades to WARN). Use for offline / air-gapped CI. |
| `E2E_AUTH_API_BASE` | Override the Polsia auth base URL (e.g. point at staging). Default: production. |
| `E2E_REPLIT_API_BASE` | Override the api-server base URL. Default: production. |
| `E2E_EMAIL_DOMAIN` | Email domain for the throwaway account. Default: `example.com`. |

#### 8. Test Coverage Signal

Runs `pnpm --filter @workspace/memtool run test` and surfaces:

- Number of passing / failing / skipped tests.
- Names of any failing test suites.

FAILs if any test fails; WARNs if tests are skipped.

#### 8. Stripe Upgrade E2E

Drives a real Stripe test-mode checkout against the configured Polsia
gateway and asserts that `/subscription/status` flips `is_pro` to
`true`. Catches regressions that the `upgradeFlow.test.ts` mocks
cannot — webhook stops landing, response shape drifts between
`url`/`checkout_url`/`checkoutUrl`, gateway returns 502s.

Opt-in via `RUN_STRIPE_E2E=1` (the probe takes ~30–90 s and depends on
network egress to `checkout.stripe.com`). Pre-launch / staging runs
set the env var; local runs leave it off, in which case the check is
recorded as a WARN with a "skipped — set RUN_STRIPE_E2E=1" detail so
reviewers can see the gate wasn't exercised.

When opted in:

- PASS — `is_pro` confirmed within the poll budget.
- WARN — gateway returned `STRIPE_NOT_CONFIGURED` (probe exit 2);
  the rail isn't wired in this environment.
- FAIL — register/checkout/status call failed, the Stripe page
  rejected the card, or `is_pro` never flipped.

The probe lives at `scripts/src/e2eStripeUpgrade.ts` and can be run
directly with `pnpm --filter @workspace/scripts run e2e:stripe-upgrade`.

---

## Interpreting the report

- The report opens with a summary table (PASS / WARN / FAIL counts).
- Each category follows with a one-row-per-check table.
- Multi-line FAIL and WARN details are expanded below the table for readability.
- The latest report is always at `artifacts/memtool/docs/PRELAUNCH_AUDIT_LATEST.md`.
  Commit it after each audit run to track history.

---

## Wiring into CI

The script is designed to be runnable in any environment where `pnpm` and
`Node.js` are available. To add it to a GitHub Actions workflow:

```yaml
# .github/workflows/prelaunch-audit.yml
name: Pre-launch Readiness Audit

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Run pre-launch audit
        run: pnpm --filter @workspace/memtool run audit:prelaunch
      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: prelaunch-audit-report
          path: artifacts/memtool/docs/PRELAUNCH_AUDIT_LATEST.md
```

The job fails the PR if any check returns FAIL. The uploaded artifact lets
reviewers read the full report without digging through logs.

> **Note:** The ASC API key (`.asc-keys/AuthKey_7XBJCGMS4R.p8`) is never
> committed. In CI, either skip that check or provide the key as a secret and
> write it to the expected path in a pre-step.

---

## Adding new checks

1. Open `artifacts/memtool/scripts/audit-prelaunch.ts`.
2. Add a function returning `CheckResult[]` following the existing pattern
   (`pass(name, detail)` / `warn(name, detail)` / `fail(name, detail)`).
3. Add its result array to the `categories` list in `main()`.
4. Re-run the audit to verify the new check appears in the report.

Each check should be a pure, deterministic function with no side effects.
The test runner call in Category 7 is the only exception.
