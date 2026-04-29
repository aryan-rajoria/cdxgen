import { Buffer } from "node:buffer";
import fs from "node:fs";
import { arch } from "node:os";

import { isCycloneDxBom } from "../helpers/bomUtils.js";
import {
  getAllFiles,
  getTmpDir,
  isWin,
  safeSpawnSync,
} from "../helpers/utils.js";

const ORAS_CREATED_ANNOTATION = "org.opencontainers.image.created";

function getManifestDescriptors(manifestObj) {
  if (Array.isArray(manifestObj?.manifests)) {
    return manifestObj.manifests;
  }
  if (Array.isArray(manifestObj?.referrers)) {
    return manifestObj.referrers;
  }
  return [];
}

function getRepositoryRef(image) {
  let repositoryRef = image;
  const digestIndex = repositoryRef.indexOf("@");
  if (digestIndex !== -1) {
    repositoryRef = repositoryRef.slice(0, digestIndex);
  }
  const lastSlashIndex = repositoryRef.lastIndexOf("/");
  const tagIndex = repositoryRef.lastIndexOf(":");
  if (tagIndex > lastSlashIndex) {
    repositoryRef = repositoryRef.slice(0, tagIndex);
  }
  return repositoryRef;
}

function getManifestImageRef(image, manifest) {
  if (manifest?.reference) {
    return manifest.reference;
  }
  if (manifest?.digest) {
    return `${getRepositoryRef(image)}@${manifest.digest}`;
  }
  return undefined;
}

function getManifestCreatedAt(manifest) {
  const createdAt = manifest?.annotations?.[ORAS_CREATED_ANNOTATION];
  if (!createdAt) {
    return undefined;
  }
  const createdAtTimestamp = Date.parse(createdAt);
  if (Number.isNaN(createdAtTimestamp)) {
    return undefined;
  }
  return createdAtTimestamp;
}

function selectManifestImageRef(image, manifestObj) {
  const manifestDescriptors = getManifestDescriptors(manifestObj);
  const candidates = manifestDescriptors
    .map((manifest, index) => {
      const imageRef = getManifestImageRef(image, manifest);
      if (!imageRef) {
        return undefined;
      }
      return {
        createdAt: getManifestCreatedAt(manifest),
        imageRef,
        index,
      };
    })
    .filter(Boolean);
  if (!candidates.length) {
    return undefined;
  }
  candidates.sort((a, b) => {
    if (a.createdAt !== undefined || b.createdAt !== undefined) {
      if (a.createdAt === undefined) {
        return 1;
      }
      if (b.createdAt === undefined) {
        return -1;
      }
      if (b.createdAt !== a.createdAt) {
        return b.createdAt - a.createdAt;
      }
    }
    return b.index - a.index;
  });
  return candidates[0]?.imageRef;
}

function getBomFiles(tmpDir) {
  let bomFiles = getAllFiles(tmpDir, "**/*.{bom,cdx}.json");
  if (!bomFiles.length) {
    bomFiles = getAllFiles(tmpDir, "**/bom.json");
  }
  if (!bomFiles.length) {
    bomFiles = getAllFiles(tmpDir, "**/*.json");
  }
  return bomFiles;
}

/**
 * Retrieves a CycloneDX BOM attached to an OCI image using the `oras` CLI tool.
 * Discovers SBOM attachments via `oras discover`, pulls the first matching
 * artifact, and returns the parsed BOM JSON. Retries automatically with a
 * platform-specific manifest when the initial platform-agnostic discovery fails.
 *
 * @param {string} image OCI image reference (e.g. `"registry.example.com/org/app:tag"`)
 * @param {string} [platform] OCI platform string (e.g. `"linux/amd64"`); detected automatically when omitted
 * @returns {Object|undefined} Parsed CycloneDX BOM JSON object, or `undefined` if not found
 */
export function getBomWithOras(image, platform = undefined) {
  const platformArch = arch() === "arm64" ? "arm64" : "amd64";
  let parameters = [
    "discover",
    "--format",
    "json",
    "--artifact-type",
    "sbom/cyclonedx",
  ];
  if (platform) {
    parameters = parameters.concat(["--platform", platform]);
  }
  let result = safeSpawnSync("oras", parameters.concat([image]), {
    shell: isWin,
  });
  if (result.status !== 0 || result.error) {
    if (!platform) {
      return getBomWithOras(image, `linux/${platformArch}`);
    }
    console.log(
      "Install oras by following the instructions at: https://oras.land/docs/installation",
    );
    if (result.stderr) {
      console.log(result.stderr);
    }
    return undefined;
  }
  if (result.stdout) {
    const out = Buffer.from(result.stdout).toString();
    try {
      const manifestObj = JSON.parse(out);
      const imageRef = selectManifestImageRef(image, manifestObj);
      if (imageRef) {
        const tmpDir = getTmpDir();
        result = safeSpawnSync("oras", ["pull", imageRef, "-o", tmpDir], {
          shell: isWin,
        });
        if (result.status !== 0 || result.error) {
          console.log(
            `Unable to pull the SBOM attachment for ${imageRef} with oras!`,
          );
          return undefined;
        }
        const bomFiles = getBomFiles(tmpDir);
        for (const bomFile of bomFiles) {
          try {
            const bomJson = JSON.parse(fs.readFileSync(bomFile, "utf8"));
            if (isCycloneDxBom(bomJson)) {
              return bomJson;
            }
          } catch {
            // Ignore unrelated or malformed JSON files pulled alongside the SBOM.
          }
        }
      } else {
        console.log(`${image} does not contain any SBOM attachment!`);
      }
    } catch (e) {
      console.log(e);
    }
  }
  return undefined;
}
