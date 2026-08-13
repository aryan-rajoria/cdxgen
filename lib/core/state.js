import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dirNameStr } from "./paths.js";

/** Loaded vendor alias mapping from data/vendor-alias.json. */
const vendorAliases = JSON.parse(
  readFileSync(join(dirNameStr, "data", "vendor-alias.json"), "utf-8"),
);
/** Loaded Meson WrapDB releases from data/wrapdb-releases.json. */
const mesonWrapDB = JSON.parse(
  readFileSync(join(dirNameStr, "data", "wrapdb-releases.json"), "utf-8"),
);
/** Loaded list of known frameworks from data/frameworks-list.json. */
export const frameworksList = JSON.parse(
  readFileSync(join(dirNameStr, "data", "frameworks-list.json"), "utf-8"),
);
const selfPJson = JSON.parse(
  readFileSync(join(dirNameStr, "package.json"), "utf-8"),
);

/** Loaded set of C/C++ standard library modules from data/glibc-stdlib.json. */
const CPP_STD_MODULES = JSON.parse(
  readFileSync(join(dirNameStr, "data", "glibc-stdlib.json"), "utf-8"),
);
/** Installed cdxgen version, read from package.json. */
export const CDXGEN_VERSION = selfPJson.version;

/**
 * cdxgen's own scope and name, read from its package.json rather than hardcoded.
 *
 * Both the tool component in `metadata.tools` and the code that later finds that
 * component again (to attach release notes) need this identity. When the strings
 * were duplicated, the v13 rename to `@cdxgen/cdxgen` updated the producer but
 * not the consumer, and `--release-notes` silently became a no-op.
 */
const selfNameParts = selfPJson.name.split("/");
/** cdxgen npm scope group (e.g. "@cdxgen"), or empty string when unscoped. */
export const CDXGEN_TOOL_GROUP =
  selfNameParts.length > 1 ? selfNameParts[0] : "";
/** cdxgen bare tool name (the final path segment of the package name). */
export const CDXGEN_TOOL_NAME = selfNameParts[selfNameParts.length - 1];

/** Loaded set of Python standard library modules from data/python-stdlib.json. */
const PYTHON_STD_MODULES = JSON.parse(
  readFileSync(join(dirNameStr, "data", "python-stdlib.json"), "utf-8"),
);
/** Loaded mapping between Python module names and PyPI package names from data/pypi-pkg-aliases.json. */
const PYPI_MODULE_PACKAGE_MAPPING = JSON.parse(
  readFileSync(join(dirNameStr, "data", "pypi-pkg-aliases.json"), "utf-8"),
);

export {
  CPP_STD_MODULES,
  mesonWrapDB,
  PYPI_MODULE_PACKAGE_MAPPING,
  PYTHON_STD_MODULES,
  vendorAliases,
};
