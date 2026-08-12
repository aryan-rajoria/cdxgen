// CI-friendly wrapper around vendor-arborist.mjs --check.
//
// Verifies that `lib/third-party/arborist` still matches what
// contrib/vendor-arborist.mjs generates, which is what stops the vendored tree
// from being hand-edited.  The check reads upstream module contents from a
// checkout of the npm CLI monorepo, so it is skipped when one is not
// configured.  What runs unconditionally, including in CI, is the guard test
// (lib/third-party/arborist-guard.poku.js): it verifies every vendored file
// against the digests in contrib/arborist-manifest.json, which needs no
// checkout.  This wrapper is the stronger check — it re-derives the tree from
// upstream rather than comparing it to a recorded digest.
//
// Configuration:
//   CDXGEN_ARBORIST_CHECKOUT — path to a checkout of https://github.com/npm/cli
//   CDXGEN_ARBORIST_REF      — git ref to generate from; defaults to the commit
//                              pinned in contrib/arborist-manifest.json

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "arborist-manifest.json"),
    "utf8",
  ),
);

const checkout = process.env.CDXGEN_ARBORIST_CHECKOUT;
const ref = process.env.CDXGEN_ARBORIST_REF || manifest.commit;

if (!checkout) {
  console.warn(
    "vendor-arborist check skipped: CDXGEN_ARBORIST_CHECKOUT is not set.\n" +
      "Point it at a checkout of https://github.com/npm/cli to enable.\n" +
      "The guard test (arborist-guard.poku.js) remains enforced.",
  );
  process.exit(0);
}

if (!existsSync(path.join(checkout, ".git"))) {
  console.error(
    `vendor-arborist check failed: ${checkout} is not a git checkout.`,
  );
  process.exit(1);
}

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vendor-arborist.mjs",
);

try {
  execFileSync(
    process.execPath,
    [script, "--from", checkout, "--ref", ref, "--check"],
    { stdio: "inherit" },
  );
} catch {
  process.exit(1);
}
