// Read-only sweep: generate a BOM per corpus directory, then validate every purl
// in the output against cdx-purl. Records three outcomes per repo:
//   crash  - cdxgen exited non-zero (an unguarded PurlError kills the process)
//   invalid- BOM produced but contains purls cdx-purl rejects
//   ok     - BOM produced, all purls valid
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { basename, join } from "node:path";

import { Purl } from "@cdxgen/cdx-purl";

const REPO = path.resolve(import.meta.dirname, "..");
// Output goes outside the repo by default: these are large generated BOMs, and
// leaving them in the tree makes lint and packaging pick them up.
const OUT =
  process.env.CDXGEN_PURL_SWEEP_OUT || join(tmpdir(), "cdxgen-purl-sweep");
mkdirSync(OUT, { recursive: true });


const targets = [];
for (const d of readdirSync(join(REPO, "repotests"), { withFileTypes: true })) {
  if (d.isDirectory() && !d.name.startsWith("_")) {
    targets.push(join(REPO, "repotests", d.name));
  }
}
const corpus = process.env.CDXGEN_PURL_SWEEP_CORPUS || "";
if (existsSync(corpus)) {
  for (const d of readdirSync(corpus, { withFileTypes: true })) {
    if (d.isDirectory()) targets.push(join(corpus, d.name));
  }
}

// Walk every object and yield each purl with its document path.
function* eachPurl(node, where) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* eachPurl(node[i], `${where}[${i}]`);
    return;
  }
  if (typeof node.purl === "string" && node.purl.length) {
    yield { purl: node.purl, where: `${where}.purl` };
  }
  for (const [k, v] of Object.entries(node)) {
    if (k !== "purl" && v && typeof v === "object") yield* eachPurl(v, `${where}.${k}`);
  }
}

const results = [];
for (const dir of targets) {
  const name = basename(dir);
  const bom = join(OUT, `${name}.json`);
  const r = spawnSync(
    process.execPath,
    ["bin/cdxgen.js", "--no-install-deps", "-o", bom, dir],
    {
      cwd: REPO,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CDXGEN_DEBUG_MODE: "info" },
    },
  );
  const entry = { name, dir, status: r.status, invalid: [], purlCount: 0 };
  const err = `${r.stderr || ""}`;
  const purlErr = err.match(/Error \[PurlError\]: [^\n]+/);
  const frame = err.match(/at \S+ \(file:[^)]*\/(lib\/[^)]+)\)/);
  if (purlErr) entry.purlError = purlErr[0];
  if (frame) entry.site = frame[1];
  if (existsSync(bom)) {
    try {
      const doc = JSON.parse(readFileSync(bom, "utf8"));
      for (const { purl, where } of eachPurl(doc, "$")) {
        entry.purlCount++;
        try {
          Purl.parse(purl);
        } catch (e) {
          entry.invalid.push({ purl, where, code: e.code, message: e.message });
        }
      }
    } catch (e) {
      entry.parseError = e.message;
    }
  }
  results.push(entry);
  const tag = entry.status !== 0 ? "CRASH" : entry.invalid.length ? "INVALID" : "ok";
  console.log(
    `${tag.padEnd(8)} ${name.padEnd(28)} purls=${entry.purlCount} invalid=${entry.invalid.length} ${entry.purlError || ""}`,
  );
}
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
