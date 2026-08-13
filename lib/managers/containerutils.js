import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { globSync } from "glob";

import { safeExistsSync } from "../core/fs.js";

/**
 * Method to get all dirs matching a name
 *
 * @param {string} dirPath Root directory for search
 * @param {string} dirName Directory name
 * @param {boolean} hidden Include hidden directories and files. Default: false
 * @param {boolean} recurse Recurse. Default: false
 */
export const getDirs = (dirPath, dirName, hidden = false, recurse = true) => {
  try {
    return globSync(`${recurse ? "**" : ""}${dirName}`, {
      cwd: dirPath,
      absolute: true,
      nocase: true,
      nodir: false,
      follow: false,
      dot: hidden,
    });
  } catch (_err) {
    return [];
  }
};

function flatten(lists) {
  return lists.reduce((a, b) => a.concat(b), []);
}

/**
 * Immediate subdirectories of a given path. Directories that cannot be read,
 * such as those owned by another user, are treated as empty.
 *
 * @param {string} srcpath Directory to list
 * @returns {string[]} Absolute paths of the subdirectories
 */
function getDirectories(srcpath) {
  if (!safeExistsSync(srcpath)) {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(srcpath);
  } catch (_e) {
    return [];
  }
  return entries
    .map((file) => join(srcpath, file))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch (_e) {
        return false;
      }
    });
}

export const getOnlyDirs = (srcpath, dirName) => {
  return [
    srcpath,
    ...flatten(
      getDirectories(srcpath)
        .map((p) => {
          try {
            if (safeExistsSync(p) && lstatSync(p).isDirectory()) {
              return getOnlyDirs(p, dirName);
            }
            return [];
          } catch (_err) {
            return [];
          }
        })
        .filter((p) => p !== undefined),
    ),
  ].filter((d) => d.endsWith(dirName));
};

/**
 * Walk a directory tree once and collect all subdirectories whose basename
 * matches any of the target names. Returns a map from name to array of paths.
 *
 * Replaces multiple {@link getOnlyDirs} calls that each walk the same tree.
 *
 * @param {string} srcpath Root directory for search
 * @param {string[]} dirNames Target directory names to collect
 * @returns {Record<string, string[]>} Map of dirName to matching paths
 */
export const getOnlyDirsMulti = (srcpath, dirNames) => {
  const result = {};
  for (const name of dirNames) {
    result[name] = [];
  }
  const nameSet = new Set(dirNames);
  const walk = (dirPath) => {
    const entries = getDirectories(dirPath);
    for (const entry of entries) {
      const base = entry.slice(entry.lastIndexOf("/") + 1);
      if (nameSet.has(base)) {
        result[base].push(entry);
      }
      walk(entry);
    }
  };
  if (safeExistsSync(srcpath)) {
    const srcBase = srcpath.slice(srcpath.lastIndexOf("/") + 1);
    if (nameSet.has(srcBase)) {
      result[srcBase].push(srcpath);
    }
    walk(srcpath);
  }
  return result;
};
