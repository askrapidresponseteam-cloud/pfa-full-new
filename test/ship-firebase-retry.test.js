'use strict';

/* The panel deploy and Google's per-minute limit (6 Nov 2026: "HTTP Error:
   429, Quota exceeded for quota metric 'Read requests' ... per minute"; the
   retry 15 seconds later was refused the same way). The deploy now waits 90
   seconds on that answer, and tries three times in all. Run for real in
   bash with a stand-in deploy that is refused twice. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ship = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ship.sh'), 'utf8');
const block = ship.slice(ship.indexOf('fb_pause() {'), ship.indexOf('rm -f "$FB_LOG"\n\nstep "Locking the file store'));

function run(refusals, answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbtry-'));
  const script = [
    'set -u',
    `FB_LOG="${dir}/log"; LIVE=x; PROJECT=p; N=0`,
    'fail() { echo "STOPPED: $1"; exit 1; }',
    'sleep() { echo "slept $1"; }',
    `deploy_firebase() { N=$((N + 1)); if [ "$N" -le ${refusals} ]; then echo "${answer}" > "$FB_LOG"; return 1; fi; echo deployed; return 0; }`,
    block,
    'echo "done after $N"'
  ].join('\n');
  try { return execFileSync('bash', ['-c', script], { encoding: 'utf8' }); } catch (e) { return String(e.stdout); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a 429 waits 90 seconds and tries again; three tries in all; anything else waits 15', () => {
  const quota = 'Error: Request to https://cloudresourcemanager.googleapis.com/v1/projects/pfa-new-website had HTTP Error: 429, Quota exceeded';
  const twice = run(2, quota);
  assert.match(twice, /per-minute limit was reached; waiting 90 seconds/);
  assert.equal((twice.match(/slept 90/g) || []).length, 2);
  assert.match(twice, /deployed\ndone after 3/);
  const thrice = run(3, quota);
  assert.match(thrice, /STOPPED: Deploying the admin panel to Firebase failed three times/);
  assert.doesNotMatch(thrice, /done after/);
  const other = run(1, 'Error: something else');
  assert.match(other, /slept 15/);
  assert.match(other, /done after 2/);
  assert.match(run(0, ''), /^deployed\ndone after 1/);
});
