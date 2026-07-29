import { readFileSync } from "node:fs";
import process from "node:process";

import { assert, it } from "poku";
import { parse as loadYaml } from "yaml";

import {
  buildObjectForCocoaPod,
  parseCocoaDependency,
  parsePodfileLock,
  parsePodfileTargets,
} from "./utils.js";

it("parsePodfileLock tests", async () => {
  assert.deepStrictEqual(
    (
      await parsePodfileLock(
        loadYaml(readFileSync("./test/Podfile.lock", "utf-8")),
      )
    ).size,
    6,
  );

  process.env.COCOA_MERGE_SUBSPECS = false;
  assert.deepStrictEqual(
    (
      await parsePodfileLock(
        loadYaml(readFileSync("./test/Podfile.lock", "utf-8")),
      )
    ).size,
    16,
  );
  process.env.COCOA_MERGE_SUBSPECS = true;
});

it("parsePodfileTargets tests", () => {
  const targetDependencies = new Map();
  parsePodfileTargets(
    JSON.parse(readFileSync("./test/Podfile.json", "utf-8"))[
      "target_definitions"
    ][0],
    targetDependencies,
  );
  assert.deepStrictEqual(targetDependencies.size, 5);
  assert.deepStrictEqual(targetDependencies.has("Pods"), true);
});

it("parseCocoaDependency tests", () => {
  let dependency = parseCocoaDependency("Alamofire (3.0.0)");
  assert.deepStrictEqual(dependency.name, "Alamofire");
  assert.deepStrictEqual(dependency.version, "3.0.0");

  dependency = parseCocoaDependency("boost/graph-includes (= 1.59.0)", false);
  assert.deepStrictEqual(dependency.name, "boost/graph-includes");
  assert.deepStrictEqual(dependency.version, undefined);
});

it("buildObjectForCocoaPod tests", async () => {
  assert.deepStrictEqual(
    await buildObjectForCocoaPod(parseCocoaDependency("Alamofire (3.0.0)")),
    {
      name: "Alamofire",
      version: "3.0.0",
      type: "library",
      purl: "pkg:cocoapods/Alamofire@3.0.0",
      "bom-ref": "pkg:cocoapods/Alamofire@3.0.0",
    },
  );

  assert.deepStrictEqual(
    await buildObjectForCocoaPod(
      parseCocoaDependency("boost/graph-includes (= 1.59.0)"),
    ),
    {
      name: "boost/graph-includes",
      version: "= 1.59.0",
      type: "library",
      properties: [
        {
          name: "cdx:pods:Subspec",
          value: "graph-includes",
        },
      ],
      purl: "pkg:cocoapods/boost@%3D%201.59.0#graph-includes",
      "bom-ref": "pkg:cocoapods/boost@= 1.59.0#graph-includes",
    },
  );
});
