'use strict';

/* scripts/ship.sh is the only way this site reaches production, so the things
   it gets wrong are invisible until something is already live.
 *
   The ones it did get wrong: a hardcoded commit message, so every push from
   March to August said "v1.106: admin panel, firebase-admin subpath fix..."
   whatever was actually in it; and, on 7 Sep 2026, a service account chosen by
   `ls -t`, which handed it the key for pfa-oldsite off the Desktop and got as
   far as replacing the working tree before the sign-in check stopped it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/* The library's PDFs live in the repository and deliberately never travel in
   the site's zip: they are 302 MB and the zip is one file by request. Every
   check below reads them, so from an unpacked zip they would fail, and
   scripts/ship.sh refuses to ship on any failure at all. That turned "the zip
   does not carry the PDFs", which is intended, into "this build cannot be
   shipped", which is not. Skipped with a word when they are absent, run in
   full in the repository, where they are the thing that matters. */
const HAS_RESOURCES = fs.existsSync(path.join(ROOT, 'resources'));
const whenResources = { skip: HAS_RESOURCES ? false : 'resources/ is not in this tree (an unpacked zip); run in the repository' };

const SHIP = path.join(ROOT, 'scripts', 'ship.sh');
const ship = fs.readFileSync(SHIP, 'utf8');

test('the ship script is valid bash', () => {
  execFileSync('bash', ['-n', SHIP]);
});

test('the commit message is read from the tree, never typed into the script', () => {
  assert.doesNotMatch(ship, /git commit -q -m "v[0-9]+\.[0-9]+/,
    'a version hardcoded here goes stale the moment the next build is cut');
  assert.match(ship, /git commit -q -m "\$MESSAGE"/);
  assert.match(ship, /pfa-build" content="v/, 'the version comes from the build stamp');
  assert.match(ship, /CHANGELOG\.md/, 'and the headline from the changelog');
});

test('the message it would produce names this build', () => {
  const version = /content="(v[0-9.]+)"/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
  const built = execFileSync('bash', ['-c',
    'cd "$1" && ' +
    'VERSION="$(grep -o \'pfa-build" content="v[0-9.]*"\' index.html | head -1 | sed \'s/.*content="//; s/"$//\')" && ' +
    'SUMMARY="$(awk \'/^- /{sub(/^- /,""); gsub(/\\*\\*/,""); sub(/\\. .*$/,""); sub(/\\.$/,""); print; exit}\' CHANGELOG.md)" && ' +
    'printf \'%s\' "$VERSION: $SUMMARY" | cut -c1-110',
    'sh', ROOT], { encoding: 'utf8' });
  assert.ok(built.startsWith(version + ': '), `expected the message to start with ${version}, got: ${built}`);
  assert.ok(built.length > version.length + 12, 'and to carry a real summary, not just a number');
  assert.ok(built.length <= 110, 'and to stay readable in a deployment list');
});

test('the build stamp and the changelog agree on the version', () => {
  const stamp = /content="(v[0-9.]+)"/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
  const head = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n')[0];
  assert.match(head, new RegExp('^## ' + stamp.replace('.', '\\.') + '\\b'),
    `the page says ${stamp} but the changelog opens with: ${head}`);
});

test('nothing is pushed before the tests have run and passed', () => {
  const testsAt = ship.indexOf('Running the tests');
  const pushAt = ship.indexOf('git push');
  assert.ok(testsAt > 0 && pushAt > testsAt, 'the test step must come before any push');
  assert.match(ship, /FAILED.*-gt 0/, 'the suite is green, so any failure stops the ship');
  assert.match(ship, /PASS.*-lt 500/, 'so does a collapse in the number passing');
});

test('the script never prints a secret', () => {
  assert.doesNotMatch(ship, /echo .*FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(ship, /echo .*PFA_RAZORPAY_KEY_SECRET|echo .*SHOPIFY_ADMIN_TOKEN/);
  assert.match(ship, /unset FIREBASE_SERVICE_ACCOUNT_JSON/, 'and clears the credential when it is done');
});

test('the service account is chosen by the project it belongs to, never by timestamp', () => {
  assert.doesNotMatch(ship, /ls -t[^\n]*adminsdk/, 'the newest key on a Desktop is not the right key');
  assert.match(ship, /firebase-project\.js" --find/, 'scripts/firebase-project.js picks the key for the tree\'s project');
  assert.match(ship, /firebase-project\.js" "\$KEY"/, 'and the chosen key is checked against every reference in the tree');
  assert.match(ship, /PFA_SERVICE_ACCOUNT/, 'a key can be named outright instead');
});

test('nothing on disk changes before the project, the key, the sign-in and the tests are all confirmed', () => {
  const order = [
    'Checking the tree names one Firebase project',
    'Finding the Firebase service account',
    'Checking the key belongs to the project the browser signs in to',
    'Granting the admin claim',
    'Checking sign-in will work',
    'Running the tests',
    'Backing up the current tree',
    'rsync -a --delete',
    'git push'
  ];
  const at = order.map((step) => ship.indexOf(step));
  order.forEach((step, i) => assert.ok(at[i] > -1, `${step} is gone from the script`));
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] > at[i - 1], `"${order[i]}" must come after "${order[i - 1]}"`);
  }
  const checks = ship.slice(at[0], at[6]);
  assert.match(checks, /cd "\$NEW"/, 'the checks run in the unpacked tree, not the live one');
  assert.doesNotMatch(checks, /cd "\$LIVE"/, 'the live tree is not entered until they pass');
});

test('the ship never copies or backs up built output, keeps one earlier backup, and checks for space first', () => {
  /* 8 Oct 2026: every ship backed up the whole live tree, .git included,
     every backup stayed on the Desktop, public/ (a second copy of the
     library's PDFs) was copied into the live tree, and the Mac ran out of
     space half way through the update. */
  const swap = ship.slice(ship.indexOf('swap trees'), ship.indexOf('cd "$LIVE"\n'));
  for (const built of ['/public', '/functions/node_modules', '/functions/api', '/functions/lib', '/functions/assets']) {
    assert.ok(swap.includes(`--exclude '${built}'`), `${built} is excluded from the copy and the backup`);
  }
  assert.doesNotMatch(swap, /cp -R "\$LIVE"/, 'the backup is not a full copy with .git and node_modules');
  /* KEEP_EXCLUDES joined BUILT_EXCLUDES on 13 Oct 2026: the repository holds
     content the zip deliberately does not carry (the library's PDFs above
     all), and --delete without it removed 309 MB from the live tree and
     pushed the deletion to GitHub. The test below holds that list; these two
     hold that both arrays reach both rsyncs. */
  assert.match(swap, /rsync -a --exclude '\.git' --exclude 'node_modules' "\$\{BUILT_EXCLUDES\[@\]\}" "\$\{KEEP_EXCLUDES\[@\]\}" "\$LIVE"\/ "\$BACKUP"\//);
  assert.match(swap, /rsync -a --delete --exclude '\.git' --exclude 'node_modules' "\$\{BUILT_EXCLUDES\[@\]\}" "\$\{KEEP_EXCLUDES\[@\]\}" "\$NEW"\/ "\$LIVE"\//);
  assert.match(swap, /PFA_Website_backup_\*' \| sort -r \| tail -n \+2/, 'older backups are cleared, the newest kept');
  const space = swap.indexOf('df -Pk');
  assert.ok(space > -1, 'free space is checked');
  assert.ok(space < swap.indexOf('Backing up the current tree'), 'before anything is copied');
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const built of ['public/', 'functions/api/', 'functions/lib/', 'functions/assets/']) {
    assert.ok(ignore.split('\n').includes(built), `${built} is never committed`);
  }
});

/* ---- the push, run for real against a local "GitHub" ----------------------
   8 Oct 2026: a ship from a copy with no .git started a fresh history and
   force-pushed it over GitHub's. The next ship, from a copy with the older
   history, was refused: "the remote contains work that you do not have".
   The push step now places the release on top of whatever GitHub has and
   never forces. These run the script's own push step, cut out of
   scripts/ship.sh, against real git repositories in a temporary folder. */

const os = require('node:os');

function hasGit() { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } }

function pushStep() {
  const from = ship.indexOf('step "Pushing"');
  const to = ship.indexOf('[ "$PUSHED" = "1" ]');
  assert.ok(from > 0 && to > from, 'the push step is where it was');
  return ship.slice(from, ship.indexOf('\n', ship.indexOf('\n', to) + 1));
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-ship-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@pfa.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@pfa.test', GIT_TERMINAL_PROMPT: '0'
  }) }).trim();
  const remote = path.join(dir, 'github.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  /* GitHub's history: a fresh root and one more, as on 8 Oct */
  const seed = path.join(dir, 'seed');
  git(dir, 'clone', '-q', remote, seed);
  fs.writeFileSync(path.join(seed, 'index.html'), 'v1.400 first');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'v1.400 (fresh root)');
  fs.writeFileSync(path.join(seed, 'index.html'), 'v1.400 second');
  fs.writeFileSync(path.join(seed, 'only-on-github.txt'), 'x');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'v1.400 again');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  return { dir, git, remote };
}

function runPush(live, remote, { fresh = false } = {}) {
  const script = [
    'set -euo pipefail',
    'step() { echo "== $1"; }',
    'fail() { echo "STOPPED: $1" >&2; exit 1; }',
    `REMOTE=${JSON.stringify(remote)}`,
    'MESSAGE="v1.402: test release"',
    `FRESH=${fresh ? 1 : 0}`,
    'sleep() { :; }',
    `KEEP_PATHS=(${keepPaths().join(' ')})`,
    keepGuard(),
    pushStep()
  ].join('\n');
  return execFileSync('bash', ['-c', script], { cwd: live, encoding: 'utf8', env: Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@pfa.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@pfa.test', GIT_TERMINAL_PROMPT: '0'
  }) });
}

test('the push never forces', () => {
  assert.doesNotMatch(pushStep(), /--force|\s-f\b|\+main/, 'a force push replaced GitHub\'s history on 8 Oct 2026');
});

test('a copy whose history GitHub no longer shares still ships, on top of GitHub, with exactly the shipped files', { skip: !hasGit() }, () => {
  const { dir, git, remote } = sandbox();
  const live = path.join(dir, 'PFA_Website');
  fs.mkdirSync(live);
  git(live, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.397');
  git(live, 'add', '-A'); git(live, 'commit', '-q', '-m', 'v1.397 (the older history)');
  git(live, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.402 shipped');
  git(live, 'add', '-A'); git(live, 'commit', '-q', '-m', 'v1.402: test release');

  const out = runPush(live, remote);
  assert.match(out, /placing this release on top of them/);
  const log = git(dir, '--git-dir', remote, 'log', '--format=%s', 'main');
  assert.deepEqual(log.split('\n'), ['v1.402: test release', 'v1.400 again', 'v1.400 (fresh root)'], 'GitHub\'s history kept, the release on top');
  assert.equal(git(dir, '--git-dir', remote, 'show', 'main:index.html'), 'v1.402 shipped', 'the files are the ones shipped');
  assert.throws(() => git(dir, '--git-dir', remote, 'show', 'main:only-on-github.txt'), 'the tree is the shipped tree, not a mix of the two');
});

test('a commit that landed on GitHub after the last ship (the reading-copies bot) is built on, not refused', { skip: !hasGit() }, () => {
  const { dir, git, remote } = sandbox();
  const live = path.join(dir, 'PFA_Website');
  git(dir, 'clone', '-q', remote, live);
  /* the bot commits after this copy last pulled */
  const bot = path.join(dir, 'bot');
  git(dir, 'clone', '-q', remote, bot);
  fs.writeFileSync(path.join(bot, 'read-copy.pdf'), 'pdf');
  git(bot, 'add', '-A'); git(bot, 'commit', '-q', '-m', 'Reading copies (bot)');
  git(bot, 'push', '-q', 'origin', 'HEAD:main');
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.402 shipped');
  fs.writeFileSync(path.join(live, 'read-copy.pdf'), 'pdf');
  git(live, 'add', '-A'); git(live, 'commit', '-q', '-m', 'v1.402: test release');

  runPush(live, remote);
  assert.equal(git(dir, '--git-dir', remote, 'log', '-1', '--format=%s', 'main'), 'v1.402: test release');
  assert.match(git(dir, '--git-dir', remote, 'log', '--format=%s', 'main'), /Reading copies \(bot\)/, 'the bot\'s commit is still in the history');
});

test('a copy with no .git at all ships without a force push', { skip: !hasGit() }, () => {
  const { dir, git, remote } = sandbox();
  const live = path.join(dir, 'PFA_Website');
  fs.mkdirSync(live);
  git(live, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.402 shipped');
  git(live, 'add', '-A'); git(live, 'commit', '-q', '-m', 'v1.402: test release');
  runPush(live, remote, { fresh: true });
  assert.deepEqual(git(dir, '--git-dir', remote, 'log', '--format=%s', 'main').split('\n'),
    ['v1.402: test release', 'v1.400 again', 'v1.400 (fresh root)']);
});

test('an ordinary ship, from a copy that is up to date, is an ordinary push', { skip: !hasGit() }, () => {
  const { dir, git, remote } = sandbox();
  const live = path.join(dir, 'PFA_Website');
  git(dir, 'clone', '-q', remote, live);
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.402 shipped');
  git(live, 'add', '-A'); git(live, 'commit', '-q', '-m', 'v1.402: test release');
  const out = runPush(live, remote);
  assert.doesNotMatch(out, /placing this release on top/);
  assert.equal(git(dir, '--git-dir', remote, 'log', '-1', '--format=%s', 'main'), 'v1.402: test release');
});

test('a placeholder address on a real domain is refused', () => {
  /* On 13 Oct 2026 the example-address guard let
     YOUR-EMAIL@peopleforanimalsindia.org through: it matches neither "your@"
     nor an example domain. The run went as far as asking Firebase to grant the
     claim before stopping, which is late, though nothing had been touched. */
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8');
  const guard = ship.slice(ship.indexOf('A placeholder on a real domain'), ship.indexOf('# ------------------------------------------------------------- one project?'));
  for (const placeholder of ['your-email', 'youremail', 'replace-me', 'changeme']) {
    assert.ok(guard.includes(placeholder), `${placeholder} is not refused`);
  }
  assert.match(guard, /EMAIL%%@\*/, 'matched on the local part, so a real address on any domain is never caught');
  assert.match(guard, /tr '\[:upper:\]' '\[:lower:\]'/, 'and in any case, since the one that got through was shouted');
});

test('shipping from a zip cannot delete what the zip does not carry', () => {
  /* The zip is deliberately one file and the library's PDFs are too large to
     travel in it, so the repository holds content the zip never will. ship.sh
     replaces the live tree with `rsync -a --delete`. Until 13 Oct 2026 nothing
     protected that content: a ship deleted 302 MB of the library's PDFs, all
     30 of them, plus the campaign, campus and SGACC photographs and the
     library's fixtures, and `git add -A` pushed the deletion to GitHub. */
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8');
  const line = ship.split('\n').find((l) => l.startsWith('KEEP_EXCLUDES=('));
  assert.ok(line, 'ship.sh no longer protects the content the zip does not carry');

  for (const dir of ['/resources', '/media/site/campaign', '/media/site/campus', '/media/site/sgacc', '/test/fixtures/library', '/media/cinekind-2026/reels/*.mp4']) {
    assert.ok(line.includes(`--exclude '${dir}'`), `${dir} is in the repository but not in the zip, so --delete would remove it`);
  }

  /* every rsync, not just the one that deletes: the backup should not copy
     302 MB onto the Desktop either */
  const rsyncs = ship.split('\n').filter((l) => l.trim().startsWith('rsync -a'));
  assert.equal(rsyncs.length, 3, 'ship.sh has three rsync invocations; a new one needs the same guard');
  for (const r of rsyncs) {
    assert.ok(r.includes('"${KEEP_EXCLUDES[@]}"'), `an rsync without the guard: ${r.trim().slice(0, 80)}`);
  }
});

test('everything KEEP_EXCLUDES names is really in the repository', whenResources, () => {
  /* A guard naming a path that does not exist is a guard nobody will notice
     has gone stale. */
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8');
  const line = ship.split('\n').find((l) => l.startsWith('KEEP_EXCLUDES=(')) || '';
  const named = [...line.matchAll(/--exclude '\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(named.length >= 5, 'the guard lost entries');
  for (const rel of named) {
    if (rel.includes('*')) {
      /* a pattern, so the question is whether it still matches anything: a
         glob that matches nothing protects nothing and nobody would notice */
      const dir = path.join(ROOT, path.dirname(rel));
      const re = new RegExp('^' + path.basename(rel).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      assert.ok(fs.existsSync(dir) && fs.readdirSync(dir).some((f) => re.test(f)),
        `${rel} is guarded but matches nothing: either it was removed, or this guard is stale`);
      continue;
    }
    assert.ok(fs.existsSync(path.join(ROOT, rel)),
      `${rel} is guarded but not in the tree: either it was removed, or this guard is stale`);
  }
});

/* ---- the deletion the rsync guard did not cover -------------------------
   16 Oct 2026. KEEP_EXCLUDES stopped `rsync --delete` emptying the live tree,
   and the ship still deleted the library from GitHub. The guard was on the
   wrong half of the path: the live tree is assembled from the zip, the zip
   does not carry the library, so the content was never there to be deleted.
   `git add -A` staged 59 deletions against GitHub and the push carried them.
   main lost 302 MB of PDFs, every reading copy, the campaign, campus and
   SGACC photographs and the reels' videos; every download on library.html
   became a 404 until they were restored from history.

   So the question a release must answer is not "did rsync keep it" but "is
   this commit about to delete something GitHub has and this tree does not".
   This runs the script's own guard against real repositories. */

function keepGuard() {
  /* the function itself, cut from the script, so these tests run the real
     guard and not a copy that can drift */
  const from = ship.indexOf('keep_protected() {');
  assert.ok(from > 0, 'keep_protected is where it was');
  const to = ship.indexOf('\n}', from);
  assert.ok(to > from, 'and whole');
  return ship.slice(from, to + 2);
}

function keepPaths() {
  const line = ship.split('\n').find((l) => l.startsWith('KEEP_PATHS=(')) || '';
  return line.replace(/^KEEP_PATHS=\(|\)$/g, '').trim().split(/\s+/).filter(Boolean);
}

test('KEEP_PATHS covers everything KEEP_EXCLUDES protects', () => {
  const excl = ship.split('\n').find((l) => l.startsWith('KEEP_EXCLUDES=(')) || '';
  const named = [...excl.matchAll(/--exclude '\/([^']+)'/g)].map((m) => m[1].replace(/\/\*\.[a-z0-9]+$/i, ''));
  const paths = keepPaths();
  for (const rel of named) {
    assert.ok(paths.includes(rel), `${rel} is protected from rsync but not from git: that is the hole that lost the library`);
  }
});

test('a release never commits the deletion of content only GitHub has', { skip: !hasGit() }, () => {
  const { dir, git, remote } = sandbox();

  /* GitHub carries the library; nothing else does. */
  const seed = path.join(dir, 'seed2');
  git(dir, 'clone', '-q', remote, seed);
  fs.mkdirSync(path.join(seed, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'resources', 'PCA Act, 1960.pdf'), 'pretend pdf');
  fs.writeFileSync(path.join(seed, 'resources', 'another.pdf'), 'pretend pdf 2');
  fs.mkdirSync(path.join(seed, 'test', 'fixtures', 'library'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'test', 'fixtures', 'library', 'fixture.json'), '{}');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'the library');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');

  /* The live tree, as a zip leaves it: everything but the library. */
  const live = path.join(dir, 'PFA_Website');
  git(dir, 'clone', '-q', remote, live);
  fs.rmSync(path.join(live, 'resources'), { recursive: true, force: true });
  fs.rmSync(path.join(live, 'test', 'fixtures', 'library'), { recursive: true, force: true });
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.424');

  const script = [
    'set -euo pipefail',
    'step() { echo "== $1"; }',
    `KEEP_PATHS=(${keepPaths().join(' ')})`,
    keepGuard(),
    'git add -A',
    'keep_protected',
    'git commit -q -m "v1.424: a release from a zip"',
    'git push -q origin HEAD:main'
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { cwd: live, encoding: 'utf8', env: Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@pfa.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@pfa.test', GIT_TERMINAL_PROMPT: '0'
  }) });

  const onGitHub = git(dir, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(onGitHub.includes('resources/PCA Act, 1960.pdf'), 'a PDF with a space in its name survived');
  assert.ok(onGitHub.includes('resources/another.pdf'), 'the library survived the release');
  assert.ok(onGitHub.includes('test/fixtures/library/fixture.json'), 'the fixtures survived');
  assert.match(out, /kept 3 file\(s\)/, 'and the ship said so rather than doing it silently');

  /* the release itself still lands */
  const head = git(dir, '--git-dir', remote, 'show', 'main:index.html');
  assert.equal(head, 'v1.424', 'the files that did change still shipped');
});

test('a tree with no .git and no library ships without deleting the library', { skip: !hasGit() }, () => {
  /* The second door. The guard after `git add -A` needs origin/main, and a
     tree whose .git did not come across has no origin remote at that point:
     the remote is added in the push step, and the deletions against GitHub
     only materialise at `reset --soft origin/main` inside on_top_of_github.
     That is where the guard must also stand, or the 16 Oct deletion happens
     again through the fresh-init path with nothing to say so. */
  const { dir, git, remote } = sandbox();

  const seed = path.join(dir, 'seed3');
  git(dir, 'clone', '-q', remote, seed);
  fs.mkdirSync(path.join(seed, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'resources', 'AWBI ULB.pdf'), 'pretend pdf');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'the library');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');

  /* the live tree: the zip's files, no .git, no library */
  const live = path.join(dir, 'PFA_Website_fresh');
  fs.mkdirSync(live);
  fs.writeFileSync(path.join(live, 'index.html'), 'v1.425');

  const script = [
    'set -euo pipefail',
    'step() { echo "== $1"; }',
    'fail() { echo "STOPPED: $1" >&2; exit 1; }',
    `REMOTE=${JSON.stringify(remote)}`,
    'MESSAGE="v1.425: a fresh tree"',
    'sleep() { :; }',
    `KEEP_PATHS=(${keepPaths().join(' ')})`,
    keepGuard(),
    'git init -q',
    'git add -A',
    'keep_protected',
    'git commit -q -m "$MESSAGE"',
    pushStep()
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { cwd: live, encoding: 'utf8', env: Object.assign({}, process.env, {
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@pfa.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@pfa.test', GIT_TERMINAL_PROMPT: '0'
  }) });

  const onGitHub = git(dir, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(onGitHub.includes('resources/AWBI ULB.pdf'),
    'the library survived a ship from a tree that never had it or a .git');
  assert.equal(git(dir, '--git-dir', remote, 'show', 'main:index.html'), 'v1.425', 'the release itself landed');
  assert.match(out, /kept 1 file\(s\)/, 'and the ship said what it kept');
  assert.ok(fs.existsSync(path.join(live, 'resources', 'AWBI ULB.pdf')),
    'the live tree gains the file back, so the next ship does not relive this');
});
