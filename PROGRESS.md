# PROGRESS — v13/08: cdxrs fetch, batched registry metadata

## Base
- Branch: v13/08-rust-fetch off origin/release/13.0.x @ 4c975a81
- Start gates: 135/0 tests, boundaries 0, lib-paths 0, rs-disable 27/27 ✓

## Result

`cdxrs fetch` is a **registry-agnostic batched HTTP GET**: `{"requests":[{"id",
"url","accept"?,"authRealm"?}]}` on stdin, `{"schemaVersion","results":[...],
"stats":{...}}` on stdout, per-host statistics as NDJSON on stderr.

It contains no knowledge of registries, components or purls. Every field —
`p.description`, `p.license`, the ~35 npm and ~30 cargo provenance properties,
SPDX canonicalisation, cargo integrity normalisation — is still derived by the
same JavaScript that derives it when the binary is absent. The Rust path
therefore cannot produce a different SBOM; it can only produce the same one
sooner. See BLOCKERS.md for why the originally planned postgen-enrichment shape
was replaced.

- HTTP: reqwest + rustls, tokio multi-thread, global and per-host concurrency
  caps, per-host minimum-interval gate with `Retry-After` / `X-RateLimit-Reset`
  override, bounded retries with jittered back-off, streaming body cap.
- Cache: on-disk under cdxgen's cache directory, keyed on URL + method + Accept +
  auth-realm identity + schema version, `ETag`/`Last-Modified` conditional
  revalidation, atomic writes, mode 0600, credential-free on disk.
- JS: `lib/inventory/fetchBatch.js` hoists each metadata function's URLs ahead of
  its loop. Fallback is per URL — a transport failure leaves the URL absent from
  the map and the caller's own `cdxgenAgent.get` runs, as before.

## Measured (contrib/bench-fetch.js, darwin/arm64, node v24.18.0)

Both paths run against the same local registry double with the same injected
per-response latency. Not extrapolated.

| packages | latency | JS serial | Rust cold | Rust warm | speedup |
|---|---|---|---|---|---|
| 200 | 50 ms | 10535 ms | 954 ms | 28 ms | **11.0x** cold, 376x warm |
| 500 | 100 ms | 51321 ms | 3332 ms | 22 ms | **15.4x** cold, 2333x warm |
| 2000 | 100 ms | (not run — ~200 s by construction) | 12915 ms | 43 ms | — |

Peak in-flight concurrency 16, measured after the permits are held rather than
counted as queued tasks. Request counts are identical between the two paths, and
the benchmark fails if the two paths enrich different numbers of packages.

## Concurrency defaults, and why

- Global cap 16.
- Per-host: from a policy table rather than one number. crates.io, GitHub,
  GitLab and pkg.go.dev get 4 concurrent and a 250 ms minimum interval, which is
  what they publish for anonymous clients. Hosts with no published limit —
  registry.npmjs.org, pypi.org, pub.dev — get the global cap and no interval.
  This matters more than it looks: a single-registry project has one host, so a
  conservative per-host cap *is* the global cap. Capping npm at 4 held the 200
  package benchmark at 3.9x; the policy table took it to 11x.
- `--per-host-concurrency` overrides the policy for every host.
- Retries: 3 attempts, jittered exponential back-off capped at 30 s, bounded by
  a 120 s per-request deadline as well as an attempt count. Never retries a 4xx
  other than 429.
- Timeouts: 10 s connect, 30 s read, 60 s per attempt, all configurable.

## Commits

### cdxgen-plugins-bin (thirdparty/cdxrs)
1. `1444e0b` — first implementation (superseded)
2. `87058eb` — first tests (superseded)
3. `c4ec2e7` — rewrite as registry-agnostic batched GET; correctly keyed
   conditional cache; bounded retries; credential redaction
4. `104d5b9` — per-host concurrency policy; real in-flight concurrency gauge

### cdxgen
5. `6f002c26` — postgen enrichment pass (superseded)
6. `c8ae0b8a` — benchmark, docs (superseded)
7. `d85161df` — types (superseded)
8. `aa0c810c` — batch at the pkgList boundary; parity harness
9. `ad79c234` — pin the global pnpm in the linux standalone builds

## Final gates (all verified)
- `pnpm test`: **136/0** ✓
- `pnpm run test:deno`: 1/0 ✓
- `pnpm run test:golden`: 27 / 30 / 135 / 8 / **7** ✓ (the 7 is the new fetch
  parity suite)
- `pnpm run test:rs-disable`: 27/27 byte-identical ✓ — but see BLOCKERS.md: no
  golden scenario sets `FETCH_LICENSE`, so this gate does not reach fetch
- `pnpm run lint:check`: 0 warnings ✓
- `check-boundaries --strict`: exit 0 ✓
- `check-lib-paths`: exit 0 ✓
- purl sweep: 41/41 clean, 0 invalid ✓
- `cargo test`: 32 lib + 27 fetch + 9 validate + 2 + 29 = **99 passed, 0 failed** ✓
- `cargo clippy --all-targets -- -D warnings`: clean ✓
- `cargo fmt --check`: clean ✓
