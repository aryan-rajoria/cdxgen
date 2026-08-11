# v12 vs v13 benchmarks

## What this measures, and what it does not

These numbers answer one question the v13 plan raised and left open: **did
small projects get slower?** v13 promoted `@cdxgen/cdxgen-plugins-bin` to a
direct dependency, moved atom to native per-platform binaries, and added a
subprocess bridge. Each of those adds fixed cost that a twenty-component
project pays in full and a large monorepo barely notices — and small projects
are the common case.

It is not a full corpus benchmark. Large-repository numbers need a fixed,
pinned corpus and a machine that is not also a development laptop; that is
still outstanding, and this document should not be read as covering it.

## Methodology

- **Machine**: Apple Silicon (arm64), macOS 25.6, Node.js 24.18.0.
- **Comparison**: `@cyclonedx/cdxgen@12.8.2` installed from npm, against v13
  from the working tree, invoked as `node <path>/bin/cdxgen.js`.
- **Repetitions**: one warmup run discarded, then 7 timed runs; the **median**
  is reported. A single run is not a benchmark, and the first run on a cold
  file cache is consistently 1.5–2x slower than the rest.
- **Variance**: the whole A/B was repeated 3 times. An early run showed v13
  _slower_ on startup; that was a cold-cache artefact for the working-tree copy
  and did not reproduce. Treat any single run of this on a busy machine as
  noise — the repeats are the measurement.
- `--no-install-deps` throughout, so no package manager runs and the numbers
  are cdxgen's own cost.

## Startup and small projects

Median of 7, three independent repeats:

| Scenario                     | v12        | v13        | Delta              |
| ---------------------------- | ---------- | ---------- | ------------------ |
| `--version` (startup floor)  | 517–567 ms | 312–327 ms | **~200 ms faster** |
| npm project, no dependencies | 666–685 ms | 356–364 ms | **~310 ms faster** |
| small Python project         | 667–676 ms | 358–365 ms | **~310 ms faster** |

**Small projects did not get slower — they got roughly 45% faster.** The fixed
costs v13 added are more than paid for by what it removed from the startup
path.

The startup floor is the number that matters here. At 312 ms for `--version`,
a zero-dependency project spends about 45 ms on analysis and the rest on
getting cdxgen loaded. For small projects cdxgen is a startup-bound program,
not an analysis-bound one, so module-graph size is the lever.

The largest single contribution measured during v13: removing `cheerio`, whose
module graph cost **71 ms of every invocation** — 29% of module-load time — for
two functions that only run on Go projects. Its 22 transitive packages included
a duplicate major of `undici`.

## Peak memory

| Scenario                     | v12    | v13        |
| ---------------------------- | ------ | ---------- |
| npm project, no dependencies | 223 MB | **178 MB** |

## Install size

|                | v12    | v13                 |
| -------------- | ------ | ------------------- |
| Packed tarball | 2.3 MB | 2.7 MB              |
| Unpacked       | —      | 15.9 MB (697 files) |

The tarball grew ~0.4 MB. `@cdxgen/cdxgen-plugins-bin` is a direct dependency
in v13 rather than an optional add-on, so the _installed_ footprint grows by
considerably more than the tarball suggests. That was an accepted trade in the
v13 plan and it has not been revisited.

## Output differences

Not all deltas are performance. On the PEP 770 fixture:

|                       | v12 | v13   |
| --------------------- | --- | ----- |
| Components discovered | 1   | **2** |

v13 finds the component declared by the distribution's own
`.dist-info/sboms/` directory, which v12 has no support for. Both emit
CycloneDX 1.7.

Behavioural deltas between v12 and v13 are tracked in
`ci/expected-deltas.yaml`, which is currently **empty** — no unexplained
difference has been accepted.

## Reproducing

```bash
npm install --prefix /tmp/bench/v12 @cyclonedx/cdxgen@12
mkdir -p /tmp/bench/tiny && echo '{"name":"tiny","version":"1.0.0"}' \
  > /tmp/bench/tiny/package.json

# median of 7, one warmup discarded
for bin in /tmp/bench/v12/node_modules/@cyclonedx/cdxgen/bin/cdxgen.js \
           ./bin/cdxgen.js; do
  node "$bin" --version >/dev/null 2>&1
  for i in $(seq 1 7); do
    /usr/bin/time -p node "$bin" -t npm /tmp/bench/tiny \
      -o /tmp/bench/out.json --no-install-deps 2>&1 | grep real
  done
done
```

## Still outstanding

- A large-repository corpus with pinned commit SHAs: a big JS monorepo, a large
  Maven project, a large Python project, a container image, and a Rust project.
- Cold-cache versus warm-cache registry numbers, and network request counts.
- Per-stage breakdown for the two `cdxrs`-backed stages. `CDXGEN_RS_DISABLE=all`
  is byte-identical, so the Rust contribution can be isolated cleanly, but with
  only `fetch` and `validate` wired the breakdown has little to show.
