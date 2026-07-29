import { assert, it } from "poku";

import { parseMavenArgs } from "./utils.js";

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
