# Lesson 24 - Running cdxgen in server mode

Up to now every cdxgen invocation has been a one-shot CLI call: spawn a process,
scan a path, write a BOM, exit. That model is simple and maps cleanly to CI, but
it pays a cold-start tax on every run. The Node runtime, the parsers, and the
data tables all load from scratch each time. For a team that generates dozens of
BOMs an hour, that repeated setup is pure waste.

cdxgen ships a long-running HTTP server that keeps everything warm. One process
serves many scans. This lesson shows how to start it, how to call it, and how to
harden it before it leaves your laptop.

## Goal

By the end of this lesson you should be able to answer:

1. How do I start the cdxgen server and check that it is alive?
2. How do I request a BOM over HTTP for a local path, a git URL, or a purl?
3. What does the server do with multi-project and multi-type scans?
4. Which environment variables actually protect a networked server?
5. How do I run the server as a shared SBOM service for many CI pipelines?

## 1) Start the server

The package exposes a server binary, and the CLI has a `--server` flag. Both
reach the same `start()` function in `lib/server/server.js`.

```shell
# default: listens on 127.0.0.1:9090
cdxgen --server

# pick an interface and port
cdxgen --server --server-host 127.0.0.1 --server-port 9091
```

The first log line tells you what you have:

```
cdxgen server version 13.0.0
Listening on 127.0.0.1 9090 without authentication!
```

That "without authentication!" line is not a warning to ignore. It means the
server performs no request-level authentication of its own. You are expected to
put it behind a trusted network, a reverse proxy that authenticates, or both.
The hardening controls in section 4 constrain what the server can do, but they
do not prove who is calling it.

The server configures its timeouts through `configureServer()`. The effective
limit is `CDXGEN_SERVER_TIMEOUT_MS`, defaulting to 10 minutes per request. A
scan that takes longer than that is cut off, so size large repos accordingly.

```shell
export CDXGEN_SERVER_TIMEOUT_MS=1800000   # 30 minutes
cdxgen --server
```

## 2) Health check

Before a pipeline trusts the server, it should probe `/health`. The handler is
trivial and returns a small JSON document:

```shell
curl -s "http://127.0.0.1:9090/health"
```

```json
{
  "status": "OK"
}
```

Use this as a readiness gate in CI. A non-200 (or a connection refused) means
"wait, then retry", not "fail the build".

## 3) Request a BOM with /sbom

The `/sbom` route accepts both `GET` and `POST`. Parameters can be passed on the
query string or in a JSON body; query parameters win when both are set. The
route handles three kinds of input through the `path` or `url` parameter:

- a local absolute path,
- a remote git URL,
- a package URL (`pkg:...`).

### Local path

```shell
curl -s "http://127.0.0.1:9090/sbom?path=/home/runner/work/app&type=js&multiProject=true" \
  | jq '.components | length'
```

### Git URL

```shell
curl -s "http://127.0.0.1:9090/sbom?url=https://github.com/HooliCorp/vulnerable-aws-koa-app.git&type=js&multiProject=true" \
  | jq '.metadata.component'
```

For private repos, prefer short-lived tokens sourced from the environment rather
than credentials typed into a shell history. URL-embedded credentials can leak
through process lists, logs, and proxies.

```shell
export GH_TOKEN="<short-lived-token>"
curl -s "http://127.0.0.1:9090/sbom?url=https://${GH_TOKEN}@github.com/org/repo.git&type=js"
```

### Package URL

```shell
curl -s "http://127.0.0.1:9090/sbom?url=pkg:npm/lodash@4.17.21&type=js" \
  | jq '.components[0].purl'
```

For purl requests cdxgen resolves a repository URL from registry metadata.
Treat the result with caution: registry metadata may be inaccurate or
malicious, which is exactly why the host allow-list in section 4 matters.

### POST a JSON body

POST is useful when the query string would get long or when a secret must ride
in the body rather than the URL:

```shell
curl -s -H "Content-Type: application/json" http://127.0.0.1:9090/sbom -X POST \
  -d '{"path": "/home/runner/work/app", "type": "js", "multiProject": true, "specVersion": "1.6"}'
```

### Multi-project and multi-type scans

There is no separate `/sbom-multi` route. The single `/sbom` endpoint already
covers both cases through its parameters:

- `multiProject=true` turns on workspace and monorepo recursion, the same flag
  as the CLI's `--multi-project`.
- `type` accepts a comma-separated list, mirroring `cdxgen -t js,java,python`.

```shell
curl -s "http://127.0.0.1:9090/sbom?path=/srv/monorepo&type=js,java&multiProject=true" \
  | jq '.components | group_by(.type) | map({type: .[0].type, count: length})'
```

The allowed parameters and their behaviour match the CLI. A full list lives in
[`SERVER.md`](SERVER.md), including `lifecycle`, `profile`, `deep`,
`includeCrypto`, `specVersion`, `format`, `filter`, `only`, and the
Dependency-Track submission fields (`serverUrl`, `apiKey`, `projectId`).

### Output formats

Pass `format=spdx` to receive an SPDX document instead of CycloneDX. The server
runs the same CycloneDX-to-SPDX converter the CLI uses, so the output is
consistent across both entry points.

```shell
curl -s "http://127.0.0.1:9090/sbom?path=/home/runner/work/app&type=js&format=spdx" \
  | jq '.spdxVersion'
```

### Error responses

The route returns structured JSON for every failure path, so a pipeline can
branch on the body rather than parsing stderr:

| Status | Cause                                                     |
| ------ | --------------------------------------------------------- |
| 400    | Unsupported purl source, invalid spec version, bad DT URL |
| 403    | Path or host rejected by an allow-list                    |
| 405    | Non-GET/POST method                                       |
| 500    | Missing `path`/`url`, or unexpected generation error      |

## 4) Harden the server

The startup logs print a security-risk line for each gap it notices, and in
secure mode those gaps become fatal. The four controls below are the ones that
actually matter for a networked deployment.

### Restrict git hosts (SSRF defence)

Without an allow-list, any caller can ask the server to clone a URL from an
arbitrary host, which is the classic server-side request forgery surface. Set
`CDXGEN_GIT_ALLOWED_HOSTS` (or its server alias `CDXGEN_SERVER_ALLOWED_HOSTS`)
to the exact hosts your pipelines are allowed to reach:

```shell
export CDXGEN_GIT_ALLOWED_HOSTS="github.com,gitlab.com"
cdxgen --server
```

Requests for other hosts are rejected with a 403 before any clone happens.

### Restrict local paths

If the server reads local paths, an unbounded input lets a caller point at
`/etc` or a secrets directory. `CDXGEN_ALLOWED_PATHS` (or
`CDXGEN_SERVER_ALLOWED_PATHS`) limits the readable roots:

```shell
export CDXGEN_ALLOWED_PATHS="/mnt/work,/mnt/repos"
cdxgen --server
```

### Restrict git protocols

By default cdxgen permits `https`, `git`, and `ssh`, and blocks the `ext::` and
`fd::` transport helpers that can execute commands. Tighten further with
`CDXGEN_GIT_ALLOW_PROTOCOL`:

```shell
export CDXGEN_GIT_ALLOW_PROTOCOL="https:ssh"
cdxgen --server
```

### There is no built-in API key

The server has no first-party authentication. The `apiKey` parameter exists
only for submitting a finished BOM to a Dependency-Track instance; it does not
authenticate the incoming `/sbom` request. For any non-loopback deployment,
front the server with a reverse proxy or a service mesh that enforces
authentication, and keep `--server-host` on `127.0.0.1` or a private interface.

## 5) Shared SBOM service in CI

The payoff of server mode is amortising startup cost across many jobs. Run one
server as a long-lived sidecar and let every pipeline hit it.

```yaml
# docker-compose.services.yml (sketch)
services:
  cdxgen:
    image: ghcr.io/cdxgen/cdxgen:master
    command: ["--server", "--server-host", "0.0.0.0"]
    ports:
      - "127.0.0.1:9090:9090"
    environment:
      CDXGEN_GIT_ALLOWED_HOSTS: "github.com,gitlab.com"
      CDXGEN_ALLOWED_PATHS: "/mnt/repos"
      CDXGEN_SERVER_TIMEOUT_MS: "1800000"
    volumes:
      - /mnt/repos:/mnt/repos:ro
```

A job then becomes a single curl plus a health gate:

```yaml
- name: Wait for cdxgen server
  run: |
    for i in $(seq 1 30); do
      curl -sf http://127.0.0.1:9090/health && break
      sleep 2
    done

- name: Generate SBOM
  run: |
    curl -s "http://127.0.0.1:9090/sbom?path=${PWD}&type=js&multiProject=true" \
      -o bom.json

- uses: actions/upload-artifact@v4
  with:
    name: bom
    path: bom.json
```

Mount the source read-only, scope the path allow-list to the mount root, and
keep the server on a private address. The server cleans up its own clone
directories in a `finally` block, so git-URL scans do not leave debris behind.

## What to take away

1. `--server` turns cdxgen into a warm, shared HTTP service with two routes:
   `/health` and `/sbom`.
2. One `/sbom` endpoint covers local paths, git URLs, purls, multi-project
   scans, and comma-separated multi-type scans. There is no `/sbom-multi`.
3. The server authenticates nobody on its own. Host, path, and protocol
   allow-lists constrain what it will do, but who can call it is your job.
4. `CDXGEN_SERVER_TIMEOUT_MS` bounds a single request; size it to your slowest
   repo.
5. Health-check before you scan, and front any non-loopback deployment with a
   real authenticating proxy.
