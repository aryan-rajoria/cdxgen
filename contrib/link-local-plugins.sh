#!/usr/bin/env bash
#
# Stage locally-built cdxgen-plugins-bin binaries so this cdxgen checkout uses
# them, without publishing to npm and without touching package.json.
#
# Why not `pnpm link`? Binary discovery in lib/ecosystems/plugins.js is entirely
# path-based: cdxgen looks for
#   <pluginsDir>/<tool>/<tool>-<platform>-<arch>
# and `pluginsDir` is either $CDXGEN_PLUGINS_DIR or a node_modules lookup. The
# version pinned in package.json is only used to build npx/global-store paths,
# so aligning it to 3.0.0 does nothing for local testing. Meanwhile the platform
# packages' `plugins/` directories are empty in git (the binaries are build
# artifacts), so linking a package would give you an empty plugins dir.
#
# This script therefore builds a composite plugins directory: symlinks to the
# plugins you already have installed, plus the locally-built binaries layered on
# top. Everything else keeps working, and you get to exercise the real resolver
# including its filename convention -- which a bare CDXRS_CMD override skips.
#
# Usage:
#   ./contrib/link-local-plugins.sh [tool ...]     # default: cdxrs
#
# Then, in the shell where you want it active:
#   export CDXGEN_PLUGINS_DIR=<printed path>
#
# To go back to the published binaries, unset CDXGEN_PLUGINS_DIR.

set -euo pipefail

PLUGINS_BIN_REPO="${PLUGINS_BIN_REPO:-$(cd "$(dirname "$0")/../../cdxgen-plugins-bin" && pwd)}"
STAGE_DIR="${CDXGEN_LOCAL_PLUGINS_DIR:-${TMPDIR:-/tmp}/cdxgen-local-plugins}"
TOOLS=("${@:-cdxrs}")

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux)  platform="linux" ;;
  *)      echo "unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="amd64" ;;
  *)             echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

if [[ ! -d "$PLUGINS_BIN_REPO" ]]; then
  echo "cdxgen-plugins-bin not found at $PLUGINS_BIN_REPO" >&2
  echo "Set PLUGINS_BIN_REPO to its location." >&2
  exit 1
fi

# Seed from the installed platform package so unrelated plugins still resolve.
installed="$(cd "$(dirname "$0")/.." && pwd)/node_modules/@cdxgen/cdxgen-plugins-bin-${platform}-${arch}/plugins"

mkdir -p "$STAGE_DIR"
if [[ -d "$installed" ]]; then
  for entry in "$installed"/*; do
    [[ -e "$entry" ]] || continue
    ln -sfn "$entry" "$STAGE_DIR/$(basename "$entry")"
  done
else
  echo "note: no installed plugins at $installed; staging local builds only." >&2
fi

for tool in "${TOOLS[@]}"; do
  built="$PLUGINS_BIN_REPO/thirdparty/$tool/build/${tool}-${platform}-${arch}"
  if [[ ! -f "$built" ]]; then
    echo "error: $built not built." >&2
    echo "       Run: make -C $PLUGINS_BIN_REPO/thirdparty/$tool ${platform}" >&2
    exit 1
  fi
  # Replace the seeded symlink (if any) with a real directory we own, so the
  # local build shadows the installed one instead of writing through the link.
  rm -rf "$STAGE_DIR/$tool"
  mkdir -p "$STAGE_DIR/$tool"
  cp "$built" "$STAGE_DIR/$tool/${tool}-${platform}-${arch}"
  echo "staged $tool -> $STAGE_DIR/$tool/${tool}-${platform}-${arch}"
done

echo
echo "Activate with:"
echo "  export CDXGEN_PLUGINS_DIR=$STAGE_DIR"
echo
echo "Verify with:"
echo "  node bin/cdxgen.js --version --verbose"
