import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "poku";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

describe("workspace boundary enforcement", () => {
  it("all imports respect declared package boundaries", () => {
    const result = execSync("node contrib/check-boundaries.js --json", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const data = JSON.parse(result);

    if (data.count > 0) {
      const details = data.violations
        .map((v) => `  ${v.file}: ${v.import} (${v.rule})`)
        .join("\n");
      assert.fail(`${data.count} boundary violation(s):\n${details}`);
    }

    assert.strictEqual(data.count, 0);
  });

  it("every workspace package is private", () => {
    const packages = [
      "helpers",
      "parsers",
      "managers",
      "stages",
      "cli",
      "evinser",
      "server",
      "validator",
      "audit",
      "third-party",
    ];

    for (const pkg of packages) {
      const pkgJson = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "packages", pkg, "package.json"),
          "utf-8",
        ),
      );
      assert.strictEqual(
        pkgJson.private,
        true,
        `packages/${pkg}/package.json must be private`,
      );
    }
  });

  it("every package test script targets a dir that actually has tests", () => {
    // A test script pointing at a path poku cannot resolve exits 0 having run
    // nothing, so `pnpm -r test` would report a vacuous green. Assert the
    // target directory exists and contains at least one .poku.js file.
    const packages = [
      "helpers",
      "parsers",
      "managers",
      "stages",
      "cli",
      "evinser",
      "server",
      "validator",
      "audit",
    ];

    for (const pkg of packages) {
      const pkgJson = JSON.parse(
        readFileSync(
          path.join(REPO_ROOT, "packages", pkg, "package.json"),
          "utf-8",
        ),
      );
      const script = pkgJson.scripts?.test;
      assert.ok(script, `packages/${pkg} must declare a test script`);

      const target = script.trim().split(/\s+/).pop();
      const targetDir = path.join(REPO_ROOT, target);
      assert.ok(
        existsSync(targetDir),
        `packages/${pkg} test script targets missing dir: ${target}`,
      );

      const found = execSync(
        `find ${JSON.stringify(targetDir)} -name "*.poku.js"`,
        { encoding: "utf-8" },
      )
        .split("\n")
        .filter(Boolean);
      assert.ok(
        found.length > 0,
        `packages/${pkg} test script targets ${target} which contains no .poku.js files — it would pass vacuously`,
      );
    }
  });

  it("only @cyclonedx/cdxgen is publishable", () => {
    const rootPkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
    );
    assert.strictEqual(rootPkg.name, "@cyclonedx/cdxgen");
    assert.notStrictEqual(rootPkg.private, true);
  });
});
