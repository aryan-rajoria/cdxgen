#!/usr/bin/env node

/**
 * One-off script: records cassette files for the 7 get*Metadata functions
 * by making real network calls through the cassette record layer.
 *
 * Usage: node contrib/record-cassettes.js
 *
 * After recording, cassettes are committed to repotests/_cassettes/ and
 * the golden runner replays them with network blocked.
 */

import path from "node:path";
import process from "node:process";

import { startRecord } from "./cassette.js";

const CASSETTES_DIR = path.join(
  path.resolve(import.meta.dirname, ".."),
  "repotests",
  "_cassettes",
);

async function main() {
  const { startRecord } = await import("./cassette.js");
  const utils = await import(
    path.join(path.resolve(import.meta.dirname, ".."), "lib", "helpers", "utils.js")
  );

  const cassettes = [];

  // Helper: record a single function call into a cassette file.
  async function record(cassetteName, fn) {
    const cassettePath = path.join(CASSETTES_DIR, cassetteName);
    const controller = startRecord(cassettePath);
    try {
      await fn(utils);
    } catch (err) {
      console.error(`  WARNING during ${cassetteName}: ${err.message}`);
    }
    controller.stop();
    console.log(`  Recorded ${cassetteName} (${controller.recordCount} entries)`);
    cassettes.push(cassetteName);
  }

  console.log("Recording cassettes...\n");

  await record("metadata_npm.json", async (u) => {
    await u.getNpmMetadata([{ name: "left-pad", version: "1.3.0" }]);
  });

  await record("metadata_mvn.json", async (u) => {
    await u.getMvnMetadata(
      [
        {
          group: "org.ow2.asm",
          name: "asm",
          version: "9.5",
          purl: "pkg:maven/org.ow2.asm/asm@9.5",
        },
      ],
      {},
      true,
    );
  });

  await record("metadata_py.json", async (u) => {
    await u.getPyMetadata(
      [{ name: "flask", version: "2.0.0" }],
      true,
    );
  });

  await record("metadata_crates.json", async (u) => {
    await u.getCratesMetadata([{ name: "serde", version: "1.0.193" }]);
  });

  await record("metadata_nuget.json", async (u) => {
    await u.getNugetMetadata([
      { name: "Newtonsoft.Json", version: "13.0.3" },
    ]);
  });

  await record("metadata_repolicense.json", async (u) => {
    await u.getRepoLicense("https://github.com/pallets/flask", undefined);
  });

  await record("metadata_gopkglicense.json", async (u) => {
    await u.getGoPkgLicense({
      group: "",
      name: "github.com/gin-gonic/gin",
    });
  });

  console.log(`\nDone. ${cassettes.length} cassettes recorded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
