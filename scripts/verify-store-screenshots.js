#!/usr/bin/env node
/**
 * Repo guard: every PNG staged for the App Store Connect 6.7" iPhone
 * display slot must be exactly 1290x2796. Apple's upload validator
 * rejects mismatched dimensions silently at submission time, so we
 * fail the same PR that introduces a stale or accidentally-resized
 * capture rather than discovering it during the actual submission.
 *
 * Wired into `package.json` as `verify:store-screenshots` and chained
 * into the standard `typecheck` script so PRs are blocked before merge.
 */

const fs = require("fs");
const path = require("path");

const REQUIRED_WIDTH = 1290;
const REQUIRED_HEIGHT = 2796;
const SCREENSHOTS_DIR = path.resolve(
  __dirname,
  "..",
  "assets",
  "store-screenshots",
  "iphone-6.7",
);
const EXPECTED_FILENAMES = [
  "01-home.png",
  "02-capture.png",
  "03-archive.png",
  "04-recap.png",
  "05-ai-guide.png",
  "06-paywall.png",
];
const EXPECTED_FILENAME_PATTERN = /^0[1-6]-.+\.png$/;

const failures = [];

function fail(message) {
  failures.push(message);
}

function relativeToRoot(p) {
  return path.relative(path.resolve(__dirname, ".."), p);
}

// Read the IHDR chunk from a PNG to recover (width, height) without
// pulling in a third-party image library. PNG signature is 8 bytes,
// then a 4-byte chunk length, 4-byte chunk type ("IHDR"), then the
// IHDR payload starts with a big-endian uint32 width and uint32 height.
function readPngDimensions(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, header, 0, 24, 0);
    if (bytesRead < 24) {
      throw new Error("file is shorter than a PNG IHDR chunk");
    }
    const signature = header.subarray(0, 8);
    const expectedSig = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (!signature.equals(expectedSig)) {
      throw new Error("not a PNG (bad signature)");
    }
    const chunkType = header.subarray(12, 16).toString("ascii");
    if (chunkType !== "IHDR") {
      throw new Error("first chunk is " + chunkType + ", expected IHDR");
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    return { width, height };
  } finally {
    fs.closeSync(fd);
  }
}

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  console.error(
    "[verify-store-screenshots] FAIL: expected screenshots directory at " +
      relativeToRoot(SCREENSHOTS_DIR) +
      " but it is missing.",
  );
  process.exit(1);
}

const presentFiles = new Set(
  fs
    .readdirSync(SCREENSHOTS_DIR)
    .filter((name) => EXPECTED_FILENAME_PATTERN.test(name)),
);

for (const expected of EXPECTED_FILENAMES) {
  if (!presentFiles.has(expected)) {
    fail(
      "missing required screenshot " +
        expected +
        " (expected at " +
        relativeToRoot(path.join(SCREENSHOTS_DIR, expected)) +
        ")",
    );
  }
}

const filesToCheck = Array.from(presentFiles).sort();
for (const name of filesToCheck) {
  const fullPath = path.join(SCREENSHOTS_DIR, name);
  let dims;
  try {
    dims = readPngDimensions(fullPath);
  } catch (err) {
    fail(
      relativeToRoot(fullPath) +
        ": could not read PNG dimensions (" +
        (err && err.message ? err.message : String(err)) +
        ")",
    );
    continue;
  }
  if (dims.width !== REQUIRED_WIDTH || dims.height !== REQUIRED_HEIGHT) {
    fail(
      relativeToRoot(fullPath) +
        ": dimensions are " +
        dims.width +
        "x" +
        dims.height +
        " but App Store Connect requires exactly " +
        REQUIRED_WIDTH +
        "x" +
        REQUIRED_HEIGHT +
        " for 6.7\" iPhone display screenshots.",
    );
  }
}

if (failures.length > 0) {
  console.error("[verify-store-screenshots] FAIL:");
  for (const msg of failures) {
    console.error("  - " + msg);
  }
  console.error(
    "\nFix or recapture the offending PNGs (see " +
      relativeToRoot(path.join(SCREENSHOTS_DIR, "README.md")) +
      ") and re-run `pnpm --filter @workspace/memtool run verify:store-screenshots`.",
  );
  process.exit(1);
}

console.log(
  "[verify-store-screenshots] OK: all " +
    EXPECTED_FILENAMES.length +
    " App Store 6.7\" PNGs are present and exactly " +
    REQUIRED_WIDTH +
    "x" +
    REQUIRED_HEIGHT +
    ".",
);
