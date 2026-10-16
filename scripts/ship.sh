#!/usr/bin/env bash
#
# One command, start to finish.
#
#   bash scripts/ship.sh you@peopleforanimalsindia.org
#
# Confirms the tree, the service account and the browser all name the same
# Firebase project, confirms somebody can actually sign in, runs the tests,
# and only then replaces ~/Desktop/PFA_Website (keeping its git history),
# pushes, and deploys the rules.
#
# The order matters and is not negotiable. This release retires the two shared
# admin secrets, so once it is live the ONLY way into /admin.html is a Firebase
# account carrying the admin claim. Pushing before confirming that claim exists
# locks everyone out of the panel with no way back in over the web. So the
# claim is checked first and nothing is pushed if the check fails.
#
# Nor is anything on disk touched first. On 7 Sep 2026 this script picked the
# most recently modified *firebase-adminsdk*.json on the Desktop, which was the
# key for pfa-oldsite, a project this site left. The sign-in check stopped the
# push, but the working tree had already been replaced and the claim granted
# on the wrong project. The key is now chosen by the project it belongs to
# (scripts/firebase-project.js), a key for a retired project is refused
# outright, and every check runs in the unpacked tree before the live one is
# backed up and replaced.
#
# To name the key yourself instead of letting the script find it:
#
#   PFA_SERVICE_ACCOUNT=~/Desktop/that-key.json bash scripts/ship.sh you@...
#
# Nothing here prints a secret. The service account is read from the file,
# held in the environment for the length of this run, and cleared at the end.

set -euo pipefail

EMAIL="${1:-}"
LIVE="$HOME/Desktop/PFA_Website"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/Desktop/PFA_Website_backup_$STAMP"

# The tree this script was unpacked into.
NEW="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$1" >&2; exit 1; }

REMOTE="${2:-https://github.com/askrapidresponseteam-cloud/pfa-demo.git}"

[ -n "$EMAIL" ] || fail "Give your admin email:
  bash scripts/ship.sh YOUR-REAL-EMAIL@example.org"
[ -f "$NEW/admin.html" ] || fail "This does not look like the new tree ($NEW)."

case "$EMAIL" in
  you@*|your@*|admin@example.*|*@example.org|*@example.com)
    fail "\"$EMAIL\" is the example address, not yours.
  Use the email of a real account in Firebase > Authentication > Users." ;;
esac
# A placeholder on a real domain. On 13 Oct 2026 the line above let
# YOUR-EMAIL@peopleforanimalsindia.org through, because it matches neither
# "your@" nor an example domain, and the run went as far as asking Firebase to
# grant the claim before stopping. Matched on the local part, in any case, so
# a real address is never caught by it.
case "$(printf '%s' "${EMAIL%%@*}" | tr '[:upper:]' '[:lower:]')" in
  your-email|youremail|your_email|real-email|yourname|your-name|email|replace-me|replaceme|changeme|change-me|example|admin@example)
    fail "\"$EMAIL\" still has the placeholder in it, not your address.
  Use the email of a real account in Firebase > Authentication > Users." ;;
esac
case "$EMAIL" in *@*.*) ;; *) fail "\"$EMAIL\" is not an email address." ;; esac

# ------------------------------------------------------------- one project?
step "Checking the tree names one Firebase project"
# assets/firebase-config.js, .firebaserc and package.json must agree before a
# key is even looked for; nothing on disk has been touched yet.
node "$NEW/scripts/firebase-project.js" || fail "The tree names more than one Firebase project, or a retired one.
  Nothing has been touched. Make every reference above say the same project."

# ---------------------------------------------------------------- credential
step "Finding the Firebase service account"
if [ -n "${PFA_SERVICE_ACCOUNT:-}" ]; then
  KEY="$PFA_SERVICE_ACCOUNT"
  [ -f "$KEY" ] || fail "PFA_SERVICE_ACCOUNT points at $KEY, which is not a file."
  echo "  using $(basename "$KEY") (named by PFA_SERVICE_ACCOUNT)"
else
  # Chosen by the project it belongs to, never by which file is newest: a key
  # whose project_id is not the one the browser signs in to is skipped, and a
  # key for a retired project is refused whatever the browser says.
  KEY="$(node "$NEW/scripts/firebase-project.js" --find)" || fail "No usable service account key.
  Firebase console > the project named above > Project settings > Service accounts > Generate new private key.
  Do NOT use 'vercel env pull' - those values come back as the text [SENSITIVE]."
  echo "  using $(basename "$KEY")"
fi

step "Checking the key belongs to the project the browser signs in to"
node "$NEW/scripts/firebase-project.js" "$KEY" || fail "Wrong key, or the tree is configured for a different project.
  Nothing has been touched: $LIVE is exactly as it was. Fix what is listed above and run this again."

export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat "$KEY")"
# A shell that has ever sourced a `vercel env pull` file carries the three
# separate variables holding the literal text [SENSITIVE]. The JSON above takes
# precedence so they change nothing, but they make every check below ambiguous.
unset FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY 2>/dev/null || true
cleanup() { unset FIREBASE_SERVICE_ACCOUNT_JSON || true; }
trap cleanup EXIT

# ------------------------------------------- can anyone sign in? (new tree)
# Everything from here to the tree swap runs in the unpacked tree, so a
# failure leaves the live tree untouched.
cd "$NEW"
step "Installing dependencies in the new tree"
npm install --silent

step "Granting the admin claim to $EMAIL"
# Idempotent: granting an account that already has it changes nothing. The key
# was checked above, so this lands on the project the browser signs in to.
node scripts/grant-admin.js "$EMAIL" || fail "Could not grant the claim. Nothing has been touched.
  If it says there is no user record, create the account first:
  Firebase console > Authentication > Users > Add user. The password is set there."

step "Checking sign-in will work"
node scripts/check-admin-setup.js "$EMAIL" || fail "Sign-in would still fail. Nothing has been pushed and $LIVE is untouched.
  Fix what is listed above and run this again."

# ------------------------------------------------------------------- verify
step "Running the tests"
# The reporter is pinned, because Node changed which one it defaults to and
# the counts were being parsed out of whichever format happened to appear.
TESTS="$(npm run --silent test:tap 2>&1 || true)"
PASS="$(printf '%s\n' "$TESTS" | grep -E '^# pass [0-9]+' | tail -1 | tr -dc '0-9')"
FAILED="$(printf '%s\n' "$TESTS" | grep -E '^# fail [0-9]+' | tail -1 | tr -dc '0-9')"

if [ -z "$PASS" ]; then
  printf '%s\n' "$TESTS" | tail -25
  fail "The tests did not run at all - their output is above. Nothing has been pushed and $LIVE is untouched."
fi

echo "  $PASS passing, ${FAILED:-0} failing"
# The suite is green. Any failure at all is new, and stops the ship: there is
# no longer a backlog of known failures for a real one to hide behind.
# A collapse in the number passing stops it too.
if [ "$PASS" -lt 500 ]; then
  printf '%s\n' "$TESTS" | grep -E '^not ok' | head -25
  fail "Only $PASS tests passed, which is not right. Nothing has been pushed and $LIVE is untouched."
fi
if [ "${FAILED:-0}" -gt 0 ]; then
  printf '%s\n' "$TESTS" | grep -E '^not ok' | head -25
  fail "${FAILED} tests failed. The suite is green, so this is a regression. Something in this build broke.
  Nothing has been pushed and $LIVE is untouched."
fi

# ---------------------------------------------------------------- swap trees
# Only now, with the project, the key, the claim, the sign-in and the tests
# all confirmed, does the live tree change.
#
# Built output is never part of the tree, and never copied or backed up:
# public/ is the Firebase bundle, functions/ holds a built copy of the API, and
# node_modules is reinstalled. On 8 Oct 2026 each ship backed up everything,
# .git and all, every backup stayed on the Desktop, public/ was copied into
# the live tree, and the Mac ran out of space half way through the update.
# public/ was about 480 MB then, because it was a full mirror of the site
# including the library's PDFs. Since 13 Oct it is the admin panel only, about
# 350 KB, and the Desktop is quieter for it.
BUILT_EXCLUDES=(--exclude '/public' --exclude '/functions/node_modules' --exclude '/functions/api' --exclude '/functions/lib' --exclude '/functions/assets' --exclude '/functions/product.html' --exclude '/functions/.env')

# Content that lives in the repository and deliberately does not travel in the
# zip, so the zip stays one file (owner, 7 Oct 2026: "need just 1 zip").
#
# These MUST be excluded from the rsync below, which runs with --delete. Until
# 13 Oct 2026 they were not, and so shipping from a zip deleted them from the
# live tree and `git add -A` pushed that deletion to GitHub: 302 MB of the
# library's PDFs, all 30 of them, plus the campaign, campus and SGACC
# photographs and the library's test fixtures. 309 MB in all, and the library
# would have been down until somebody noticed. Recoverable from git history,
# which is not the same as harmless.
#
# The films' reels are here for a second reason as well as size: 13 MB of .mp4
# that has not changed in weeks, against a zip that has to stay under 30 MB to
# be sent anywhere at all. A large binary that does not change need not travel
# on every release; it needs to survive one.
#
# The videos only, not the folder. Their stills sit beside them, and
# glimpse.jpg is the JPEG fixture half the test suite reads: excluding the
# folder took the suite down with it.
#
# The test that holds this is test/ship-script.test.js. Anything added to the
# repository that is not in the zip belongs in this list on the same day.
KEEP_EXCLUDES=(--exclude '/resources' --exclude '/media/site/campaign' --exclude '/media/site/campus' --exclude '/media/site/sgacc' --exclude '/test/fixtures/library' --exclude '/media/cinekind-2026/reels/*.mp4')
# The same paths as git understands them. KEEP_EXCLUDES stops rsync deleting
# them from the live tree; KEEP_PATHS stops git deleting them from GitHub,
# which is a different hole and the one that actually swallowed the library on
# 16 Oct 2026. See the guard below `git add -A`.
KEEP_PATHS=(resources media/site/campaign media/site/campus media/site/sgacc test/fixtures/library media/cinekind-2026/reels)

# Never commit the removal of protected content.
#
# 16 Oct 2026. The rsync guard above stops --delete emptying the live tree. It
# does nothing when the live tree never had the content: the tree is assembled
# from the zip, the zip does not carry the library, and so `git add -A` staged
# 59 deletions against GitHub and the push carried them. main lost 302 MB of
# PDFs, every reading copy, the campaign, campus and SGACC photographs and the
# reels' videos, and every download on library.html answered 404 until they
# were restored from history.
#
# So the question a release must answer is not "did rsync keep it" but "is
# this commit about to delete something GitHub has and this tree does not".
# Any staged deletion under KEEP_PATHS is unstaged and the file put back from
# origin/main, the only copy that is certainly complete, with a count printed
# rather than done quietly.
#
# Called at BOTH places the index can come to carry those deletions: after
# `git add -A`, and inside on_top_of_github after `reset --soft origin/main`.
# The second call is the one that matters on a tree whose .git did not come
# across: at `git add -A` time that tree has no origin remote yet, so the
# first call is a no-op there, and the deletions only materialise against
# GitHub at the reset. With GitHub unreachable this does nothing, and then the
# push fails too, so nothing can be deleted remotely either way.
keep_protected() {
  git rev-parse -q --verify origin/main >/dev/null 2>&1 || git fetch -q origin main 2>/dev/null || return 0
  local rescued
  rescued="$(git diff --cached --diff-filter=D -z --name-only -- "${KEEP_PATHS[@]}" 2>/dev/null | tr -d -c '\0' | wc -c | tr -d ' ')"
  [ "${rescued:-0}" -gt 0 ] || return 0
  git diff --cached --diff-filter=D -z --name-only -- "${KEEP_PATHS[@]}" 2>/dev/null \
    | xargs -0 -r git checkout origin/main -- 2>/dev/null || true
  echo "  kept $rescued file(s) GitHub has that this tree does not: the zip does not carry them, and a release must not delete them"
}

kb_of() { if [ -e "$1" ]; then du -sk "$1" 2>/dev/null | cut -f1; else echo 0; fi; }
tree_kb() {
  local total
  total=$(kb_of "$1")
  for p in .git node_modules public functions/node_modules functions/api functions/lib functions/assets; do
    total=$(( total - $(kb_of "$1/$p") ))
  done
  echo "$total"
}

if [ -d "$LIVE" ]; then
  step "Making room"
  # Only the newest earlier backup is kept; older ones are this script's own
  # copies of trees that are already on GitHub.
  find "$HOME/Desktop" -maxdepth 1 -type d -name 'PFA_Website_backup_*' | sort -r | tail -n +2 | while IFS= read -r old; do
    echo "  removing an older backup: $(basename "$old")"
    rm -rf "$old"
  done
  for p in public functions/node_modules functions/api functions/lib functions/assets functions/product.html; do
    rm -rf "${LIVE:?}/$p"
  done

  # Enough space for the backup and the new tree, with half a gigabyte to
  # spare, or nothing is touched.
  NEED_KB=$(( $(tree_kb "$LIVE") + $(tree_kb "$NEW") + 512000 ))
  FREE_KB=$(df -Pk "$HOME/Desktop" | awk 'NR==2 {print $4}')
  if [ "${FREE_KB:-0}" -lt "$NEED_KB" ]; then
    fail "Not enough free space on this Mac: about $(( NEED_KB / 1048576 + 1 )) GB is needed, $(( FREE_KB / 1048576 )) GB is free.
  Nothing has been pushed and $LIVE is untouched. Empty the Trash, delete old zips and folders on the Desktop, then run this again."
  fi

  step "Backing up the current tree"
  rsync -a --exclude '.git' --exclude 'node_modules' "${BUILT_EXCLUDES[@]}" "${KEEP_EXCLUDES[@]}" "$LIVE"/ "$BACKUP"/
  echo "  $BACKUP"

  step "Updating the tree, keeping .git and node_modules"
  rsync -a --delete --exclude '.git' --exclude 'node_modules' "${BUILT_EXCLUDES[@]}" "${KEEP_EXCLUDES[@]}" "$NEW"/ "$LIVE"/
else
  step "No tree at $LIVE yet, creating it"
  mkdir -p "$LIVE"
  rsync -a --exclude '.git' --exclude 'node_modules' "${BUILT_EXCLUDES[@]}" "${KEEP_EXCLUDES[@]}" "$NEW"/ "$LIVE"/
fi
cd "$LIVE"

step "Installing dependencies"
npm install --silent

# --------------------------------------------------------------------- ship
step "Committing"
# The version and the headline are read out of the tree being shipped, not
# typed here. A hardcoded message is how every commit from March to August came
# out saying "v1.106" regardless of what was in it, which made the deployed
# commit useless for telling which build was live.
VERSION="$(grep -o 'pfa-build" content="v[0-9.]*"' index.html | head -1 | sed 's/.*content="//; s/"$//')"
SUMMARY="$(awk '/^- /{sub(/^- /,""); gsub(/\*\*/,""); sub(/\. .*$/,""); sub(/\.$/,""); print; exit}' CHANGELOG.md)"
[ -n "$VERSION" ] || VERSION="untagged"
if [ -n "$SUMMARY" ]; then
  MESSAGE="$VERSION: $SUMMARY"
else
  MESSAGE="$VERSION: site update"
fi
# Long enough to be useful in a Vercel deployment list, short enough to read.
MESSAGE="$(printf '%s' "$MESSAGE" | cut -c1-110)"
echo "  message: $MESSAGE"

FRESH=0
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  git init -q
  FRESH=1
  echo "  new repository (the previous .git did not come across); it is placed on top of GitHub's history below"
fi
git add -A
# What was just staged must not delete protected content GitHub still has.
# On a tree whose .git did not come across there is no origin remote yet, so
# this is a no-op here and the call inside on_top_of_github is the guard that
# counts; see keep_protected above.
keep_protected

if git diff --cached --quiet; then
  echo "  nothing changed"
else
  git commit -q -m "$MESSAGE"
  echo "  committed"
fi

step "Pushing"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REMOTE"
  echo "  added origin $REMOTE"
fi
git branch -M main
# Never a force push. On 8 Oct 2026 a ship that found no .git started a fresh
# history and force-pushed it, replacing GitHub's; every later ship from a
# copy with the older history was then refused ("the remote contains work
# that you do not have"). GitHub can also move on its own: the reading-copies
# workflow commits back after a push, and another machine can ship.
#
# So the release is always placed on top of whatever GitHub has: fetch, and
# if GitHub has anything this copy does not, move this copy's branch onto
# GitHub's tip keeping the files exactly as shipped (reset --soft), and
# commit them there. The site is the tree being shipped, as it always was;
# GitHub's history is kept, not overwritten. Tried three times, in case
# something lands on GitHub in between.
on_top_of_github() {
  git fetch -q origin main 2>/dev/null || return 0   # nothing on GitHub yet
  if git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then return 0; fi
  echo "  GitHub has commits this copy does not; placing this release on top of them"
  git reset -q --soft origin/main
  # The index now stands against GitHub's tip, so a file GitHub has and this
  # tree does not shows up as a staged deletion exactly here. On a fresh
  # `git init` this is the first moment the deletions exist at all.
  keep_protected
  if git diff --cached --quiet; then
    echo "  the files are already exactly what GitHub has"
  else
    git commit -q -m "$MESSAGE"
  fi
}
PUSHED=0
for attempt in 1 2 3; do
  on_top_of_github
  if git push -u origin main; then PUSHED=1; break; fi
  echo "  push refused (attempt $attempt of 3); fetching again"
  sleep 3
done
[ "$PUSHED" = "1" ] || fail "GitHub refused the push three times. Nothing was overwritten there.
  The tree at $LIVE is updated and committed; run this again, or ask for help with the message above."

step "Deploying the database rules"
# Name the project explicitly. The firebase CLI otherwise uses whichever
# project it last had selected, which is global to the machine and unrelated to
# this directory - on 27 Aug that sent these rules to an unrelated project and
# overwrote its rules. Taking the id from the service account key guarantees
# the rules land on the same project the API and the sign-in use.
PROJECT="$(node -e 'process.stdout.write(String(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).project_id || ""))')"
[ -n "$PROJECT" ] || fail "Could not read project_id from the service account key."
echo "  project: $PROJECT"
# When the rules have not changed, firebase-tools skips the upload and then
# trips over its own release with "409, Requested entity already exists".
# That is success wearing a red coat: the rules on the project are already
# these rules. Anything else is a real failure and still stops the script.
#
# 8 Oct 2026: a ship stopped here with "Unable to parse JSON: Unexpected
# token '<', <!DOCTYPE ..." after the rules had compiled: one of Google's
# rules API calls answered with an error page instead of JSON. That is a
# hiccup on Google's side or the network's, not a problem with the rules, so
# the deploy is tried a second time after a pause. And by this step the
# release is already on GitHub and Vercel is building it, so if the rules
# file did not change in this release, a failure here cannot leave the
# project behind: it is reported as a warning, not as STOPPED.
RULES_LOG="$(mktemp)"
deploy_rules() {
  npx --yes firebase-tools deploy --only firestore:rules --project "$PROJECT" 2>&1 | tee "$RULES_LOG"
  local status="${PIPESTATUS[0]}"
  [ "$status" = "0" ] && return 0
  grep -q "already up to date" "$RULES_LOG" && grep -q "409" "$RULES_LOG" && { echo "  rules unchanged - already deployed on $PROJECT, nothing to do"; return 0; }
  return 1
}
if deploy_rules; then
  :
else
  echo "  the rules deploy did not finish; trying once more in 15 seconds"
  sleep 15
  if deploy_rules; then
    :
  elif git -C "$LIVE" rev-parse -q --verify HEAD~1 >/dev/null 2>&1 && git -C "$LIVE" diff --quiet HEAD~1 HEAD -- firestore.rules; then
    printf '\n\033[33m  Warning:\033[0m the database rules could not be deployed just now, but firestore.rules\n'
    printf '  did not change in this release, so the rules on %s are already these.\n' "$PROJECT"
    printf '  Nothing to do. To deploy them anyway later:\n'
    printf '    cd %s && npx firebase-tools deploy --only firestore:rules --project %s\n' "$LIVE" "$PROJECT"
  else
    rm -f "$RULES_LOG"
    fail "Deploying the database rules failed twice, and they changed in this release. The site itself is pushed.
  Run this again in a few minutes:  cd $LIVE && npx firebase-tools deploy --only firestore:rules --project $PROJECT"
  fi
fi
rm -f "$RULES_LOG"

step "Capping how many Hosting versions Firebase keeps"
# Firebase keeps every version ever deployed, for ever, by default, and storage
# is the sum of all of them. On 13 Oct 2026 this project was at 9.73 GB of the
# 10 GB that is free, from twenty copies of a 480 MB bundle nobody downloaded.
# Set here, from the service account already in the environment, on every ship,
# so a change made in the console cannot survive the next release. Never stops
# a release: the build has already bounded the bundle.
node scripts/hosting-retention.js || true

step "Deploying the admin panel and the API to Firebase"
# The admin panel is used at pfa-new-website.web.app, which is Firebase
# Hosting and the Cloud Function in functions/, not Vercel. Until 8 Oct 2026
# this script updated GitHub (and so Vercel) and the database rules only, and
# the panel kept running whatever was last deployed to Firebase by hand: that
# morning it was still showing "Mailbox could not be read: Command failed"
# from code the site had already replaced. Now one ship updates both.
#
# `--only hosting` deploys the whole of public/, which is why what goes into
# public/ matters so much: see the note at the top of firebase.json. It is the
# panel and the files the panel loads, and no other page.
#
# The site is already pushed by this point; if Firebase refuses twice, that is
# said plainly with the one command to finish, and nothing else is undone.
FB_LOG="$(mktemp)"
deploy_firebase() {
  node scripts/build-firebase.js \
    && node scripts/firebase-secrets.js \
    && npm --prefix functions install --no-audit --no-fund --silent \
    && npx --yes firebase-tools deploy --only functions,hosting --project "$PROJECT" 2>&1 | tee "$FB_LOG"
  return "${PIPESTATUS[0]}"
}
if deploy_firebase; then
  :
else
  echo "  the Firebase deploy did not finish; trying once more in 15 seconds"
  sleep 15
  if ! deploy_firebase; then
    rm -f "$FB_LOG"
    fail "Deploying the admin panel to Firebase failed twice. The website itself is pushed; only the panel at pfa-new-website.web.app is behind.
  Run this in a few minutes:  cd $LIVE && node scripts/build-firebase.js && node scripts/firebase-secrets.js && npm --prefix functions install --no-audit --no-fund && npx firebase-tools deploy --only functions,hosting --project $PROJECT"
  fi
fi
rm -f "$FB_LOG"

step "Locking the file store (Storage rules)"
# storage.rules refuses every browser read and write on the bucket that keeps
# photographs and documents; only the server, with the admin key, touches it
# (8 Oct 2026). Firebase can only take these rules once Storage is switched on
# in the console (Build > Storage > Get started). Until then there is no
# bucket to protect and the files stay in the database, so "not set up yet"
# is a note, not a stop. This runs last, so it can never hold back the site
# or the panel.
ST_LOG="$(mktemp)"
deploy_storage() {
  npx --yes firebase-tools deploy --only storage --project "$PROJECT" 2>&1 | tee "$ST_LOG"
  return "${PIPESTATUS[0]}"
}
storage_not_on() { grep -Eqi "has not been set up|Get Started|still being set up|not been initiali[sz]ed|Firebase Storage has not" "$ST_LOG"; }
if deploy_storage; then
  :
elif storage_not_on; then
  printf '\n\033[33m  Note:\033[0m Storage is not switched on for %s yet, so photographs stay in the database for now.\n' "$PROJECT"
  printf '  When you switch it on (console.firebase.google.com > Build > Storage > Get started, production mode, Mumbai),\n'
  printf '  run:  cd %s && npx firebase-tools deploy --only storage --project %s\n' "$LIVE" "$PROJECT"
else
  echo "  the Storage rules deploy did not finish; trying once more in 15 seconds"
  sleep 15
  if deploy_storage; then
    :
  elif storage_not_on; then
    printf '\n\033[33m  Note:\033[0m Storage is not switched on for %s yet. Run this after switching it on:\n' "$PROJECT"
    printf '    cd %s && npx firebase-tools deploy --only storage --project %s\n' "$LIVE" "$PROJECT"
  else
    rm -f "$ST_LOG"
    fail "Deploying the Storage rules failed twice. The site and the panel are deployed; only the file store's lock is behind.
  Run this in a few minutes:  cd $LIVE && npx firebase-tools deploy --only storage --project $PROJECT"
  fi
fi
rm -f "$ST_LOG"

printf '\n\033[32mDone.\033[0m Pushed %s to %s\n' "$MESSAGE" "$REMOTE"
printf 'Backup of the previous tree: %s\n' "$BACKUP"
printf '\nCheck the deployment picked it up:\n'
printf '  The commit shown in Vercel should read "%s".\n' "$MESSAGE"
printf '  If no new deployment appears at all, the deploy was refused before it\n'
printf '  started. On a Hobby account the two usual causes are a cron firing more\n'
printf '  than once a day (guarded by test/vercel-crons.test.js) and a repository\n'
printf '  owned by a GitHub organisation, which Hobby cannot deploy from.\n'
printf '\nThen rotate %s in the Firebase console - it has been sitting on your Desktop.\n' "$(basename "$KEY")"
