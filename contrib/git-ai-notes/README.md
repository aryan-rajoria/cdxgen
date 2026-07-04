# git-ai notes recovery for squash-merged branches

Utilities for recovering [git-ai](https://github.com/git-ai-project/git-ai) AI-authorship
attribution that is lost when a feature branch is **squash-merged on a forge**
(GitHub/GitLab/Bitbucket/Azure DevOps "Squash and Merge" or "Rebase and Merge").

## The problem

git-ai records line-level AI attribution (agent, model, session) in **git notes** on the
`refs/notes/ai` ref, keyed by **commit SHA**. cdxgen's `-t ai-provenance` collector reads
these notes over the current branch's history:

```
git log -n <N> --notes=refs/notes/ai --format=%H%n%N
```

- A **local** `git merge --squash` keeps attribution — the git-ai daemon detects the rewrite
  and moves/merges the note onto the new commit.
- A **forge-side squash/rebase merge** creates a brand-new commit **on the server**, where no
  git-ai daemon runs. The squash commit has **no note**; the original per-commit notes remain
  attached to the now-unreachable pre-squash SHAs.

The consequence for a repo whose default branch was populated by forge squash merges: running
`cdxgen -t ai-provenance` finds no notes on the reachable history, so `cdx:ai:codegen:models`,
`:agents`, `:sessionCount`, `:attributionCount`, and the whole `cdx:ai:oversight:*` layer fall
back to their config-file-only values (tool names survive, model/line attribution does not).

This is git-ai's [documented behavior](https://github.com/git-ai-project/git-ai#what-are-the-capabilities-and-known-limitations):
forge Squash-and-Merge / Rebase-and-Merge require _Git AI for Teams_ or the _Open Source CI
Action_ to preserve attribution.

## The fix: `copy-squashed-notes.mjs`

Reconstructs a single **spec-compliant N→1 squash note** (Git AI Standard v3.0.0,
"Interactive Rebase: Squash/Fixup (N → 1)") on the squash commit. It collects the orphaned
per-commit notes, **unions** their `sessions` and `prompts` records, concatenates every
attestation block, and writes the combined note back to `refs/notes/ai` on the target commit,
so `git log --notes` — and therefore cdxgen — can read it again.

```bash
# Dry run: see what would be recovered (agents, models, sessions) without writing
node contrib/git-ai-notes/copy-squashed-notes.mjs --dry-run

# Write the combined note onto the current squash commit (HEAD)
node contrib/git-ai-notes/copy-squashed-notes.mjs --target HEAD

# Scope to notes that were on a specific still-present feature branch
node contrib/git-ai-notes/copy-squashed-notes.mjs --target HEAD --source feature/my-branch
```

### Options

| Option              | Default         | Description                                                |
| ------------------- | --------------- | ---------------------------------------------------------- |
| `--target <rev>`    | `HEAD`          | Commit to attach the combined note to (the squash commit). |
| `--source <rev>`    | _(all)_         | Only include notes reachable from this rev.                |
| `--notes-ref <ref>` | `refs/notes/ai` | Notes ref to read from and write to.                       |
| `--dry-run`         | off             | Print the combined note; do not write it.                  |
| `-h`, `--help`      | —               | Show help.                                                 |

By default it selects every commit that carries a note but is **not** already reachable from
`--target` (i.e. the squashed-away commits, including pre-squash SHAs left dangling by forced
pushes). It is idempotent: an existing note on the target is folded into the merge, so re-runs
do not lose data.

### Verify

```bash
git notes --ref=refs/notes/ai show HEAD
node bin/cdxgen.js -t ai-provenance -o sbom-aip.cdx.json --json-pretty .
```

Expect `cdx:ai:codegen:models`, `cdx:ai:codegen:agents`, `cdx:ai:codegen:sessionCount`, and the
`cdx:ai:oversight:*` properties (with `dataSources` including `git-ai-notes`) to reappear.

## Limitations

- **No per-commit granularity.** N commits become 1; the combined note carries all sessions
  and prompts, but not the original commit boundaries.
- **Line ranges are approximate.** Attestation ranges reflect each _original_ commit's diff,
  not the final squashed file state (the spec calls for recomputing against final state; this
  script does not — agents/models/sessions are exact, ranges are carried verbatim).
- Non-authorship-schema notes are skipped with a warning (only one authorship block is valid
  per commit).

## Prevention

- Prefer merge commits or history-preserving rebases for AI-provenance-relevant branches.
- Or wire the git-ai CI Action into your merge workflow to write attribution to the squash
  commit server-side.

See [`docs/AI_PROVENANCE.md`](../../docs/AI_PROVENANCE.md) for the full feature documentation.
