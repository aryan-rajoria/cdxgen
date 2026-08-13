# Lesson 25 - Secure mode, dry-run, and command/path/host allowlists

cdxgen reads your source, spawns build tools, and sometimes reaches out to
registries. That is the whole point of a BOM generator, but it is also a lot of
trust to extend to an arbitrary repository. A malicious manifest or install
script can try to turn cdxgen into a launchpad for command execution, secret
exfiltration, or server-side request forgery.

This lesson covers the three mechanisms cdxgen gives you to bound that trust:
secure mode, dry-run mode, and the command/path/host allow-lists. They are
separate controls with separate jobs, and the practical workflow is to combine
them: dry-run first to see what cdxgen wants to do, then author an allow-list,
then lock the run down with secure mode.

## Goal

By the end of this lesson you should be able to answer:

1. What does secure mode block, and how is it different from dry-run mode?
2. What does a dry-run actually report, and how do I read the activity summary?
3. What are the three allow-lists and what does each one govern?
4. How do I go from an empty config to a tight allow-list without guessing?
5. How do I detect a dangerous environment before the scan even starts?

## 1) Secure mode

Secure mode is the trust-boundary control. It is on when either:

- `CDXGEN_SECURE_MODE=true` (or `1`), or
- Node is launched with `--permission` (the Node.js permission model).

When secure mode is active, cdxgen narrows what it will do:

- automatic dependency installation is disabled by default,
- outbound HTTP must use `https:`,
- dependency-track submission hosts are checked against `CDXGEN_ALLOWED_HOSTS`,
- git protocol helpers `ext::` and `fd::` are rejected,
- HBOM live collection reuses its dry-run plan as a preflight and aborts when a
  declared command or path falls outside the allow-lists.

Secure mode does not, by itself, make cdxgen read-only. It asks "should this
operation be allowed?" rather than "what would happen if it were?". The
enforcement comes from the Node permission model plus the allow-lists, so a
real deployment combines `CDXGEN_SECURE_MODE=true` with a `NODE_OPTIONS` that
carries `--permission` and explicit `--allow-*` scopes.

```shell
export NODE_OPTIONS='--permission --allow-fs-read="/home/runner/work/*" --allow-fs-write="/tmp/*" --allow-child-process'
export CDXGEN_SECURE_MODE=true
node bin/cdxgen.js -t js -o /tmp/bom.json /home/runner/work/app
```

The official `ghcr.io/cdxgen/cdxgen-secure` image ships with a sensible
`NODE_OPTIONS` already set, which is the fastest way to get started.

A useful discovery trick: run with just `CDXGEN_SECURE_MODE=true` and no
`--permission`. cdxgen logs the permission gaps it finds, which is a good first
draft of the `NODE_OPTIONS` string you will eventually hand the runtime.

## 2) Dry-run mode

Dry-run mode is the read-only control. Turn it on with `--dry-run` or
`CDXGEN_DRY_RUN=true`. In dry-run mode cdxgen still walks manifests and reads
files, but it blocks every side effect: writes, temp creation, child processes,
git cloning, and remote submission. Each blocked action is recorded in an
in-memory activity ledger.

The point of dry-run is not to produce a BOM (it cannot, by design). The point
is to show you exactly what a real run would do, classified and deduplicated,
without executing any of it.

```shell
cdxgen -t js --dry-run --activity-report json -o /dev/null .
```

`--activity-report` accepts `json` or `jsonl` and renders the recorded activity.
The ledger records filesystem reads, environment-variable reads, child-process
attempts, network attempts, symlink resolutions, and policy decisions, with
counts and reasons rather than raw values. Secret-bearing variable and file
names are flagged by heuristic category (credential, certificate, private key)
but their values are never emitted.

### What dry-run reveals

Run it against a JavaScript app and you will see the shape of a real scan:

```shell
cdxgen -t js --dry-run --activity-report jsonl ./my-app 2>activity.jsonl
```

A few representative lines from such a report:

```jsonl
{"kind":"discover","target":"./my-app/package.json","status":"completed","reason":"Inspected npm lockfile ./my-app/package-lock.json."}
{"kind":"execute","target":"git","status":"blocked","reason":"Dry run mode blocked the attempted execute operation."}
{"kind":"execute","target":"npm","status":"blocked","reason":"Dry run mode blocked the attempted execute operation."}
{"kind":"env","target":"process.env:NPM_TOKEN","sensitive":true,"status":"completed","reason":"Read sensitive environment variable NPM_TOKEN."}
```

That tells you three things a real run would do: read `package.json`, invoke
`git` and `npm`, and consult `NPM_TOKEN`. None of those happened; they were
recorded as intent. Now you know what to allow.

## 3) The three allow-lists

Each allow-list is a comma-separated environment variable. They are consulted
by the safe wrappers (`safeSpawnSync`, `safeExistsSync`, `safeMkdirSync`, and
the `cdxgenAgent` HTTP hooks), so they apply uniformly across the whole
codebase rather than being sprinkled through call sites.

| Variable                   | Governs                                                      | Enforced by          |
| -------------------------- | ------------------------------------------------------------ | -------------------- |
| `CDXGEN_ALLOWED_COMMANDS`  | Which executables `safeSpawnSync` may run                    | `lib/core/fs.js`     |
| `CDXGEN_ALLOWED_PATHS`     | Which filesystem roots may be read or written                | `lib/core/fs.js`     |
| `CDXGEN_ALLOWED_HOSTS`     | Which hosts outbound HTTP may reach (exact or `*.suffix`)    | `cdxgenAgent` hooks  |
| `CDXGEN_GIT_ALLOWED_HOSTS` | Which hosts git cloning may reach (server-mode SSRF defence) | `lib/server` + clone |

`CDXGEN_ALLOWED_HOSTS` and `CDXGEN_GIT_ALLOWED_HOSTS` overlap on purpose.
`CDXGEN_ALLOWED_HOSTS` is the general HTTP gate (registry lookups, license
fetches, DT submission). `CDXGEN_GIT_ALLOWED_HOSTS` is the clone gate, which
matters most in server mode. When both are unset, the server logs an SSRF
warning at startup.

Host matching supports exact names and `*.suffix` wildcards, and rejects names
that contain dangerous Unicode (homograph defence). A typical JavaScript
allow-list looks like:

```shell
export CDXGEN_ALLOWED_COMMANDS="npm,pnpm,yarn"
export CDXGEN_ALLOWED_HOSTS="registry.npmjs.org,localhost"
export CDXGEN_ALLOWED_PATHS="/home/runner/work/app,/tmp"
```

The platform-specific tables in [`ALLOWED_HOSTS_AND_COMMANDS.md`](ALLOWED_HOSTS_AND_COMMANDS.md)
list the commands and hosts each ecosystem tends to need. Linux scans also want
`ldd`; container scans want `dpkg`, `rpm`, `apk`; .NET on Windows wants `nuget`.

## 4) The practical workflow: dry-run, read, allow

The reliable way to author an allow-list is to observe a real scan rather than
guess. The loop is:

1. Run with `--dry-run` and `--activity-report json`.
2. Read the blocked commands and contacted hosts.
3. Write the allow-list from exactly those observations.
4. Re-run in secure mode and confirm nothing new is blocked.

```shell
# 1. Observe
cdxgen -t js --dry-run --activity-report json -o /dev/null ./my-app \
  > activity.json 2>diagnostics.log

# 2. Inspect the distinct commands and hosts that were blocked or allowed
jq '[.[] | select(.kind=="execute")] | map(.target) | unique' activity.json
jq '[.[] | select(.kind=="network")] | map(.target) | unique' activity.json

# 3. Author the allow-list from what you saw
export CDXGEN_ALLOWED_COMMANDS="git,npm"
export CDXGEN_ALLOWED_HOSTS="registry.npmjs.org,github.com"
export CDXGEN_ALLOWED_PATHS="$(pwd),/tmp"

# 4. Run for real under secure mode
export CDXGEN_SECURE_MODE=true
node --permission --allow-fs-read="$(pwd)/*" --allow-fs-write="/tmp/*" \
  --allow-child-process bin/cdxgen.js -t js -o /tmp/bom.json ./my-app
```

This is the same loop the HBOM collector uses for its secure-mode preflight:
declare what you intend, then abort if reality drifts outside the declaration.

## 5) Detect a dangerous environment with --env-audit

Some of the worst risks to a scan are already in the environment before cdxgen
reads a single file. `--env-audit` (and the `auditEnvironment` function in
`lib/stages/pregen/envAudit.js`) inspects the environment at startup and prints
a findings table. It looks for:

- `NODE_OPTIONS` / `CDXGEN_NODE_OPTIONS` carrying code-execution flags
  (`--require`, `--import`, `--loader`, `--eval`, `--inspect`, `--env-file`)
  or permission flags without an active permission model.
- `NODE_TLS_REJECT_UNAUTHORIZED=0`, which silently disables TLS verification.
- `NODE_PATH`, which enables module-resolution poisoning.
- Credential-shaped variable names (`*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`)
  that build-tool install scripts could read.
- JVM agent injection (`-javaagent`, `-agentlib`) via `JAVA_TOOL_OPTIONS`,
  `MVN_ARGS`, `GRADLE_ARGS` for JVM project types.
- Running as root outside the official container.
- Outbound proxies (`HTTP_PROXY` / `HTTPS_PROXY`) and custom Deno CAs.

```shell
cdxgen -t java --env-audit -o /dev/null .
```

Each finding carries a severity and a mitigation. Treat `high` findings as
build-breakers for untrusted inputs: a malicious repository can read
`NODE_OPTIONS`-injected modules, and a `--require` flag is a direct code
execution vector during SBOM generation.

## 6) CI sketch: a locked-down runner

Putting it all together, a CI job that scans an untrusted checkout should set
the allow-lists up front, gate on `--env-audit`, and run under the Node
permission model:

```yaml
jobs:
  sbom:
    runs-on: ubuntu-latest
    env:
      CDXGEN_SECURE_MODE: "true"
      CDXGEN_ALLOWED_COMMANDS: "npm"
      CDXGEN_ALLOWED_HOSTS: "registry.npmjs.org"
      CDXGEN_ALLOWED_PATHS: "${{ github.workspace }},${{ runner.temp }}"
      NODE_OPTIONS: >-
        --permission
        --allow-fs-read=${{ github.workspace }}/*
        --allow-fs-read=/tmp/*
        --allow-fs-read=/home/runner/*
        --allow-fs-write=${{ github.workspace }}/bom.json
        --allow-fs-write=${{ runner.temp }}/*
        --allow-child-process
    steps:
      - uses: actions/checkout@v4
      - name: Environment audit (informational)
        run: cdxgen -t js --env-audit -o /dev/null . || true
      - name: Generate SBOM
        run: cdxgen -t js -o bom.json .
      - uses: actions/upload-artifact@v4
        with:
          name: bom
          path: bom.json
```

Use absolute paths in `NODE_OPTIONS`, keep `--allow-fs-write` to the output and
temp directories only, and expect to iterate: `--trace-warnings` will name the
extra paths the permission model blocks so you can widen scopes deliberately
rather than with a blanket `*`.

## What to take away

1. Secure mode bounds trust; dry-run mode makes the run read-only. They answer
   different questions and compose cleanly.
2. Dry-run does not produce a BOM. It produces an activity report that tells
   you what a real run would do, with secret-bearing values redacted.
3. The three allow-lists (`CDXGEN_ALLOWED_COMMANDS`, `CDXGEN_ALLOWED_PATHS`,
   `CDXGEN_ALLOWED_HOSTS` plus `CDXGEN_GIT_ALLOWED_HOSTS`) are the enforcement
   layer, applied uniformly through the safe wrappers and the HTTP client.
4. The reliable authoring loop is dry-run, read the report, allow exactly what
   you observed, then re-run under secure mode.
5. `--env-audit` catches risks that predate the scan: injected `NODE_OPTIONS`,
   disabled TLS, credential-bearing variables, and JVM agent flags.
