/**
 * Tests for the command-shaping resolver: one case per template variable,
 * per fallback, and per platform, over facts gathered by hand.
 *
 * The Windows variants need a forced platform because the matrix is Linux
 * containers only; every Windows story here is a unit assertion.
 */
import { assert, describe, it } from "poku";

import {
  PYTHON_MANAGERS,
  SHAPE_VARIABLES,
  shapeCommand,
} from "./shapeCommand.js";

describe("shapeCommand()", () => {
  it("returns a template without variables byte-identical and unshaped", () => {
    const template = "mvn -q package -DskipTests";
    const shaped = shapeCommand(template, {});
    assert.equal(shaped.command, template);
    assert.equal(shaped.shapedBy, undefined);
    assert.equal(shaped.shapedNote, undefined);
  });

  it("returns a non-string command untouched", () => {
    assert.equal(shapeCommand(undefined, {}).command, undefined);
  });

  describe("{{mvn}}", () => {
    it("resolves to the wrapper when it exists and is executable", () => {
      const shaped = shapeCommand("{{mvn}} -q package -DskipTests", {
        wrappers: { mvnw: true },
      });
      assert.equal(shaped.command, "./mvnw -q package -DskipTests");
      assert.equal(shaped.shapedBy, "wrapper:./mvnw");
    });

    it("falls back to mvn when the wrapper exists but is not executable", () => {
      const shaped = shapeCommand("{{mvn}} -q package -DskipTests", {
        wrappers: { mvnwInexecutable: true },
      });
      assert.equal(shaped.command, "mvn -q package -DskipTests");
      assert.equal(shaped.shapedBy, "wrapper-not-executable:./mvnw");
    });

    it("falls back to mvn without a shapedBy when no wrapper exists", () => {
      const shaped = shapeCommand("{{mvn}} -q package -DskipTests", {});
      assert.equal(shaped.command, "mvn -q package -DskipTests");
      assert.equal(shaped.shapedBy, undefined);
    });

    it("resolves to mvnw.cmd on a Windows command string", () => {
      const shaped = shapeCommand("{{mvn}} -q package -DskipTests", {
        platform: "windows",
        wrappers: { mvnwCmd: true },
      });
      assert.equal(shaped.command, "mvnw.cmd -q package -DskipTests");
      assert.equal(shaped.shapedBy, "wrapper:mvnw.cmd");
    });

    it("ignores the POSIX wrapper fact on a Windows command string", () => {
      const shaped = shapeCommand("{{mvn}} -q package -DskipTests", {
        platform: "windows",
        wrappers: { mvnw: true },
      });
      assert.equal(shaped.command, "mvn -q package -DskipTests");
      assert.equal(shaped.shapedBy, undefined);
    });
  });

  describe("{{gradle}}", () => {
    it("resolves to the wrapper when it exists and is executable", () => {
      const shaped = shapeCommand("{{gradle}} -q build", {
        wrappers: { gradlew: true },
      });
      assert.equal(shaped.command, "./gradlew -q build");
      assert.equal(shaped.shapedBy, "wrapper:./gradlew");
    });

    it("falls back to gradle when the wrapper exists but is not executable", () => {
      const shaped = shapeCommand("{{gradle}} -q build", {
        wrappers: { gradlewInexecutable: true },
      });
      assert.equal(shaped.command, "gradle -q build");
      assert.equal(shaped.shapedBy, "wrapper-not-executable:./gradlew");
    });

    it("resolves to gradlew.bat on a Windows command string", () => {
      const shaped = shapeCommand("{{gradle}} -q build", {
        platform: "windows",
        wrappers: { gradlewBat: true },
      });
      assert.equal(shaped.command, "gradlew.bat -q build");
      assert.equal(shaped.shapedBy, "wrapper:gradlew.bat");
    });

    it("falls back to gradle without a shapedBy when no wrapper exists", () => {
      const shaped = shapeCommand("{{gradle}} -q build", {});
      assert.equal(shaped.command, "gradle -q build");
      assert.equal(shaped.shapedBy, undefined);
    });
  });

  describe("{{pythonManager}}", () => {
    for (const manager of PYTHON_MANAGERS) {
      it(`resolves to ${manager} when it is the manager in play`, () => {
        const shaped = shapeCommand("{{pythonManager}} lock", {
          pythonManager: manager,
        });
        assert.equal(shaped.command, `${manager} lock`);
        assert.equal(shaped.shapedBy, `manager:${manager}`);
      });
    }

    it("keeps the poetry variant's flags", () => {
      const shaped = shapeCommand("{{pythonManager}} lock --no-interaction", {
        pythonManager: "poetry",
      });
      assert.equal(shaped.command, "poetry lock --no-interaction");
      assert.equal(shaped.shapedBy, "manager:poetry");
    });

    it("stays unresolved with a note for the agent when two managers compete", () => {
      const shaped = shapeCommand("{{pythonManager}} lock", {
        pythonManagerCandidates: ["poetry", "uv"],
      });
      assert.equal(shaped.command, "{{pythonManager}} lock");
      assert.equal(shaped.shapedBy, "manager:ambiguous");
      assert.match(shaped.shapedNote, /poetry and uv/);
    });

    it("stays unresolved without a note when no manager was detected", () => {
      const shaped = shapeCommand("{{pythonManager}} lock", {});
      assert.equal(shaped.command, "{{pythonManager}} lock");
      assert.equal(shaped.shapedBy, "manager:unresolved");
      assert.equal(shaped.shapedNote, undefined);
    });
  });

  describe("{{npmClient}}", () => {
    it("resolves to the detected client", () => {
      const shaped = shapeCommand("{{npmClient}} install", {
        npmClient: "pnpm",
      });
      assert.equal(shaped.command, "pnpm install");
      assert.equal(shaped.shapedBy, "npm-client:pnpm");
    });

    it("falls back to npm without a shapedBy", () => {
      const shaped = shapeCommand("{{npmClient}} install", {});
      assert.equal(shaped.command, "npm install");
      assert.equal(shaped.shapedBy, undefined);
    });
  });

  describe("{{composer}}", () => {
    it("resolves to the project's composer.phar when it is usable", () => {
      const shaped = shapeCommand("{{composer}} install", {
        platform: "posix",
        wrappers: { composerPhar: true },
      });
      assert.equal(shaped.command, "./composer.phar install");
      assert.equal(shaped.shapedBy, "wrapper:./composer.phar");
    });

    it("falls back to composer without a shapedBy", () => {
      const shaped = shapeCommand("{{composer}} install", {});
      assert.equal(shaped.command, "composer install");
      assert.equal(shaped.shapedBy, undefined);
    });

    it("keeps the plain composer on a Windows command string", () => {
      const shaped = shapeCommand("{{composer}} install", {
        platform: "windows",
        wrappers: { composerPhar: true },
      });
      assert.equal(shaped.command, "composer install");
      assert.equal(shaped.shapedBy, undefined);
    });
  });

  describe("variables with no wrapper or version-manager fact", () => {
    it("resolve to the plain executable without a shapedBy", () => {
      for (const [variable, executable] of [
        ["go", "go"],
        ["cargo", "cargo"],
        ["dart", "dart"],
        ["mix", "mix"],
        ["cabal", "cabal"],
      ]) {
        const shaped = shapeCommand(`{{${variable}}} test`, {});
        assert.equal(shaped.command, `${executable} test`);
        assert.equal(shaped.shapedBy, undefined);
      }
    });
  });

  it("leaves version placeholders alone for the version cascade", () => {
    const shaped = shapeCommand("sdk install java {{version}}", {
      wrappers: { mvnw: true, gradlew: true },
      pythonManager: "uv",
    });
    assert.equal(shaped.command, "sdk install java {{version}}");
    assert.equal(shaped.shapedBy, undefined);
  });

  it("is stable: the same facts shape the same command twice", () => {
    const facts = { wrappers: { mvnw: true }, pythonManager: "uv" };
    const first = shapeCommand("{{mvn}} -q package", facts);
    const second = shapeCommand("{{mvn}} -q package", facts);
    assert.deepEqual(first, second);
  });
});

describe("SHAPE_VARIABLES", () => {
  it("covers every variable the resolver substitutes", () => {
    assert.ok(SHAPE_VARIABLES.includes("mvn"));
    assert.ok(SHAPE_VARIABLES.includes("gradle"));
    assert.ok(SHAPE_VARIABLES.includes("pythonManager"));
    assert.ok(SHAPE_VARIABLES.includes("npmClient"));
  });
});
