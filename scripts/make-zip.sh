#!/usr/bin/env bash
#
# The one zip, built the same way every time.
#
#   bash scripts/make-zip.sh            -> ~/Desktop/PFA_Full_Website_<version>.zip
#
# What travels: the site, its code and its tests. What does not: built output,
# node_modules, and the large binaries that never change between releases. The
# second list is KEEP_EXCLUDES in scripts/ship.sh, which is what stops the
# ship's `rsync --delete` removing them from the live tree when the zip arrives
# without them. The two lists must agree, and test/ship-script.test.js holds
# them to it.
#
# The result is around 34 MB, which is more than a chat window will carry. The
# repository is the way this release travels; the zip is for a machine that
# only has the zip.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(grep -o 'pfa-build" content="v[0-9.]*"' index.html | head -1 | sed 's/.*content="v//; s/"$//')"
[ -n "$VERSION" ] || { echo "No build stamp in index.html" >&2; exit 1; }
OUT="$HOME/Desktop/PFA_Full_Website_v${VERSION//./_}.zip"
STAGE="$(mktemp -d)/PFA_Full_Website"

# Previous versions go, so the Desktop does not fill with them.
find "$HOME/Desktop" -maxdepth 1 -name 'PFA_Full_Website_v*.zip' ! -name "$(basename "$OUT")" -print -delete 2>/dev/null || true

mkdir -p "$STAGE"
tar -cf - \
  --exclude='./.git' --exclude='./node_modules' --exclude='./public' \
  --exclude='./functions/node_modules' --exclude='./functions/api' \
  --exclude='./functions/lib' --exclude='./functions/assets' \
  --exclude='./functions/product.html' --exclude='./functions/.env' \
  --exclude='./.DS_Store' \
  --exclude='./resources' --exclude='./media/site/campaign' \
  --exclude='./media/site/campus' --exclude='./media/site/sgacc' \
  --exclude='./test/fixtures/library' --exclude='./media/cinekind-2026/reels/*.mp4' \
  . | (cd "$STAGE" && tar -xf -)

rm -f "$OUT"
(cd "$(dirname "$STAGE")" && zip -qr "$OUT" PFA_Full_Website)
rm -rf "$(dirname "$STAGE")"

SIZE_MB=$(( $(wc -c < "$OUT") / 1048576 ))
echo "$OUT"
echo "  ${SIZE_MB} MB"
[ "$SIZE_MB" -lt 30 ] || echo "  WARNING: over 30 MB, which is more than most places will carry. Add what grew to KEEP_EXCLUDES in scripts/ship.sh and to the list above."
