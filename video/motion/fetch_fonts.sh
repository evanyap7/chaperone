#!/bin/sh
# Download the design-system fonts (Lexend, Source Sans 3, JetBrains Mono) as
# variable TTFs from the google/fonts repo into video/motion/fonts/ (gitignored).
# Pillow selects weights via the FreeType variation API (see video/motion/ds.py).
# Deterministic: pinned to the main branch; re-run any time to re-fetch.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="$HERE/fonts"
mkdir -p "$DEST"
base="https://raw.githubusercontent.com/google/fonts/main/ofl"
fetch() { # fetch <url> <out>
  if [ -s "$DEST/$2" ]; then echo "have $2"; return; fi
  echo "fetching $2"
  curl -fsSL --retry 3 -o "$DEST/$2.part" "$1" && mv "$DEST/$2.part" "$DEST/$2"
}
fetch "$base/lexend/Lexend%5Bwght%5D.ttf"                    "Lexend.ttf"
fetch "$base/sourcesans3/SourceSans3%5Bwght%5D.ttf"          "SourceSans3.ttf"
fetch "$base/sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf"   "SourceSans3-Italic.ttf"
fetch "$base/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"      "JetBrainsMono.ttf"
echo "fonts ready in $DEST"
