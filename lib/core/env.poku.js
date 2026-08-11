import { assert, it } from "poku";

import { parseMavenArgs } from "../ecosystems/utils.js";

it("parse maven args", () => {
  assert.deepStrictEqual(
    parseMavenArgs(
      '--settings "/tmp/path with spaces/settings.xml" -P dev,test -DskipTests',
    ),
    [
      "--settings",
      "/tmp/path with spaces/settings.xml",
      "-P",
      "dev,test",
      "-DskipTests",
    ],
  );
  assert.deepStrictEqual(
    parseMavenArgs(String.raw`-s C:\Users\me\settings.xml -Dpath=C:\repo\demo`),
    [
      "-s",
      String.raw`C:\Users\me\settings.xml`,
      String.raw`-Dpath=C:\repo\demo`,
    ],
  );
  assert.deepStrictEqual(parseMavenArgs(String.raw`-Dname=hello\ world`), [
    "-Dname=hello world",
  ]);
});

// Restored from the retired lib/helpers/core-misc-b.poku.js, which was
// deleted along with its module during the v13 layer reorganisation even though
// the functions under test only moved.

import {
  hasAnyProjectType,
  isPackageManagerAllowed,
  PROJECT_TYPE_ALIASES,
  shouldRunPredictiveBomAudit,
} from "./env.js";

it("hasAnyProjectType tests", () => {
  for (const language of ["vb", "vbnet", "visualbasic", "f#", "fs", "fsharp"]) {
    assert.ok(PROJECT_TYPE_ALIASES.csharp.includes(language));
  }

  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: [],
      excludeType: ["oci"],
    }),
    false,
  );
  assert.deepStrictEqual(hasAnyProjectType([], {}), true);
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["java"] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["java"], excludeType: [] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["csharp"] }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["java"], { projectType: ["csharp", "rust"] }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], { projectType: ["csharp", "rust"] }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["csharp", "rust"],
      excludeType: [],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["csharp", "rust"],
      excludeType: ["rust"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["java", "docker"],
      excludeType: ["dotnet"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["docker"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: ["oci"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: ["rootfs"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: ["rootfs"],
      excludeType: undefined,
    }),
    true,
  );

  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: [],
      excludeType: ["rust"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: undefined,
      excludeType: ["csharp"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: ["csharp"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["rust"], {
      projectType: ["universal"],
      excludeType: ["docker"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: ["csharp", "javascript"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["js", "docker"],
      excludeType: ["js", "docker"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: ["js"],
      excludeType: ["js"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["oci"],
      {
        projectType: [],
        excludeType: [],
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["oci", "docker"],
      {
        projectType: undefined,
        excludeType: undefined,
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js", "docker"], {
      projectType: ["universal"],
      excludeType: [],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["js"], {
      projectType: ["universal"],
      excludeType: ["js"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["universal"], {
      projectType: undefined,
      excludeType: ["github"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci"], {
      projectType: undefined,
      excludeType: ["github"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["os"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["docker"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "java"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "ear"], {
      projectType: undefined,
      excludeType: ["jar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["docker", "oci", "container", "os"],
      {
        projectType: undefined,
        excludeType: ["github"],
      },
      false,
    ),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["ruby2.5.4"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["rb"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(
      ["ruby"],
      {
        projectType: ["ruby3.4.1", "ruby2.5.4"],
        excludeType: undefined,
      },
      false,
    ),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["oci", "js"], {
      projectType: ["javascript"],
      excludeType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: [],
      excludeType: ["asar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: undefined,
      excludeType: ["electron"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["electron"], {
      projectType: [],
      excludeType: ["asar"],
    }),
    false,
  );
  assert.deepStrictEqual(
    hasAnyProjectType(["asar"], {
      projectType: [],
      excludeType: ["java"],
    }),
    true,
  );
});

it("shouldRunPredictiveBomAudit tests", () => {
  assert.strictEqual(shouldRunPredictiveBomAudit({}, "cdxgen"), true);
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["linux"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os", "darwin"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["os", "js"] }, "cdxgen"),
    true,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: "os,linux" }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["hbom"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["hardware"] }, "cdxgen"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["js"] }, "obom"),
    false,
  );
  assert.strictEqual(
    shouldRunPredictiveBomAudit({ projectType: ["js"] }, "hbom"),
    false,
  );
});

it("isPackageManagerAllowed tests", () => {
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: undefined,
    }),
    true,
  );
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: ["python"],
    }),
    true,
  );
  assert.deepStrictEqual(
    isPackageManagerAllowed("uv", ["pip", "poetry", "hatch", "pdm"], {
      projectType: ["pip"],
    }),
    false,
  );
});
