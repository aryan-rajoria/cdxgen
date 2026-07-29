import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dirNameStr } from "./paths.js";

const vendorAliases = JSON.parse(
  readFileSync(join(dirNameStr, "data", "vendor-alias.json"), "utf-8"),
);
const mesonWrapDB = JSON.parse(
  readFileSync(join(dirNameStr, "data", "wrapdb-releases.json"), "utf-8"),
);
export const frameworksList = JSON.parse(
  readFileSync(join(dirNameStr, "data", "frameworks-list.json"), "utf-8"),
);
const selfPJson = JSON.parse(
  readFileSync(join(dirNameStr, "package.json"), "utf-8"),
);

const CPP_STD_MODULES = JSON.parse(
  readFileSync(join(dirNameStr, "data", "glibc-stdlib.json"), "utf-8"),
);
export const CDXGEN_VERSION = selfPJson.version;

// Refer to contrib/py-modules.py for a script to generate this list
// The script needs to be used once every few months to update this list
const PYTHON_STD_MODULES = JSON.parse(
  readFileSync(join(dirNameStr, "data", "python-stdlib.json"), "utf-8"),
);
// Mapping between modules and package names
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
