import { readFileSync } from "node:fs";
import path from "node:path";

import { assert, it } from "poku";

import {
  inferJarGroupFromManifest,
  parseJarManifest,
  parsePomProperties,
  trimJarGroupSuffix,
} from "./utils.js";

const jarMetadataFixturesDir = path.resolve("test", "data", "jar-metadata");

function readJarMetadataFixture(...segments) {
  return readFileSync(path.join(jarMetadataFixturesDir, ...segments), {
    encoding: "utf-8",
  });
}

it("jar manifest group inference tests", () => {
  const antManifest = parseJarManifest(
    readJarMetadataFixture("ant-1.10.13", "MANIFEST.MF"),
  );
  assert.deepStrictEqual(
    inferJarGroupFromManifest(antManifest),
    "org.apache.tools.ant",
  );
  const velocityManifest = parseJarManifest(
    readJarMetadataFixture("velocity-1.7", "MANIFEST.MF"),
  );
  assert.deepStrictEqual(velocityManifest["Extension-Name"], "velocity");
  assert.deepStrictEqual(
    velocityManifest["Bundle-SymbolicName"],
    "org.apache.velocity",
  );
  assert.deepStrictEqual(
    inferJarGroupFromManifest(velocityManifest),
    "org.apache.velocity",
  );
});

it("jar manifest inference and pom properties parsing tests", () => {
  const logbackManifest = parseJarManifest(
    readJarMetadataFixture("logback-classic-1.4.7", "MANIFEST.MF"),
  );
  const logbackPomProperties = parsePomProperties(
    readJarMetadataFixture("logback-classic-1.4.7", "pom.properties"),
  );
  assert.deepStrictEqual(
    inferJarGroupFromManifest(logbackManifest),
    "ch.qos.logback.classic",
  );
  assert.deepStrictEqual(logbackPomProperties, {
    artifactId: "logback-classic",
    groupId: "ch.qos.logback",
    version: "1.4.7",
  });
  const commonsMathManifest = parseJarManifest(
    readJarMetadataFixture("commons-math3-3.6.1", "MANIFEST.MF"),
  );
  const commonsMathPomProperties = parsePomProperties(
    readJarMetadataFixture("commons-math3-3.6.1", "pom.properties"),
  );
  assert.deepStrictEqual(
    inferJarGroupFromManifest(commonsMathManifest),
    "org.apache.commons.math3",
  );
  assert.deepStrictEqual(commonsMathPomProperties, {
    artifactId: "commons-math3",
    groupId: "org.apache.commons",
    version: "3.6.1",
  });
  assert.deepStrictEqual(parsePomProperties("artifactId=demo\ncustom=a=b=c"), {
    artifactId: "demo",
    custom: "a=b=c",
  });
  assert.deepStrictEqual(
    parsePomProperties("artifactId=demo\r\r\ncustom=a\r=b\r=c"),
    {
      artifactId: "demo",
      custom: "a=b=c",
    },
  );
});

it("jar group suffix trimming tests", () => {
  assert.deepStrictEqual(
    trimJarGroupSuffix("org.checkerframework.checker.qual", "checker-qual"),
    "org.checkerframework",
  );
  assert.deepStrictEqual(
    trimJarGroupSuffix("org.apache.velocity", "velocity"),
    "org.apache.velocity",
  );
});
