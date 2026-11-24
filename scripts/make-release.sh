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

# The server and its modules: Python standard library only. Every webdoc_*.py,
# not a list: a hand-kept list went stale when webdoc_runs, webdoc_result_store
# and webdoc_tables were added, and serve.py then failed on import.
# bootstrap_admin.py is how the first administrator is created once accounts
# are switched on; without it a release could enable auth but never sign in.
cp "$HERE"/serve.py "$HERE"/webdoc_*.py "$HERE"/bootstrap_admin.py "$DEST"/
cp "$HERE"/config.json "$HERE"/LICENSE "$DEST"/ 2>/dev/null || true

# The setup and configuration guide is the first thing a user should read.
cp "$HERE"/SETUP.md "$DEST"/

# The browser app: markup, styles, icons, assets, and the COMPILED output.
mkdir -p "$DEST/app"
cp "$HERE"/app/index.html "$DEST/app/"
cp -r "$HERE"/app/css "$HERE"/app/icons "$HERE"/app/js "$HERE"/app/build "$DEST/app/"
[ -d "$HERE/app/assets" ] && cp -r "$HERE"/app/assets "$DEST/app/"
[ -d "$HERE/app/data" ] && cp -r "$HERE"/app/data "$DEST/app/"

# The renderer-plugin facades (compiled, one per plugin config.json may name)
# and any helper folder a plugin keeps beside its facade (model-viewer/ holds
# its modules and stylesheet). Never a vendored library: mermaid.min.js and
# softwaredesigner.js are bring-your-own, so a local package matches the one CI
# builds from a clean checkout, where neither file exists.
mkdir -p "$DEST/app/thirdpartyrenderer"
for item in "$HERE"/app/thirdpartyrenderer/*; do
  case "$(basename "$item")" in
    *.min.js|softwaredesigner.js|*.bak*|*.md) continue ;;
  esac
  if [ -f "$item" ] && [ "${item##*.}" = "js" ]; then
    cp "$item" "$DEST/app/thirdpartyrenderer/"
  elif [ -d "$item" ]; then
    cp -r "$item" "$DEST/app/thirdpartyrenderer/"
  fi
done
find "$DEST/app/thirdpartyrenderer" \( -name '*.min.js' -o -name '*.bak*' \) -delete

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

SETUP.md is the full guide: installing, pointing the server at your own
documents, accounts, test results, plugins and widgets, and serving to other
people.

The browser code in app/js/ and app/build/ is COMPILED OUTPUT. To change it you
want the repository rather than this archive - the TypeScript and Svelte sources
live there, along with the build.
TXT

echo "make-release: assembled $DEST"
