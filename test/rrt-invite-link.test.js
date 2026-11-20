'use strict';

/* Owner, 19 Nov 2026, on the internship's RRT task: "where is the unique
   link. everything seems the same". Each intern's link is on their own
   dashboard, rapid-response.in/r/<code>, an invite page on the RRT that asks
   for the number the person will join with; a join is that number
   registering on the RRT app. These hold the wording to that, the panel's
   server to the RRT's key, and the dashboard to knowing the counts flow. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the link is the RRT invite page, and the words say how a join is counted', () => {
  assert.equal(require('../lib/internship').referralLink('PFAAB2CD'), 'https://rapid-response.in/r/PFAAB2CD');
  const dash = read('intern.html');
  assert.match(dash, /give the mobile number they will join with/);
  assert.match(dash, /<span>gave their number<\/span>/);
  assert.doesNotMatch(dash, /type your code|opened the app<|App Store does not pass a code/, 'no code to type: the RRT app has no box for one');
  const pub = read('internship.html');
  assert.match(pub, /Your own invite link, on your intern dashboard once your internship starts/);
  assert.doesNotMatch(pub, /Your own link to rapid-response\.in, and your own code/);
});

test('the deploy hands the RRT key to the panel, never printing it', () => {
  assert.match(read('scripts/ship.sh'), /node scripts\/build-firebase\.js \\\n\s+&& node scripts\/rrt-referral-key\.js \\\n\s+&& node scripts\/firebase-secrets\.js/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrtkey-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'calls');
  fs.writeFileSync(path.join(bin, 'firebase'), `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "functions:secrets:access" ]; then echo old-value-old-value; exit 0; fi\ncat > "${log}.stdin"\nexit 0\n`, { mode: 0o755 });
  const env = Object.assign({}, process.env, { PATH: `${bin}:${process.env.PATH}` });
  /* no key yet */
  let r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/rrt-referral-key.js')], { env: Object.assign({}, env, { PFA_RRT_KEY_FILE: path.join(dir, 'none') }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no key at/);
  /* a key: set, from stdin, and not shown */
  fs.writeFileSync(path.join(dir, 'key'), 'a'.repeat(64) + '\n');
  r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/rrt-referral-key.js')], { env: Object.assign({}, env, { PFA_RRT_KEY_FILE: path.join(dir, 'key') }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /now set on the panel/);
  assert.ok(!r.stdout.includes('a'.repeat(20)), 'the key is never printed');
  assert.match(fs.readFileSync(log, 'utf8'), /functions:secrets:set PFA_RRT_REFERRAL_SECRET --project pfa-new-website --data-file - --force/);
  assert.equal(fs.readFileSync(log + '.stdin', 'utf8'), 'a'.repeat(64));
});

test('the dashboard knows the counts flow when the panel has read them lately, on a server without the key', () => {
  const src = read('lib/routes/intern/portal.js');
  assert.match(src, /connected: await rrtConnected\(db, nowMs\)/);
  assert.match(src, /st\.state === 'ok' && nowMs - \(Date\.parse\(st\.fetchedAt\) \|\| 0\) < 2 \* 86400000/);
});
