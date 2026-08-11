import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { assert, describe, it } from "poku";

import { createJavaBom } from "./jvmBom.js";

describe("jvmBom", () => {
  it("does not interpret shell metacharacters in Maven module paths", async () => {
    if (process.platform === "win32") {
      return;
    }
    const tempDir = mkdtempSync(join(tmpdir(), "cdxgen-maven-shell-"));
    const fakeBinDir = join(tempDir, "bin");
    const repoDir = join(tempDir, "repo");
    const markerFile = join(tmpdir(), "CDXGEN_GITURL_E2E_MARKER_TEST");
    const shellIfs = "$" + "{IFS}";
    const maliciousDirName = `evil;cd${shellIfs}..;cd${shellIfs}..;printf${shellIfs}CDXGEN_MAVEN_GIT_URL_E2E_SHELL_INJECTION>CDXGEN_GITURL_E2E_MARKER_TEST;#`;
    const maliciousModuleDir = join(repoDir, maliciousDirName);
    const originalPath = process.env.PATH;
    const originalMvnCmd = process.env.MVN_CMD;
    const originalMavenCmd = process.env.MAVEN_CMD;
    const originalMvnArgs = process.env.MVN_ARGS;

    try {
      rmSync(markerFile, { force: true });
      mkdirSync(fakeBinDir, { recursive: true });
      mkdirSync(maliciousModuleDir, { recursive: true });
      writeFileSync(
        join(maliciousModuleDir, "pom.xml"),
        "<project><modelVersion>4.0.0</modelVersion><groupId>org.example</groupId><artifactId>evil</artifactId><version>1.0.0</version></project>",
      );
      writeFileSync(join(maliciousModuleDir, "settings.xml"), "<settings />");
      const fakeMvn = join(fakeBinDir, "mvn");
      writeFileSync(
        fakeMvn,
        `#!/bin/sh
for arg do
case "$arg" in
  -DoutputFile=*)
    output="\${arg#-DoutputFile=}"
    mkdir -p "$(dirname "$output")"
    printf 'org.example:evil:jar:1.0.0:compile\\n' > "$output"
    ;;
esac
done
`,
      );
      chmodSync(fakeMvn, 0o755);
      process.env.PATH = `${fakeBinDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`;
      delete process.env.MVN_CMD;
      delete process.env.MAVEN_CMD;
      delete process.env.MVN_ARGS;

      await createJavaBom(repoDir, {
        multiProject: true,
        projectType: ["java"],
        specVersion: 1.6,
      });

      assert.strictEqual(existsSync(markerFile), false);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalMvnCmd === undefined) {
        delete process.env.MVN_CMD;
      } else {
        process.env.MVN_CMD = originalMvnCmd;
      }
      if (originalMavenCmd === undefined) {
        delete process.env.MAVEN_CMD;
      } else {
        process.env.MAVEN_CMD = originalMavenCmd;
      }
      if (originalMvnArgs === undefined) {
        delete process.env.MVN_ARGS;
      } else {
        process.env.MVN_ARGS = originalMvnArgs;
      }
      rmSync(markerFile, { force: true });
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
