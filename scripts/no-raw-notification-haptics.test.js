/**
 * Guard: no raw Haptics.notificationAsync() outside lib/haptics
 *
 * Context
 * -------
 * MemTool maintains six AHAP verb signatures (capture, link-formed,
 * streak-extended, day-recap-ready, error, undo) in lib/haptics. Raw
 * `Haptics.notificationAsync()` calls bypass those signatures and break
 * the unified haptic feel — previous tasks (#170, #203, #224) each had
 * to manually audit and replace them.
 *
 * What this test enforces
 * -----------------------
 * Any `.ts` / `.tsx` / `.js` / `.jsx` source file **outside** the
 * `lib/haptics` directory must not contain `Haptics.notificationAsync(`.
 *
 * Allowed
 * -------
 * - `Haptics.impactAsync(...)` — micro-feedback for scroll ticks, slider
 *   drags, toggles (already documented inline at each call site).
 * - `Haptics.selectionAsync()` — micro-feedback (same).
 *
 * Escape hatch
 * ------------
 * Two equivalent ways to mark a genuine one-off as auditable:
 *
 * Option A — for files linted by ESLint (app/, components/, context/):
 *   Add the standard lint-suppress comment on the preceding line.
 *   This guard recognises the eslint-disable-next-line pattern and also
 *   silences itself, so contributors only need one marker:
 *
 *     // eslint-disable-next-line no-restricted-syntax
 *     Haptics.notificationAsync(...); // explain why here
 *
 * Option B — for files outside ESLint scope (other lib/ subdirs):
 *   Add the haptics-escape-hatch marker inline on the same line:
 *
 *     Haptics.notificationAsync(...); // haptics-escape-hatch — explain why
 *
 * Both options surface in code review so genuine exceptions are auditable.
 */

const fs = require("fs");
const path = require("path");

const MEMTOOL_ROOT = path.resolve(__dirname, "..");

const EXEMPT_DIR = path.join(MEMTOOL_ROOT, "lib", "haptics");

const SEARCH_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".expo",
  "build",
  "dist",
  "vendor",
  ".git",
]);

// Files that legitimately reference the banned token in strings/comments
// (lint configs, guard tests) — not actual call sites.
const SKIP_FILES = new Set([
  path.join(MEMTOOL_ROOT, ".eslintrc.js"),
  path.join(MEMTOOL_ROOT, "scripts", "no-raw-notification-haptics.test.js"),
]);

const BANNED_PATTERN = /Haptics\.notificationAsync\s*\(/;
const ESCAPE_HATCH_MARKER = "haptics-escape-hatch";

function collectSourceFiles(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(path.join(dir, entry.name), files);
    } else if (entry.isFile()) {
      if (SEARCH_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  return files;
}

function isExempt(filePath) {
  const rel = path.relative(EXEMPT_DIR, filePath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

describe("haptics vocabulary guard", () => {
  test("no raw Haptics.notificationAsync() calls outside lib/haptics", () => {
    const allFiles = collectSourceFiles(MEMTOOL_ROOT);
    const violations = [];

    for (const filePath of allFiles) {
      if (isExempt(filePath)) continue;
      if (SKIP_FILES.has(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!BANNED_PATTERN.test(line)) continue;
        // Option A: eslint-disable-next-line on the preceding line
        const prevLine = i > 0 ? lines[i - 1] : "";
        const hasEslintDisable =
          prevLine.includes("eslint-disable-next-line") &&
          prevLine.includes("no-restricted-syntax");
        // Option B: inline haptics-escape-hatch marker
        const hasInlineMarker = line.includes(ESCAPE_HATCH_MARKER);
        if (!hasEslintDisable && !hasInlineMarker) {
          violations.push(
            `  ${path.relative(MEMTOOL_ROOT, filePath)}:${i + 1}\n    ${line.trim()}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        [
          `Found ${violations.length} raw Haptics.notificationAsync() call(s) outside lib/haptics.`,
          "",
          "Use a named verb hook instead:",
          "  const haptic = useHaptic('capture');   haptic();",
          "  const { play } = useHaptics();         play('error');",
          "",
          "See lib/haptics/index.ts for the full verb vocabulary.",
          "",
          "To allow a genuine one-off (both are auditable in code review):",
          "  Option A (ESLint-linted files — app/, components/, context/):",
          "    // eslint-disable-next-line no-restricted-syntax",
          "    Haptics.notificationAsync(...); // explain why",
          "  Option B (other lib/ subdirs outside ESLint scope):",
          "    Haptics.notificationAsync(...); // haptics-escape-hatch — explain why",
          "",
          "Violations:",
          ...violations,
        ].join("\n"),
      );
    }
  });
});
