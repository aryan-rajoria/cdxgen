# BLOCKERS — cdxgen

## D05

- **DEFERRED (in review): bumping the plugins-bin pins to 3.0.0.** D05 originally
  raised `@cdxgen/cdxgen-plugins-bin` and its platform optionalDeps from `2.5.1`
  to `3.0.0` and added the missing `linux-riscv64` entry. Both changes are
  correct, but `3.0.0` is not published, so the manifest no longer agreed with
  `pnpm-lock.yaml` and `pnpm install --frozen-lockfile` failed for all 11
  packages — which is how every CI job installs dependencies. The pins have been
  reverted to `2.5.1` on this branch so the branch is installable; `pnpm install
  --frozen-lockfile` is verified green.

  Do this as a single follow-up once plugins-bin `3.0.0` is published: set
  `@cdxgen/cdxgen-plugins-bin` and the 10 platform optionalDeps to `3.0.0`
  (`package.json` lines ~129 and ~171-180), then regenerate `pnpm-lock.yaml` and
  confirm `pnpm install --frozen-lockfile` passes. Keep the platform list as-is —
  `linux-riscv64` is deliberately not pinned by cdxgen.

  Local testing does **not** depend on any of this: binary discovery is
  path-based, so `contrib/link-local-plugins.sh` +`CDXGEN_PLUGINS_DIR` exercises
  a locally-built `cdxrs` against the real resolver regardless of the pinned
  version. See docs/v13/rust.md.

  Note the pins were already stale before D05: `release/13.0.x` pinned `2.5.1`
  against a plugins-bin repo at `2.6.0`.

- **9 of 11 cdxrs cross-build flavours unverified.** Only `darwin-arm64` and
  `darwin-amd64` were built and checksummed. The vendored `zig` used as the
  cross-linker is a Linux ELF binary and cannot execute on macOS, so the Linux,
  musl and Windows targets need a Linux host (i.e. CI). The `Makefile` and the
  per-package `build-*.sh` changes are in place for all 11; they are simply
  unexercised. Binary size is ~0.5 MB against a 250 MB packed budget, so size is
  not a concern for any flavour.
