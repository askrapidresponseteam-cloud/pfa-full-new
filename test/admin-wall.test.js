'use strict';

/* The Wall in the admin panel (owner, 4 Nov 2026: "admin panel does not have
   section to review wall submissions!"): every film sent from wall.html,
   waiting first, put on or taken off the wall, and the server refuses a
   film the wall cannot play. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const H = require('./_review-recheck-harness');

test('a section of its own: on the rail with the count waiting, its own module, its own script', () => {
  const admin = read('admin.html');
  assert.match(admin, /<button class="tab" type="button" data-tab="wall">The Wall<span class="pip" id="pipWall" hidden>0<\/span><\/button>/);
  assert.match(admin, /wall: +\{ title: 'The Wall', module: 'wall', needs: 'submissions' \}/);
  assert.match(admin, /if \(tab === 'wall'\) return window\.PFAWall && window\.PFAWall\.pane\(\);/);
  assert.match(admin, /<script src="assets\/admin-wall\.js"><\/script>/);
  assert.ok(require('../lib/admin-modules').MODULES.some((m) => m.key === 'wall'));
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-wall\.js'/);
  const js = read('assets/admin-wall.js');
  assert.match(js, /kind=PFA-S/);
  assert.match(js, /action: 'wall', published:/);
  assert.match(js, /Waiting/);
  assert.match(js, /posts cannot play on the wall/);
});

test('the list says which films are on the wall', async () => {
  const W = H.fresh({ latency: 0 });
  try {
    await W.db.collection('submissions').doc('PFA-S-2026-00001').set({ reference: 'PFA-S-2026-00001', kind: 'PFA-S', status: 'new', receivedAtMs: Date.parse('2026-11-03T05:00:00Z'), createdAt: '2026-11-03T05:00:00Z', fields: { url: 'https://youtu.be/abcdefghijk', wall: 'Short form, under a minute', name: 'Asha' }, wall: { published: true } });
    await W.db.collection('submissions').doc('PFA-S-2026-00002').set({ reference: 'PFA-S-2026-00002', kind: 'PFA-S', status: 'new', receivedAtMs: Date.parse('2026-11-03T06:00:00Z'), createdAt: '2026-11-03T06:00:00Z', fields: { url: 'https://youtu.be/bbbbbbbbbbb', wall: 'Short form, under a minute', name: 'Ravi' } });
    const res = await H.call(require('../lib/routes/admin/records'), { method: 'GET', query: { type: 'submissions', kind: 'PFA-S', limit: '50' }, token: 'tok-a' });
    const rows = JSON.parse(res.raw).rows;
    assert.deepEqual(rows.map((r) => [r.reference, r.onWall]).sort(), [['PFA-S-2026-00001', true], ['PFA-S-2026-00002', false]]);
  } finally { W.restore(); }
});

test('a film the wall cannot play is never put on it; one it can play is, and can be taken off', async () => {
  const W = H.fresh({ latency: 0 });
  try {
    const CASE = require('../lib/routes/admin/case');
    const WALL = require('../lib/routes/wall');
    await W.db.collection('submissions').doc('PFA-S-2026-00003').set({ reference: 'PFA-S-2026-00003', kind: 'PFA-S', status: 'new', fields: { url: 'https://www.instagram.com/reel/Cabc123/', wall: 'Short form, under a minute', name: 'Meera' } });
    await W.db.collection('submissions').doc('PFA-S-2026-00004').set({ reference: 'PFA-S-2026-00004', kind: 'PFA-S', status: 'new', fields: { url: 'https://vimeo.com/76979871', wall: 'Long form, over three minutes', name: 'Kiran' } });
    const no = await H.call(CASE, { method: 'POST', body: { reference: 'PFA-S-2026-00003', action: 'wall', published: true }, token: 'tok-a' });
    assert.equal(no.statusCode, 422);
    assert.match(no.raw, /CANNOT_PLAY/);
    assert.ok(!((await W.db.collection('submissions').doc('PFA-S-2026-00003').get()).data().wall));
    /* taking one off is always allowed */
    assert.equal((await H.call(CASE, { method: 'POST', body: { reference: 'PFA-S-2026-00003', action: 'wall', published: false }, token: 'tok-a' })).statusCode, 200);
    const yes = await H.call(CASE, { method: 'POST', body: { reference: 'PFA-S-2026-00004', action: 'wall', published: true }, token: 'tok-a' });
    assert.equal(yes.statusCode, 200, yes.raw);
    const films = JSON.parse((await H.call(WALL, { method: 'GET' })).raw).films;
    assert.deepEqual(films.map((f) => [f.ref, f.wall, f.vimeo]), [['PFA-S-2026-00004', 'long', '76979871']]);
  } finally { W.restore(); }
});

/* owner, 4 Nov 2026: "admin should be able to reply to wall submissions from the same space" */
test('a reply is written and sent from the film\'s own card, through the submission\'s reply, once per press', () => {
  const js = read('assets/admin-wall.js');
  assert.match(js, /data-wl-reply/);
  assert.match(js, /action: 'reply', text: text, requestId: W\.req\[ref\]/);
  /* its ready replies come from the one list every reply box uses (5 Nov 2026) */
  assert.match(read('assets/admin-replies.js'), /Ask for a YouTube or Vimeo link/);
  assert.match(js, /R\.options\(r\.reference\)/);
  assert.match(js, /No email was given/);
  /* the cards keep their own height, so an open reply leaves no gaps beside it */
  assert.match(js, /\.wl-grid\{[^}]*align-items:start/);
  assert.doesNotMatch(js, /[–—]/);
});
