#!/usr/bin/env node
/**
 * copy-squashed-notes.mjs
 *
 * Reconstruct git-ai authorship notes that were lost when a feature branch was
 * squash-merged on a forge (GitHub/GitLab "Squash and Merge").
 *
 * WHY THIS EXISTS
 * ---------------
 * git-ai stores line-level AI attribution in git notes (default ref
 * `refs/notes/ai`) keyed by *commit SHA*. A local `git merge --squash` keeps
 * attribution because the git-ai daemon rewrites the note onto the new commit.
 * A forge-side "Squash and Merge", however, mints a brand-new commit on the
 * server where no git-ai daemon runs, so the squash commit has NO note. The
 * original per-commit notes remain attached to the now-unreachable pre-squash
 * SHAs, so `git log --notes=refs/notes/ai` over the main branch finds nothing
 * and cdxgen's `-t ai-provenance` collector loses every model/session signal.
 *
 * WHAT THIS DOES
 * --------------
 * Collects the authorship notes from the squashed-away commits and merges them
 * into a single spec-compliant note (Git AI Standard v3.0.0, "Interactive
 * Rebase: Squash/Fixup (N -> 1)") attached to the squash commit on the target
 * branch. The combined note unions the `sessions` and `prompts` records and
 * concatenates every attestation block, so all contributing session hashes,
 * agents, and models are preserved.
 *
 * LIMITATION (inherent to squash): N commits collapse into 1, so per-commit
 * granularity is not recoverable, and attestation line ranges reflect each
 * original commit's diff rather than the final squashed file state. Agents,
 * models, sessions, and prompt records ARE fully preserved, which is what the
 * cdxgen ai-provenance/oversight collectors read.
 *
 * USAGE
 *   node contrib/git-ai-notes/copy-squashed-notes.mjs [options]
 *
 * OPTIONS
 *   --target <rev>       Commit to attach the combined note to.   (default: HEAD)
 *   --source <rev>       Only include notes reachable from this rev.
 *                        (default: all noted commits not already on --target)
 *   --notes-ref <ref>    Notes ref to read from and write to.  (default: refs/notes/ai)
 *   --dry-run            Print the combined note; do not write it.
 *   -h, --help           Show this help.
 *
 * EXAMPLES
 *   # Rebuild the note for the current squash commit from every orphaned note
 *   node contrib/git-ai-notes/copy-squashed-notes.mjs --target HEAD
 *
 *   # Scope to notes that were on a specific (still-present) feature branch
 *   node contrib/git-ai-notes/copy-squashed-notes.mjs \
 *     --target HEAD --source feature/ai-provenance
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELP = `Usage: node contrib/git-ai-notes/copy-squashed-notes.mjs [options]

  --target <rev>      Commit to attach the combined note to (default: HEAD)
  --source <rev>      Only include notes reachable from this rev
  --notes-ref <ref>   Notes ref to read/write (default: refs/notes/ai)
  --dry-run           Print the combined note, do not write it
  -h, --help          Show this help
`;

function parseArgs(argv) {
  const opts = {
    target: "HEAD",
    source: "",
    notesRef: "refs/notes/ai",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--target":
        opts.target = argv[++i];
        break;
      case "--source":
        opts.source = argv[++i];
        break;
      case "--notes-ref":
        opts.notesRef = argv[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.stdout.write(HELP);
        process.exit(2);
    }
  }
  return opts;
}

// Run git with array args (no shell) and return trimmed stdout, or null on error.
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // When failure is tolerated, keep git's own stderr ("error: no note ...")
      // out of our output; we surface our own messages instead.
      stdio: allowFail ? ["ignore", "pipe", "ignore"] : ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    if (allowFail) {
      return null;
    }
    throw err;
  }
}

// True when `commit` is an ancestor of (or equal to) `rev`.
function isAncestor(commit, rev) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, rev], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Split a git-ai authorship note into { attestation, meta } where meta is the
// parsed JSON block after the `---` divider. Returns null when the note is not
// an authorship-schema note.
function parseAuthorshipNote(raw) {
  const sep = raw.match(/(^|\n)---[ \t]*\r?\n/);
  let attestation = "";
  let jsonText = "";
  if (sep) {
    attestation = raw.slice(0, sep.index);
    jsonText = raw.slice(sep.index + sep[0].length).trim();
  } else if (raw.trimStart().startsWith("{")) {
    jsonText = raw.trim();
  } else {
    return null;
  }
  let meta;
  try {
    meta = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (
    !meta ||
    typeof meta !== "object" ||
    typeof meta.schema_version !== "string" ||
    !meta.schema_version.startsWith("authorship")
  ) {
    return null;
  }
  return { attestation, meta };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Confirm we are in a git repo.
  if (git(["rev-parse", "--git-dir"], { allowFail: true }) === null) {
    console.error("Not a git repository.");
    process.exit(1);
  }

  const targetSha = git(["rev-parse", opts.target], { allowFail: true })?.trim();
  if (!targetSha) {
    console.error(`Cannot resolve --target '${opts.target}'.`);
    process.exit(1);
  }

  // List all commits carrying a note in the ref: "<note-blob> <commit-sha>".
  const listing = git(["notes", `--ref=${opts.notesRef}`, "list"], { allowFail: true });
  if (!listing) {
    console.error(`No notes found in ${opts.notesRef}.`);
    process.exit(1);
  }
  const notedCommits = listing
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean);

  // Select the squashed-away commits: they carry a note but are NOT already on
  // the target branch. Optionally scope to those reachable from --source.
  const selected = [];
  for (const commit of notedCommits) {
    if (commit === targetSha) {
      continue;
    }
    if (isAncestor(commit, targetSha)) {
      continue; // already represented on target
    }
    if (opts.source && !isAncestor(commit, opts.source)) {
      continue; // not part of the requested source branch
    }
    selected.push(commit);
  }

  if (selected.length === 0) {
    console.error("No orphaned notes to copy. Nothing to do.");
    process.exit(0);
  }

  // Merge every selected authorship note into one combined note.
  const attestationBlocks = [];
  const mergedSessions = {};
  const mergedPrompts = {};
  const contributingShas = [];
  let gitAiVersion = "";
  let skipped = 0;

  // Fold in an existing note on the target first so re-runs are idempotent.
  const forMerge = [...selected];
  const existingTarget = git(["notes", `--ref=${opts.notesRef}`, "show", targetSha], {
    allowFail: true,
  });
  if (existingTarget) {
    forMerge.unshift(targetSha);
  }

  for (const commit of forMerge) {
    const raw = git(["notes", `--ref=${opts.notesRef}`, "show", commit], { allowFail: true });
    if (!raw) {
      continue;
    }
    const parsed = parseAuthorshipNote(raw);
    if (!parsed) {
      console.warn(`Skipping non-authorship note on ${commit.slice(0, 12)}.`);
      skipped++;
      continue;
    }
    const { attestation, meta } = parsed;
    if (attestation.trim()) {
      attestationBlocks.push(attestation.replace(/\s+$/, ""));
    }
    for (const [sid, sess] of Object.entries(meta.sessions || {})) {
      if (!(sid in mergedSessions)) {
        mergedSessions[sid] = sess;
      }
    }
    for (const [pid, prompt] of Object.entries(meta.prompts || {})) {
      if (!(pid in mergedPrompts)) {
        mergedPrompts[pid] = prompt;
      }
    }
    if (!gitAiVersion && meta.git_ai_version) {
      gitAiVersion = meta.git_ai_version;
    }
    if (commit !== targetSha) {
      contributingShas.push(commit);
    }
  }

  if (Object.keys(mergedSessions).length === 0 && Object.keys(mergedPrompts).length === 0) {
    console.error(`No authorship data recovered (${skipped} note(s) skipped).`);
    process.exit(1);
  }

  const mergedMeta = {
    schema_version: "authorship/3.0.0",
    git_ai_version: gitAiVersion || "unknown",
    base_commit_sha: targetSha,
    prompts: mergedPrompts,
    sessions: mergedSessions,
    // Provenance of this reconstruction (non-standard, informational).
    x_squashed_from: contributingShas,
    x_reconstructed_by: "contrib/git-ai-notes/copy-squashed-notes.mjs",
  };

  const combined = `${attestationBlocks.join("\n")}\n---\n${JSON.stringify(mergedMeta, null, 2)}`;

  const agents = new Set();
  const models = new Set();
  for (const rec of [...Object.values(mergedSessions), ...Object.values(mergedPrompts)]) {
    if (rec?.agent_id?.tool) agents.add(rec.agent_id.tool);
    if (rec?.agent_id?.model) models.add(rec.agent_id.model);
  }

  console.error(
    `Merged ${contributingShas.length} orphaned note(s)` +
      `${existingTarget ? " + existing target note" : ""} into ${targetSha.slice(0, 12)}`,
  );
  console.error(`  sessions: ${Object.keys(mergedSessions).length}, prompts: ${Object.keys(mergedPrompts).length}`);
  console.error(`  agents:   ${[...agents].sort().join(", ") || "(none)"}`);
  console.error(`  models:   ${[...models].sort().join(", ") || "(none)"}`);

  if (opts.dryRun) {
    console.error("\n--- combined note (dry run, not written) ---\n");
    process.stdout.write(`${combined}\n`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "git-ai-note-"));
  const file = join(dir, "note.txt");
  try {
    writeFileSync(file, combined);
    git(["notes", `--ref=${opts.notesRef}`, "add", "-f", "-F", file, targetSha]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.error(`\nWrote combined note to ${opts.notesRef} on ${targetSha.slice(0, 12)}.`);
  console.error("Verify with:");
  console.error(`  git notes --ref=${opts.notesRef} show ${targetSha.slice(0, 12)}`);
}

main();
