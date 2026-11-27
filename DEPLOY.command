#!/bin/bash
#
# Double-click me to ship this tree.
#
# This is the whole pipeline that used to be one long pasted line, minus the
# `git pull` that opened it. That pull assumed ~/Desktop/PFA_Website was a git
# checkout; it is not one, so the line died on its first step three times in a
# row on 16 Sep 2026 while everything after it, the actual deploy, never ran.
# scripts/ship.sh manages the live tree and its git history itself, so nothing
# here needs to pull anything first.
#
# What this does, in order:
#   1. installs dependencies in THIS folder (wherever it was unzipped)
#   2. fetches the CineKind, founder-film and unit media, best effort: if a
#      third-party site is down the deploy still proceeds, because ship.sh
#      runs the full test suite and the suite is the backstop for half-done
#      media, not this script
#   3. hands over to scripts/ship.sh, which checks the Firebase project, the
#      key, the admin claim and the sign-in, runs all the tests, and only
#      then backs up ~/Desktop/PFA_Website, replaces it, commits and pushes
#   4. waits, then reads the live site's build stamp back so the last line
#      on screen is proof of what is actually deployed
#
# If anything fails, ship.sh prints STOPPED with the reason and the live
# tree and site are untouched. Close the window, fix what it names, and
# double-click again.
#
# macOS may refuse the first double-click of a downloaded script with
# "cannot be opened because it is from an unidentified developer".
# Right-click the file, choose Open, then Open again. Once is enough.

set -euo pipefail

# A double-clicked .command does not read the shell profile, so Homebrew's
# node is not on PATH unless it is put there.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$(dirname "$0")"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

EMAIL="${1:-karthik.dhanya11@gmail.com}"
# The public address since Oct 2026 (book.pfaevents.buzz no longer serves the
# site, so the read-back below could never find a build there), served by
# Firebase Hosting since 26 Nov 2026. -L follows its clean-URL redirect.
SITE_URL="https://peopleforanimalsindia.org"
LIVE_URL="$SITE_URL/"

command -v node >/dev/null || { printf '\n\033[31mSTOPPED: node is not installed or not on PATH.\033[0m\n  Install it from nodejs.org or via Homebrew, then double-click again.\n'; exit 1; }

step "Deploying from $(pwd) as $EMAIL"

step "Installing dependencies"
npm install --silent

step "Making sure the content the zip does not carry is here"
# Six folders live in the repository and never travel in the zip, so the zip
# stays one file: the library's PDFs, its test PDFs, the campaign, campus and
# SGACC photographs, and the CineKind reels' videos. They are KEEP_PATHS in
# scripts/ship.sh, and this reads that list rather than keeping a second one.
# Each is taken from the live tree when it has it, and whatever is still
# missing from GitHub, so the tests see the whole site and the push deletes
# nothing.
# 8 Oct 2026: the live tree had lost resources/ and the copy stopped.
# 22 Oct 2026: only the library was restored here, so a tree without the
# reels' videos or a microsite's photographs stopped the ship at "everything
# KEEP_EXCLUDES names is really in the repository".
eval "$(grep '^KEEP_PATHS=(' scripts/ship.sh)"
LIVE_TREE="$HOME/Desktop/PFA_Website"
# a folder counts as here when it holds what the zip leaves out of it
have() {
  case "$1" in
    media/cinekind-2026/reels) ls "$1"/*.mp4 >/dev/null 2>&1 ;;
    *) [ -n "$(ls -A "$1" 2>/dev/null)" ] ;;
  esac
}
NEED=""
for p in "${KEEP_PATHS[@]}"; do
  if ! have "$p" && [ -d "$LIVE_TREE/$p" ]; then
    mkdir -p "$p" && { cp -R -n "$LIVE_TREE/$p/." "$p/" 2>/dev/null || true; }
  fi
  have "$p" || NEED="$NEED $p"
done
if [ -n "$NEED" ]; then
  REPO_URL="$(git -C "$LIVE_TREE" remote get-url origin 2>/dev/null || echo https://github.com/askrapidresponseteam-cloud/pfa-demo.git)"
  echo "  from GitHub ($REPO_URL):$NEED"
  TMP_RES="$(mktemp -d)"
  if git clone -q --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TMP_RES/repo" && git -C "$TMP_RES/repo" sparse-checkout set $NEED; then
    for p in $NEED; do
      if [ -d "$TMP_RES/repo/$p" ]; then mkdir -p "$p" && { cp -R -n "$TMP_RES/repo/$p/." "$p/" 2>/dev/null || true; }; fi
    done
  fi
  rm -rf "$TMP_RES"
fi
for p in "${KEEP_PATHS[@]}"; do
  have "$p" || echo "  still missing: $p (the tests below will name it)"
done
# Documents taken off the shelves on purpose (data/library-withdrawn.json):
# their PDFs are deleted here, so the deploy removes them from the repository.
node scripts/withdraw-library.js
echo "  $(ls resources | wc -l | tr -d ' ') library documents, $(ls test/fixtures/library 2>/dev/null | wc -l | tr -d ' ') test PDFs"


step "Fetching media (best effort; the test suite is the backstop)"
# The microsites' photographs (data/site-photos.json) come from PFA's old site.
# Since v1.647 they travel in the zip itself (2.7 MB, resized), because the
# deploy removes the previous tree before unpacking and the old site could not
# always be reached: the SGACC, campus and Gau Seva pages lost their pictures.
# Once fetched they are in the live tree, so they are taken from there first and
# survive the old site going away; only what is still missing is fetched.
if [ -d "$HOME/Desktop/PFA_Website/media/site" ]; then
  mkdir -p media/site && cp -R -n "$HOME/Desktop/PFA_Website/media/site/." media/site/ 2>/dev/null || true
fi
npm run media:site || echo "  Some site photographs could not be fetched; their frames show a plain plate until a later run fetches them"
node scripts/fetch-cinekind-media.js --rewrite || echo "  CineKind media fetch failed; continuing, the tests will judge the tree"
npm run media:films -- --rewrite || echo "  founder-film fetch failed; continuing"
npm run media:units || echo "  unit-photo fetch failed; continuing"
npm run media:library || echo "  Some library documents could not be fetched from Google Drive; they open in Drive's viewer until a later run fetches them"
node scripts/build-events.js || echo "  The events list could not be written; the test suite will stop the deploy and name the entry"
node scripts/build-newsroom.js || echo "  The newsroom could not be written; the test suite will stop the deploy and name the story"
node scripts/build-library.js || echo "  The library could not be written; the test suite will stop the deploy and name the entry"

step "Checking every form reaches the admin panel and sends its acknowledgement (offline)"
node scripts/check-emails.js --brief || echo "  The email check found a problem; the test suite in scripts/ship.sh runs it too and will stop the deploy."

step "Handing over to scripts/ship.sh"
bash scripts/ship.sh "$EMAIL"

step "Reading the live build stamp back"
sleep 45
LIVE="$(curl -sL "$LIVE_URL" | grep -o 'pfa-build" content="[^"]*"' || true)"
if [ -n "$LIVE" ]; then
  printf '\nLIVE BUILD IS: %s\n' "$LIVE"
else
  printf '\nCould not read %s just now. Give it a minute and open the site yourself;\nthe deploy above already finished.\n' "$LIVE_URL"
fi

step "Checking automated email is switched on in production"
HEALTH_URL="$SITE_URL/api/payment/health"
HEALTH="$(curl -s "$HEALTH_URL" || true)"
case "$HEALTH" in
  *'"mail":true'*)  printf 'EMAIL IS ON: acknowledgements, receipts and welcome letters can be sent.\n' ;;
  *'"mail":false'*) printf '\033[31mEMAIL IS OFF: PFA_MAIL_API_KEY is not set on Firebase.\033[0m\n  Every form still reaches the admin panel, but nobody is sent an acknowledgement or a welcome letter.\n  Put PFA_SET_PFA_MAIL_API_KEY=<the key> in front of the deploy command, or run:\n  npx firebase-tools functions:secrets:set PFA_MAIL_API_KEY --project pfa-new-website, then deploy again.\n' ;;
  *) printf 'Could not read %s just now. Open it in a browser and look for "mail":true.\n' "$HEALTH_URL" ;;
esac

case "$HEALTH" in
  *'"files":"storage"'*)  printf 'PHOTOS ARE KEPT IN: Firebase Storage (the low-cost store).\n' ;;
  *'"files":"database"'*) printf '\033[33mPHOTOS ARE KEPT IN: the database.\033[0m Switch Storage on to store them for less:\n  Firebase console > pfa-new-website > Storage > Get started (production mode, Mumbai). No deploy needed after.\n' ;;
esac

step "Checking the domain is served by Firebase"
# Vercel is gone (26 Nov 2026: "there is no vercel anymore. it is firebase"):
# peopleforanimalsindia.org, the admin panel and the API are all Firebase,
# one server and one set of settings. This only says if the address is still
# pointed anywhere else.
HEADERS="$(curl -sI "$LIVE_URL" || true)"
case "$HEADERS" in
  *[Xx]-[Vv]ercel*) printf '\033[31mThe domain still answers from Vercel.\033[0m Point the A record in GoDaddy at 199.36.158.100 (Firebase).\n' ;;
  '') printf 'Could not read %s just now.\n' "$LIVE_URL" ;;
  *) printf 'SERVED BY FIREBASE: %s\n' "$SITE_URL" ;;
esac

printf '\nDone. You can close this window.\n'
