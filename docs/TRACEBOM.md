# tracebom — Dynamic SBOM CLI

`tracebom` is a dedicated, lean standalone binary for dynamic SBOM generation. It executes a command under the `@cdxgen/safer-exec` sandbox, traces the shared libraries it loads at runtime (`dlopen`), collects HTTP URLs accessed by the process, and produces a CycloneDX JSON Bill-of-Materials file with both library components and enumerated services.

## Synopsis

```bash
tracebom --cmd <command> [options]
```

## Flags

| Flag                  | Type    | Default    | Description                                                                                                      |
| --------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `--cmd`               | string  | —          | **Required.** Command to execute and trace.                                                                      |
| `-d, --working-dir`   | string  | `cwd()`    | Working directory for the traced process.                                                                        |
| `-o, --output`        | string  | `bom.json` | Output SBOM file path.                                                                                           |
| `--spec-version`      | number  | `1.7`      | CycloneDX spec version.                                                                                          |
| `--project-name`      | string  | —          | Override component name.                                                                                         |
| `--project-version`   | string  | —          | Override component version.                                                                                      |
| `--read-paths`        | string  | —          | Comma-separated extra filesystem read paths for the sandbox.                                                     |
| `--write-paths`       | string  | —          | Comma-separated sandbox write paths (overrides default of OS tmpdir).                                            |
| `--max-memory`        | number  | `512`      | Max memory MB for sandbox.                                                                                       |
| `--max-cpu`           | number  | —          | Max CPU cores as fractional number (e.g. `0.5` for half a core).                                                 |
| `--max-processes`     | number  | `64`       | Max process count for sandbox.                                                                                   |
| `--timeout`           | number  | `60000`    | Trace timeout in milliseconds.                                                                                   |
| `--disable-network`   | boolean | `true`     | Disable network inside sandbox. Automatically disabled when `--trace-http-urls` or `--proxy-egress` is set.      |
| `--trace-http-urls`   | boolean | `false`    | Enable eBPF-based HTTP URL tracing (Linux only, kernel >= 5.8). Requires CAP_BPF.                                |
| `--trace-crypto`      | boolean | `true`     | Enable eBPF-based cryptographic library and cipher suite tracing (Linux only, kernel >= 5.8).                    |
| `--crypto-probe-mode` | string  | `tls-only` | Crypto probe mode controlling tracing depth: `tls-only` (default) or `operations` (digest, encrypt, sign).       |
| `--trace-period`      | number  | —          | Stop tracing after N seconds. Useful for tracing long-running or persistent commands.                            |
| `--diff`              | boolean | `false`    | Enable filesystem mutation diffing. Tracks which files are created, modified, or deleted.                        |
| `--strict`            | boolean | `false`    | Treat sandbox setup warnings as hard errors. Useful for CI/CD pipelines.                                         |
| `--allow-host`        | string  | —          | Comma-separated hostnames to allow network access to (when network is enabled).                                  |
| `--allow-port`        | string  | —          | Comma-separated TCP ports to allow network access to.                                                            |
| `--allow-url`         | string  | —          | Comma-separated URL allow rules for fine-grained HTTP access control (Linux only, requires `--trace-http-urls`). |
| `--allow-envs`        | string  | -          | Comma-separated host environment variables allowed to pass through the sandbox.                                  |
| `--allow-hidden`      | boolean | `true`     | Allow reading and writing to hidden files and directories.                                                       |
| `--allow-listen`      | string  | -          | Comma-separated IP addresses or ip:port strings to allow the sandboxed process to bind/listen to.                |
| `--block-fork`        | boolean | `false`    | Prevent the traced process from forking new processes.                                                           |
| `--trace-exec`        | boolean | `false`    | Log every child process spawned by the traced command.                                                           |
| `--allow-exec`        | string  | —          | Comma-separated list of executables the traced command is allowed to run.                                        |
| `--block-exec`        | string  | —          | Comma-separated list of executables to block from running.                                                       |
| `--proxy-egress`      | boolean | `false`    | Route all egress through safer-exec's hostname-pinning proxy. Only `--allow-host`/`--allow-url` hosts are reachable. Enables the network. |
| `--allow-loopback`    | boolean | `false`    | Allow connections to loopback addresses.                                                                         |
| `--sandbox-dry-run`   | boolean | `false`    | Deny every filesystem write and network connection; record attempted-operation counts in the BOM metadata.      |
| `--policy`            | string  | —          | Named safer-exec ecosystem policy (`npm`, `pnpm`, `pypi`, `uv`, `maven`, `cargo`, `gomod`, `nuget`, …), applied before the other options. |
| `--policy-file`       | string  | —          | safer-exec JSON policy file, applied before the other options.                                                  |
| `--block-interpreters` | boolean | `false`   | Block interpreters with sandbox or task-port exemptions (macOS only).                                            |
| `--deny-persistence-writes` | boolean | `false` | Deny writes to LaunchAgents, shell rc files, cron and other persistence locations. `--write-paths` stay writable. |
| `--private-tmp`       | boolean | `false`    | Private `/tmp` and `/var/tmp` mounts (Linux only).                                                               |
| `--protect-home`      | string  | `off`      | Isolate `$HOME`: `off`, `read-only` or `tmpfs` (Linux only).                                                     |
| `--print`             | boolean | `false`    | Print BOM to stdout.                                                                                             |

### Library-only options

`runTrace` in `lib/inventory/traceRunner.js` accepts `sanitizeEnv`, which strips
sensitive environment variables before sandboxed execution. It has no CLI flag;
use `--allow-envs` to control which host variables reach the sandbox from
`tracebom`.

## Examples

```bash
# Trace a Node.js script
tracebom --cmd "node app.js" -o bom.json

# Trace with a custom working directory
tracebom --cmd "node app.js" -d /path/to/app -o bom.json

# Trace with sandbox limits
tracebom --cmd "node app.js" --max-memory 256 --timeout 30000 --print

# Collect HTTP URLs as services from a persistent server (stop after 30 seconds)
tracebom --cmd "node server.js" --trace-http-urls --trace-period 30 -o bom.json

# Trace cryptographic library operations, including digest/encrypt/sign
tracebom --cmd "node app.js" --trace-crypto --crypto-probe-mode operations -o bom.json

# Trace with a CPU limit
tracebom --cmd "node app.js" --max-cpu 0.5 -o bom.json

# Trace with strict mode and filesystem diff (CI/CD use case)
tracebom --cmd "npm install" --strict --diff --write-paths /tmp/npm-cache -o bom.json

# Trace with network allow-lists and fork protection
tracebom --cmd "node server.js" --allow-host registry.npmjs.org,api.github.com --block-fork -o bom.json

# Allow egress only to the npm registry through the hostname-pinning proxy;
# every allowed and denied host becomes a service (works on macOS and Linux)
tracebom --cmd "npm view left-pad version" --proxy-egress --allow-host registry.npmjs.org -o bom.json

# Record what an install script tries to do without letting it do anything
tracebom --cmd "node postinstall.js" --sandbox-dry-run -o bom.json

# Apply the safer-exec npm policy and block persistence writes
tracebom --cmd "npm ci" --policy npm --deny-persistence-writes -o bom.json

# Trace with exec restrictions
tracebom --cmd "npm install" --allow-exec node,npm --block-exec sh,bash -o bom.json
```

## Output

The generated CycloneDX BOM includes:

- **Components:** Shared libraries loaded by the traced process at runtime, with SHA-256 hashes and OS package resolution.
- **Services:** Enumerated HTTP endpoints accessed by the process, grouped by host. Each service includes request URLs as `endpoints` and metadata such as `cdx:service:httpMethod` and `cdx:dynamic:httpQueryParams` (parameter names only; query values are never recorded).
- **Egress services (`--proxy-egress`):** Every host the command connected to or tried to reach through the proxy, as a service whose endpoint is the scheme and authority only, with `cdx:dynamic:egressDecision` set to `allowed` or `denied`.
- **Dry-run metadata (`--sandbox-dry-run`):** `cdx:dynamic:dryRun=true` plus attempted-operation counts such as `cdx:dynamic:dryRun:fileWrites` and `cdx:dynamic:dryRun:networkOutbound` in `metadata.properties`. Paths and targets are not recorded. On Linux the counts need `strace`; without it the side effects are still denied, `cdx:dynamic:dryRun:captured` is `false` and no counts are recorded.

## Sandbox model

The sandbox is enforced by `@cdxgen/safer-exec` using OS-level controls:

- **Linux:** seccomp, Landlock network confinement, cgroup v2 resource limits, namespace isolation
- **macOS:** Seatbelt sandboxing
- **Windows:** No sandbox support — `tracebom` produces an empty component list

The sandbox blocks network access by default, restricts write paths to the OS temp directory, and caps memory/process/timeout resources. Read paths can be extended with `--read-paths`. Network access is automatically re-enabled when `--trace-http-urls` is set.

## Limitations

- `@cdxgen/safer-exec` must be installed (it is an optional dependency of `@cdxgen/cdxgen`)
- Windows has no safer-exec binary; `tracebom` falls back gracefully with an empty component list
- The traced command runs in an isolated sandbox — some programs may behave differently under sandbox restrictions
- HTTP URL tracing (`--trace-http-urls`) requires Linux kernel >= 5.8 with eBPF support and CAP_BPF / CAP_PERFMON capabilities (effectively root)
