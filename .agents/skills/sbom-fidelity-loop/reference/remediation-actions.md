# Remediation actions — the six kinds and how to execute them safely

Every `remediation[]` entry in the JSON report carries `actions[]` in the
order the fix is performed — install, then build, then re-run is a recipe, not
a set. Each action is one of six kinds; the kind tells you who may run it and
what it changes. Never run an action the report did not emit.

| kind | What it does | Changes | Who executes it |
| --- | --- | --- | --- |
| `install` | Installs a build tool on the host (SDKMAN, winget, a manual installer) | The user's machine | Ask the user first; proceed only unattended or in CI with an explicit mandate |
| `env` | Names an environment variable the *next* cdxgen run needs (`CDXGEN_ALLOWED_COMMANDS`, `CDXGEN_ALLOWED_HOSTS`, dropping `--dry-run`) | The next run's policy | Safe to set for one invocation; confirm with the user, because allowlists widen what cdxgen may touch |
| `build` | Runs the project's own build command so the resolver produces a full graph (`mvn -q package -DskipTests`) | Build outputs only | Safe to run |
| `config` | Asks for a project configuration change (enable sbt dependency locking, bake an explicit PATH into an image) | The project | **Surface as advice, do not execute** — the loop never modifies the project |
| `container` | Runs cdxgen's container image over the project, supplying the missing toolchain from the image | Nothing on the host (a read-only bind mount) | Ask the user first; prefer over `install` when offered — it is reversible |
| `rerun` | Re-run the cdxgen invocation; the *next* report is the verdict | Nothing | Safe; this is how the loop verifies |

Two real entries showing the shape — an `install`/`build`/`rerun` recipe and a
`container` answer:

```json
{
  "remediationId": "jvm.maven.manifest-fallback",
  "actions": [
    {
      "kind": "install",
      "tool": "java",
      "via": "sdkman",
      "versionFrom": "expected",
      "command": "sdk install java {{version}}",
      "windows": "winget install --id EclipseAdoptium.Temurin.{{major}}.JDK"
    },
    {
      "kind": "build",
      "command": "mvn -q package -DskipTests"
    },
    {
      "kind": "rerun"
    }
  ],
  "verify": {
    "rules": ["BF-JVM-001", "BF-JVM-002"],
    "expectTier": "resolved"
  }
}
```

```json
{
  "remediationId": "ruby.build-deps.missing",
  "actions": [
    {
      "kind": "container",
      "image": "ghcr.io/cyclonedx/cdxgen",
      "command": "docker run --rm -v \"$PWD:/app\" -w /app ghcr.io/cyclonedx/cdxgen -t ruby /app",
      "windows": "docker run --rm -v \"%cd%:/app\" -w /app ghcr.io/cyclonedx/cdxgen -t ruby %cd%"
    }
  ],
  "verify": {
    "expectTier": "resolved",
    "eventsCleared": ["ruby.build-deps.missing"]
  }
}
```

A `config` entry — the kind an agent surfaces instead of executing (the sbt
lockfile the project does not have is the human's decision, and adding it
would change the project the SBOM is supposed to describe):

```json
{
  "remediationId": "jvm.sbt.no-lockfile",
  "actions": [
    {
      "kind": "config",
      "command": "Enable sbt dependency locking so the build writes build.sbt.lock"
    },
    {
      "kind": "build",
      "command": "sbt -batch compile"
    },
    {
      "kind": "rerun"
    }
  ],
  "verify": {
    "rules": ["BF-JVM-001"],
    "expectTier": "resolved"
  }
}
```

## Fields on an action

- `kind` — one of `install`, `env`, `build`, `config`, `container`, `rerun`.
- `command` — the action itself. Prose for `config` and some `env` actions; a
  shell command for `install`, `build`, `container`. Never truncated, always
  safe to paste.
- `windows` — the Windows variant of the command, or `null` together with
  `windowsReason` when none exists (then prefer the `container` action's
  `%cd%` variant or name the reason to the user). An action without a
  `windows` field runs the same `command` on every platform.
- `tool` / `via` — which tool the action installs and through which
  provisioner (`sdkman`, `winget`, `manual`).
- `versionFrom` — where the version for a `{{version}}` placeholder comes
  from: `expected` (the project's own pin, found in the ecosystem row's
  `tools.expected` entries) or `latest`. When the report recorded no expected
  version, the placeholder has no substitute — ask the user; never invent one
  silently. `{{major}}` resolves to the wanted version's major line.

## Blocked entries

An entry with `blocked: true` and a `blockedReason` would help, but this
environment cannot apply it: secure mode or a command allowlist denied the
install, the network is offline or host-blocked, the run is a dry-run, or a
container action would run inside a container. Blocked entries keep their
score projection. They are information for the human — lift the constraint and
they become actionable — and the loop's correct response to a candidate list
made entirely of blocked entries is to stop and report `blocked`, never to
substitute a workaround the report did not emit.

## Verifying a fix

Judge the applied fix by the *next* iteration's report, using the entry's
`verify` clause: every rule named in `rules` must stop firing, the ecosystem
tier must reach `expectTier`, and no further event of an `eventsCleared`
remediation id may be recorded. A build that exited 0 proves nothing on its
own. Record the outcome in `.cdxgen/introspection-history.json` as `verified`,
`no-change`, or `failed`; `no-change` and `failed` outcomes are never retried
at the same `inputsFingerprint`.
