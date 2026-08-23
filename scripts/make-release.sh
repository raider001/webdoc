#!/usr/bin/env bash
# make-release.sh - assemble a tree that runs on a Python interpreter alone.
#
# This is what a GitHub release ships, and it is the ONLY thing that keeps
# sys_9 true now that the compiled output is no longer committed. Run it after
# `npm run build`; it copies the runnable subset and nothing else.
#
# Deliberately excluded: src/ (TypeScript sources), app/svelte/ (components),
# node_modules/, tests/, and every build config. A user unpacking this should
# not be handed a half-toolchain they cannot use - if they want to build, they
# want the repository, not the release.
set -euo pipefail

DEST="${1:?usage: make-release.sh <destination-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Refuse to package an unbuilt tree. Silently shipping a tarball whose app/js is
# missing would reproduce, for every user at once, exactly the failure that
# untracking the output introduced.
for required in "app/js/main.js" "app/build/islands.js"; do
  if [ ! -f "$HERE/$required" ]; then
    echo "make-release: $required is missing - run 'npm run build' first" >&2
    exit 1
  fi
done

rm -rf "$DEST"
mkdir -p "$DEST"

# The server and its modules: Python standard library only.
cp "$HERE"/serve.py "$HERE"/webdoc_index.py "$HERE"/webdoc_auth.py "$HERE"/webdoc_access.py "$DEST"/
cp "$HERE"/config.json "$HERE"/LICENSE "$DEST"/ 2>/dev/null || true

# The browser app: markup, styles, icons, assets, and the COMPILED output.
mkdir -p "$DEST/app"
cp "$HERE"/app/index.html "$DEST/app/"
cp -r "$HERE"/app/css "$HERE"/app/icons "$HERE"/app/js "$HERE"/app/build "$DEST/app/"
[ -d "$HERE/app/assets" ] && cp -r "$HERE"/app/assets "$DEST/app/"
[ -d "$HERE/app/data" ] && cp -r "$HERE"/app/data "$DEST/app/"

# The renderer-plugin facade, but never a vendored library: mermaid.min.js is
# bring-your-own and is not ours to redistribute.
mkdir -p "$DEST/app/thirdpartyrenderer"
cp "$HERE"/app/thirdpartyrenderer/mermaid.js "$DEST/app/thirdpartyrenderer/" 2>/dev/null || true

# The documentation set, which is also the demo corpus.
cp -r "$HERE"/docs "$DEST/"

# Strip the type declarations: they are for editors, not for browsers, and the
# server would happily serve them to anyone who asked.
find "$DEST/app" -name '*.d.ts' -delete

cat > "$DEST/README.txt" <<'TXT'
WebDocs
=======

Everything here is ready to run. You need a Python 3 interpreter and nothing
else - no Node.js, no npm, no network, no install step.

    python serve.py

Then open http://127.0.0.1:8000 .

    python serve.py --port 9000        a different port
    python serve.py --config my.json   a different set of documents

The browser code in app/js/ and app/build/ is COMPILED OUTPUT. To change it you
want the repository rather than this archive - the TypeScript and Svelte sources
live there, along with the build.

Diagrams are bring-your-own: drop mermaid.min.js into app/thirdpartyrenderer/
and mermaid fences render as diagrams. Without it they stay plain code blocks
and everything else works normally.
TXT

echo "make-release: assembled $DEST"
