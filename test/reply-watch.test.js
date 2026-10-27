'use strict';

/* Owner, 27 Oct 2026:
   "1. Shorter wait for normal replies. The info@ check could run every 2
       minutes instead of every 10.
    2. An alert if replies get stuck. If the info@ check fails or hasn't run
       for 30 minutes, you get an email and the panel shows a red notice.
       Replies can never silently pile up." */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const WATCH = require('../lib/reply-watch');
const INBOUND = require('../lib/inbound-mail');

const ROOT = path.join(__dirname, '..');
const MIN = 60000;
const T0 = Date.parse('2026-10-27T08:00:00.000Z');
let db;

test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); });
test.afterEach(() => { firebase._setDbForTests(null); delete process.env.PFA_ALERT_EMAIL; });

const reading = (data) => db.collection('counters').doc('inboundMail').set(data);
const watching = () => db.dump()['counters/replyWatch'] || {};

function recorder() {
  const sent = [];
  return { sent, send: async (m) => { sent.push(m); return { sent: true, queued: true }; } };
}

test('health: working, one blip, failing, stopped, never run, and off', () => {
  const at = (m) => new Date(T0 + m * MIN).toISOString();
  assert.equal(WATCH.health({ lastRunAt: at(0) }, {}, T0 + 3 * MIN, true).state, 'ok');
  assert.equal(WATCH.health({ lastRunAt: at(0), lastError: 'timeout', failStreak: 1 }, {}, T0 + 1 * MIN, true).state, 'ok', 'one failed reading is a blip, not an alert');
  const failing = WATCH.health({ lastRunAt: at(4), lastError: 'Invalid credentials', failStreak: 3, failingSince: at(0) }, {}, T0 + 5 * MIN, true);
  assert.equal(failing.state, 'failing');
  assert.equal(failing.since, at(0));
  assert.match(WATCH.sentence(failing), /not being picked up: the mailbox could not be read \(Invalid credentials\)/);
  assert.equal(WATCH.health({ lastRunAt: at(0) }, {}, T0 + 29 * MIN, true).state, 'ok');
  const stale = WATCH.health({ lastRunAt: at(0) }, {}, T0 + 31 * MIN, true);
  assert.equal(stale.state, 'stale');
  assert.match(WATCH.sentence(stale), /has not been checked for 31 minutes/);
  assert.equal(WATCH.health({}, { watchingSince: at(0) }, T0 + 10 * MIN, true).state, 'ok', 'a fresh deploy is not an alert before its first run');
  assert.equal(WATCH.health({}, { watchingSince: at(0) }, T0 + 40 * MIN, true).state, 'stale', 'but a reading that never starts is');
  assert.equal(WATCH.health({ lastError: 'x', failStreak: 9 }, {}, T0, false).state, 'off', 'no mailbox read here: nothing to watch');
  assert.equal(WATCH.sentence({ state: 'ok' }), '');
});

test('an email when replies get stuck, not again for six hours, a reminder after, and one when they work again', async () => {
  const r = recorder();
  let now = T0;
  const look = () => WATCH.watch(db, { now: () => now, send: r.send, recipients: ['karthik@example.com', 'ozair@example.com'], configured: true });
  await reading({ lastRunAt: new Date(T0).toISOString() });
  assert.equal((await look()).sent, '');
  assert.equal(r.sent.length, 0);

  now = T0 + 31 * MIN;
  const first = await look();
  assert.equal(first.health.state, 'stale');
  assert.equal(first.sent, 'alert');
  assert.deepEqual(r.sent.map((m) => [m.template, m.to, m.payload.kind]), [['replies_stuck', 'karthik@example.com', 'stale'], ['replies_stuck', 'ozair@example.com', 'stale']]);

  now = T0 + 60 * MIN;
  await look();
  assert.equal(r.sent.length, 2, 'not every ten minutes');

  /* it changes from not running to failing: that is news */
  await reading({ lastRunAt: new Date(now).toISOString(), lastError: 'Invalid credentials', failStreak: 3, failingSince: new Date(now - 6 * MIN).toISOString() });
  await look();
  assert.equal(r.sent.length, 4);
  assert.equal(r.sent[3].payload.kind, 'failing');
  assert.equal(r.sent[3].payload.error, 'Invalid credentials');

  now += 6 * 60 * MIN;
  await reading({ lastRunAt: new Date(now).toISOString(), lastError: 'Invalid credentials', failStreak: 200, failingSince: new Date(T0).toISOString() });
  await look();
  assert.equal(r.sent.length, 6, 'reminded after six hours');

  now += 2 * MIN;
  await reading({ lastRunAt: new Date(now).toISOString(), lastError: '', failStreak: 0 });
  const back = await look();
  assert.equal(back.sent, 'recovered');
  assert.deepEqual(r.sent.slice(6).map((m) => [m.template, m.to]), [['replies_working', 'karthik@example.com'], ['replies_working', 'ozair@example.com']]);
  assert.equal(watching().alertState, '');
  now += 10 * MIN;
  await look();
  assert.equal(r.sent.length, 8, 'and quiet once it works');
});

test('who is emailed: PFA_ALERT_EMAIL when set', async () => {
  process.env.PFA_ALERT_EMAIL = 'Karthik@Example.com, ops@example.com, not an address';
  assert.deepEqual(await WATCH.recipients(), ['karthik@example.com', 'ops@example.com']);
});

test('the reading counts its failures in a row, clears them when it works, and only one reading runs at a time', async () => {
  const fail = async () => { throw new Error('Invalid credentials (Failure)'); };
  for (let i = 1; i <= 3; i += 1) {
    const run = await INBOUND.check(db, { read: fail });
    assert.equal(run.failStreak, i);
  }
  let s = db.dump()['counters/inboundMail'];
  assert.equal(s.failStreak, 3);
  assert.ok(s.failingSince);
  assert.equal(s.runningUntil, '', 'the lease is given back');
  assert.equal(WATCH.health(s, {}, Date.now(), true).state, 'failing');

  const empty = async () => ({ messages: [], uids: [], failed: [], lastUid: 0, uidValidity: '1', host: 'imap.test' });
  await INBOUND.check(db, { read: empty });
  s = db.dump()['counters/inboundMail'];
  assert.equal(s.failStreak, 0);
  assert.equal(s.failingSince, '');
  assert.ok(s.lastOkAt);

  /* a reading that is still running holds the mailbox */
  let release;
  const slow = () => new Promise((resolve) => { release = () => resolve({ messages: [], uids: [], failed: [], lastUid: 0, uidValidity: '1', host: 'imap.test' }); });
  const first = INBOUND.check(db, { read: slow });
  await new Promise((r) => setImmediate(r));
  const second = await INBOUND.check(db, { read: empty });
  assert.equal(second.busy, true, 'a second reading waits its turn');
  release();
  assert.ok(!(await first).busy);
  const third = await INBOUND.check(db, { read: empty });
  assert.ok(!third.busy, 'and the next one runs');
});

test('the status the panel reads carries the red notice', async () => {
  const route = require('../lib/routes/inbound-mail')._private.createHandler({
    getDb: () => db,
    requireAdmin: async () => ({ uid: 'u', email: 'a@pfa.test', role: 'super' })
  });
  const call = (method) => new Promise((resolve) => {
    const out = { statusCode: 200 };
    route({ method, url: '/api/inbound-mail', query: {}, body: {}, headers: {} }, {
      setHeader() {}, set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      end(raw) { out.json = JSON.parse(raw); resolve(out); }
    });
  });
  process.env.PFA_IMAP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_IMAP_PASS = 'x';
  try {
    await reading({ lastRunAt: new Date(Date.now() - 2 * MIN).toISOString(), lastError: 'Invalid credentials', failStreak: 4, failingSince: new Date(Date.now() - 8 * MIN).toISOString() });
    const r = await call('GET');
    assert.equal(r.json.health.state, 'failing');
    assert.match(r.json.alert, /^Replies to PFA's emails are not being picked up/);
    await reading({ lastRunAt: new Date().toISOString(), lastError: '', failStreak: 0 });
    const ok = await call('GET');
    assert.equal(ok.json.health.state, 'ok');
    assert.equal(ok.json.alert, '');
  } finally {
    delete process.env.PFA_IMAP_USER;
    delete process.env.PFA_IMAP_PASS;
  }
});

test('every two minutes for replies, the watch every ten, the same two scheduled jobs as before', () => {
  const fn = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  assert.match(fn, /exports\.inboundMailCheck = onSchedule\(\s*\{ region: REGION, schedule: 'every 2 minutes'[^}]*timeoutSeconds: 110/);
  const ten = fn.slice(fn.indexOf('exports.caregiverEmailWorker'), fn.indexOf('exports.inboundMailCheck'));
  assert.match(ten, /schedule: 'every 10 minutes'/);
  assert.match(ten, /require\('\.\/lib\/reply-watch\.js'\)/, 'a stopped reading is noticed from the other job');
  assert.equal((fn.match(/onSchedule\(/g) || []).length, 2, 'no third job: nothing added to the bill');
  const route = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'inbound-mail.js'), 'utf8');
  assert.match(route, /summary\.watch = await \(deps\.watch \|\| WATCH\.watch\)\(db\);/, 'and after every reading');
});

test('the panel shows the red notice on every page and looks again every three minutes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const main = html.slice(html.indexOf('<main class="main">'), html.indexOf('data-pane="overview"'));
  assert.match(main, /<div class="ralert" id="replyAlert" role="alert" hidden><p id="replyAlertText"><\/p><button class="ghost" type="button" id="replyAlertCheck">Check now<\/button><\/div>/);
  assert.match(html, /\.ralert\{[^}]*border:1px solid #b3261e;background:#fdecea/);
  assert.ok(html.includes("show('overview');\n    replyWatch();"), 'looked for as soon as the panel opens');
  assert.match(html, /setInterval\(look, 180000\)/);
  assert.match(html, /A Reply to any copy comes to <b>' \+ esc\(r\.mailbox\) \+ '<\/b>\. The site reads it every two minutes/, 'the Replies box says how it works now');
  assert.doesNotMatch(html, /A Reply from the inbox goes to the person and a copy comes back/);
});
