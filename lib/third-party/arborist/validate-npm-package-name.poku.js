import { assert, describe, it } from "poku";

import validate from "./lib/validate-npm-package-name.js";

// Expectations come from the published validate-npm-package-name test suite,
// updated to the 8.x wording for the exclusion list. The two booleans are the
// only fields package-extensions.js reads, but the whole result shape is
// asserted so a divergence from the published package shows up here.
describe("validate-npm-package-name", () => {
  it("accepts traditional names", () => {
    for (const name of [
      "some-package",
      "example.com",
      "under_score",
      "period.js",
      "123numeric",
      "@npm/thingy",
    ]) {
      assert.deepStrictEqual(
        validate(name),
        { validForNewPackages: true, validForOldPackages: true },
        name,
      );
    }
  });

  it("warns about names that are no longer publishable", () => {
    assert.deepStrictEqual(validate("crazy!"), {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: ['name can no longer contain special characters ("~\'!()*")'],
    });
    assert.deepStrictEqual(validate("@npm-zors/money!time.js"), {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: ['name can no longer contain special characters ("~\'!()*")'],
    });
    assert.deepStrictEqual(validate("CAPITAL-LETTERS"), {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: ["name can no longer contain capital letters"],
    });
    assert.deepStrictEqual(validate("http"), {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: ["http is a core module name"],
    });
  });

  it("applies the 214 character limit as a warning", () => {
    const atLimit = "a".repeat(214);
    assert.deepStrictEqual(validate(atLimit), {
      validForNewPackages: true,
      validForOldPackages: true,
    });
    assert.deepStrictEqual(validate(`${atLimit}a`), {
      validForNewPackages: false,
      validForOldPackages: true,
      warnings: ["name can no longer contain more than 214 characters"],
    });
  });

  it("rejects names that were never valid", () => {
    const cases = [
      ["", ["name length must be greater than zero"]],
      [".start-with-period", ["name cannot start with a period"]],
      ["-start-with-hyphen", ["name cannot start with a hyphen"]],
      ["_start-with-underscore", ["name cannot start with an underscore"]],
      ["contain:colons", ["name can only contain URL-friendly characters"]],
      [
        " leading-space",
        [
          "name cannot contain leading or trailing spaces",
          "name can only contain URL-friendly characters",
        ],
      ],
      [
        "trailing-space ",
        [
          "name cannot contain leading or trailing spaces",
          "name can only contain URL-friendly characters",
        ],
      ],
      ["s/l/a/s/h/e/s", ["name can only contain URL-friendly characters"]],
      ["node_modules", ["node_modules is not a valid package name"]],
      ["favicon.ico", ["favicon.ico is not a valid package name"]],
    ];
    for (const [name, errors] of cases) {
      assert.deepStrictEqual(
        validate(name),
        {
          validForNewPackages: false,
          validForOldPackages: false,
          errors,
        },
        name,
      );
    }
  });

  it("rejects non-string input without throwing", () => {
    assert.deepStrictEqual(validate(null), {
      validForNewPackages: false,
      validForOldPackages: false,
      errors: ["name cannot be null"],
    });
    assert.deepStrictEqual(validate(undefined), {
      validForNewPackages: false,
      validForOldPackages: false,
      errors: ["name cannot be undefined"],
    });
    assert.deepStrictEqual(validate(42), {
      validForNewPackages: false,
      validForOldPackages: false,
      errors: ["name must be a string"],
    });
  });
});
