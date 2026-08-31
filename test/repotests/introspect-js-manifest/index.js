import { satisfies } from "semver";

export function supports(nodeVersion) {
  return satisfies(nodeVersion, ">=20");
}
