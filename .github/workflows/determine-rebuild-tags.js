import fs from "node:fs";

// Read and parse releases.json
const filename = process.argv[2] || "releases.json";
let rawData;
try {
  rawData = fs.readFileSync(filename, "utf8");
} catch (err) {
  console.error(`Failed to read file ${filename}:`, err);
  process.exit(1);
}

let releases;
try {
  releases = JSON.parse(rawData);
} catch (err) {
  console.error("Failed to parse JSON:", err);
  process.exit(1);
}

// Ensure releases is an array
if (!Array.isArray(releases)) {
  console.error("Expected JSON to be an array of release objects");
  process.exit(1);
}

// Function to parse semver (e.g. "v1.2.3")
// Excludes prereleases like "v1.2.3-beta.1"
function parseSemver(tag) {
  if (typeof tag !== "string") return null;
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    tag,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

// Parse and filter valid releases
const validReleases = [];
for (const rel of releases) {
  // Filter out prereleases and drafts
  if (rel.prerelease || rel.draft) continue;
  const parsed = parseSemver(rel.tag_name);
  if (parsed) {
    validReleases.push(parsed);
  }
}

// Sort releases by semver descending
validReleases.sort((a, b) => {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
});

// Group releases by major.minor
const groups = {};
for (const rel of validReleases) {
  const key = `${rel.major}.${rel.minor}`;
  if (!groups[key]) {
    groups[key] = [];
  }
  groups[key].push(rel);
}

// Get the sorted list of minor release keys (highest first)
const minorKeys = Object.keys(groups).sort((a, b) => {
  const [aMaj, aMin] = a.split(".").map(Number);
  const [bMaj, bMin] = b.split(".").map(Number);
  if (aMaj !== bMaj) return bMaj - aMaj;
  return bMin - aMin;
});

// We want the last two minor releases
const targetMinors = minorKeys.slice(0, 2);

// For each of these minor releases, get the last 2 patch releases (highest patches)
const selectedTags = [];
for (const key of targetMinors) {
  const groupReleases = groups[key]; // already sorted descending by patch
  const topPatches = groupReleases.slice(0, 2).map((r) => r.tag);
  selectedTags.push(...topPatches);
}

// Ensure the final list of selected tags is also sorted descending by semver
const finalParsedTags = selectedTags.map(parseSemver).filter(Boolean);
finalParsedTags.sort((a, b) => {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
});
const sortedSelectedTags = finalParsedTags.map((r) => r.tag);

// Determine the absolute latest tag (first element of overall sorted releases)
const latestTag = validReleases[0] ? validReleases[0].tag : "";

if (sortedSelectedTags.length === 0) {
  console.error("No valid release tags found to rebuild");
  process.exit(1);
}

const tagsJson = JSON.stringify(sortedSelectedTags);

console.log("Selected tags:", sortedSelectedTags);
console.log("Latest tag:", latestTag);

// Write to GITHUB_OUTPUT if available
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tags=${tagsJson}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `latest-tag=${latestTag}\n`);
}
