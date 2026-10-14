#!/usr/bin/env bash
# Download the Pyodide core files into app/pyodide/.
# The artifact sandbox blocks runtime fetches from CDNs, so these files are
# published alongside the page and loaded by relative URL.
# Publish every file in app/pyodide/ except python_stdlib.zip (kept for local use).
set -euo pipefail

VERSION="0.26.4"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/app/pyodide"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(cd "$TMP" && npm pack "pyodide@$VERSION" --silent >/dev/null && tar xzf "pyodide-$VERSION.tgz")

mkdir -p "$DEST"
for f in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do
  cp "$TMP/package/$f" "$DEST/$f"
done
# Artifacts do not serve .zip files. Ship the stdlib base64-encoded as text;
# the page decodes it and passes it to loadPyodide({stdLibURL}) as a blob URL.
base64 -w 0 "$DEST/python_stdlib.zip" > "$DEST/python_stdlib.zip.b64.txt"

echo "Pyodide $VERSION core files copied to $DEST"
ls -la "$DEST"
