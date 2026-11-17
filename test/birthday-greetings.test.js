'use strict';

/* Birthday greetings by themselves (owner, 17 Nov 2026: "automatically
   trigger the birthday greetings between 6-7 A.M on that special day"), and
   the card's signature clear of the flowers ("maneka sanjay gandhi is
   getting clipped by flower"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const G = require('../lib/birthday-greetings');
const CARD = require('../lib/birthday-card');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* India time on 17 Nov 2026 */
const at = (hhmm) => Date.parse(`2026-11-17T${hhmm}:00+05:30`);
const person = (id, name, dob, email) => ({ id, name, dob, email, mobile: '9876543210', state: 'Delhi', district: 'New Delhi', categories: ['donor'] });
const PEOPLE = [
  person('P1', 'Darshan Singh Rawat', '1963-11-17', 'darshan@example.com'),
  person('P2', 'Asha Rao', '1990-11-17', ''),
  person('P3', 'Parmeet Kaur Bansal', '1981-12-10', 'parmeet@example.com')
];

const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_BIRTHDAY_GREETINGS', 'PFA_PUBLIC_SITE_URL'];
const saved = {};
const realFetch = global.fetch;
let db;
let sent;

test.beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
test.afterEach(() => {
  global.fetch = realFetch;
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const readPeople = async () => PEOPLE;

test('only between 6:00 and 6:59 in the morning, India time, and never when switched off', async () => {
  for (const t of ['05:59', '07:00', '12:00', '23:30']) {
    assert.deepEqual(await G.run({ db, nowMs: at(t), readPeople }), { state: 'not-due' }, t);
  }
  assert.equal(sent.length, 0);
  process.env.PFA_BIRTHDAY_GREETINGS = 'off';
  assert.deepEqual(await G.run({ db, nowMs: at('06:05'), readPeople }), { state: 'not-due' });
  assert.equal(sent.length, 0);
});

test('at 6, today\'s birthdays are emailed their card once; the runs after find the day done', async () => {
  const first = await G.run({ db, nowMs: at('06:02'), readPeople });
  assert.equal(first.state, 'ran');
  assert.equal(first.count, 2, 'only today\'s birthdays');
  assert.equal(first.sent, 1);
  assert.equal(first.noEmail, 1, 'whoever gave no email is counted, for the panel');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual([].concat(m.to), ['darshan@example.com']);
  assert.equal(m.subject, 'Happy Birthday, Darshan');
  assert.match(m.html, /<img src="cid:pfa-birthday-card"/);
  assert.match(m.html, /Warm regards,<\/div><div style="color:#111111">Maneka Sanjay Gandhi<\/div>/);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].content_id, 'pfa-birthday-card');
  assert.equal(m.attachments[0].content_type, 'image/jpeg');
  assert.equal(m.attachments[0].filename, 'PFA-Birthday-Darshan-Singh-Rawat.jpg');
  const jpeg = require('jpeg-js').decode(Buffer.from(m.attachments[0].content, 'base64'));
  assert.deepEqual([jpeg.width, jpeg.height], [1122, 1402], 'the card at its own size');
  assert.doesNotMatch(m.html + m.text + m.subject, /[–—]/);

  const again = await G.run({ db, nowMs: at('06:12'), readPeople });
  assert.equal(again.state, 'done');
  /* even with the day's marker gone, the queue's key refuses a second card */
  await db.collection('counters').doc('birthdayGreetings').delete();
  const third = await G.run({ db, nowMs: at('06:40'), readPeople });
  assert.equal(third.state, 'ran');
  assert.equal(sent.length, 1, 'one card each, however many runs');
  assert.deepEqual(await G.statusOf(db, PEOPLE[0], '2026-11-17').then((s) => s.state), 'sent');
  assert.deepEqual(await G.statusOf(db, PEOPLE[1], '2026-11-17'), { state: 'no-email' });
});

test('the key is the day and the person, not the directory\'s row number', () => {
  const a = G.keyOf({ id: 'P1', name: 'Darshan  Singh Rawat', email: 'Darshan@Example.com' }, '2026-11-17');
  const b = G.keyOf({ id: 'P9', name: 'darshan singh rawat', email: 'darshan@example.com ' }, '2026-11-17');
  assert.equal(a, b);
  assert.notEqual(a, G.keyOf({ name: 'Darshan Singh Rawat', email: 'darshan@example.com' }, '2027-11-17'), 'next year\'s is a new card');
});

function call(handler, { method = 'GET', body } = {}, deps) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api/admin/birthdays', query: {}, body, headers: { host: 'pfa.test' } };
    Promise.resolve(handler(request, response, deps)).catch(reject);
  });
}

test('the panel: each of today\'s rows says where its card stands, and Email the card sends a missed one, once', async () => {
  const route = require('../lib/routes/admin/birthdays');
  const deps = { requireAdmin: async () => ({ email: 'karthik@pfa.test' }), readPeople, now: () => at('09:30'), getDb: () => db };
  const got = await call(route, {}, deps);
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.json.greetings, { hour: 6, on: true, past: true });
  const darshan = got.json.people.find((p) => p.name === 'Darshan Singh Rawat');
  assert.deepEqual(darshan.greeting, { state: 'none' }, 'the morning was missed');
  assert.equal(got.json.people.find((p) => p.name === 'Asha Rao').greeting.state, 'no-email');
  assert.ok(!('key' in got.json.upcoming[0]), 'only today\'s can be emailed');

  const done = await call(route, { method: 'POST', body: { action: 'send', key: darshan.key } }, deps);
  assert.equal(done.statusCode, 200, done.raw);
  assert.equal(done.json.state, 'sent');
  assert.equal(done.json.greeting.state, 'sent');
  assert.equal(sent.length, 1);
  const twice = await call(route, { method: 'POST', body: { action: 'send', key: darshan.key } }, deps);
  assert.equal(twice.statusCode, 200);
  assert.equal(sent.length, 1, 'never a second card');
  const later = await call(route, { method: 'POST', body: { action: 'send', key: 'x' } }, deps);
  assert.equal(later.statusCode, 404);
  assert.equal(later.json.code, 'NOT_TODAY');
});

test('the worker runs the morning step; the suite switches it off; the server bundle carries the card', () => {
  const worker = read('lib/routes/caregiver/email-worker.js');
  assert.match(worker, /require\('\.\.\/\.\.\/birthday-greetings'\)\.run\(\{ db: getDb\(\) \}\)/);
  assert.ok(worker.indexOf('birthday-greetings') < worker.indexOf('if (!mail.isConfigured())'), 'queued even while mail is not set up');
  assert.match(read('test/_isolate-env.js'), /PFA_BIRTHDAY_GREETINGS = 'off'/);
  assert.match(read('functions/index.js'), /schedule: 'every 10 minutes', timeZone: 'Asia\/Kolkata'/, 'the ten-minute run that reaches the 6 o\'clock hour');
  const fb = read('scripts/build-firebase.js');
  for (const f of Object.values(CARD.FILES)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    assert.ok(fs.existsSync(f), rel);
    assert.ok(fb.includes(`'${rel}'`), `${rel} in the Firebase function`);
  }
});

test('the card on the server is the panel\'s card: same script, a Hindi name shaped, an unknown script left off', async () => {
  const src = read('lib/birthday-card.js');
  assert.match(src, /vm\.runInNewContext\(fs\.readFileSync\(FILES\.script/);
  const a = await CARD.card('Darshan Singh Rawat');
  assert.deepEqual([a.named, a.lines], [true, ['Darshan Singh Rawat']]);
  const hi = await CARD.card('अनन्या शर्मा');
  assert.equal(hi.named, true);
  const ta = await CARD.card('கார்த்திக்');
  assert.equal(ta.named, false, 'no empty boxes: the card without a name');
  /* ink on the paper, none on the petals below the signature */
  const img = require('jpeg-js').decode(a.jpeg);
  const dark = (x, y) => { const o = (y * img.width + x) * 4; return img.data[o] + img.data[o + 1] + img.data[o + 2] < 200 && Math.abs(img.data[o] - img.data[o + 2]) < 25; };
  let ink = 0;
  for (let y = 600; y < 930; y += 1) for (let x = 330; x < 790; x += 1) if (dark(x, y)) ink += 1;
  assert.ok(ink > 3000, 'the words are drawn');
});

test('the panel shows the morning email\'s state and an Email the card button', () => {
  const js = read('assets/admin-birthdays.js');
  assert.match(js, /data-bd="email">Email the card<\/button>/);
  assert.match(js, /A\.api\('\/api\/admin\/birthdays', \{ method: 'POST', body: \{ action: 'send', key: p\.key \} \}\)/);
  assert.match(js, /Each is emailed their card by itself between 6 and 7 am on the day\./);
  assert.match(js, /No email address: send the card on WhatsApp\./);
  assert.doesNotMatch(js, /[–—]/);
  /* drawn in a page, for one of today's in each state */
  const dom = new JSDOM('<div id="paneNote"></div><div data-pane="birthdays"></div><div id="bdayNote" hidden><p id="bdayNoteText"></p></div><div id="pipBirthdays"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const data = { today: '2026-11-17', withDate: 3, ahead: 30, greetings: { hour: 6, on: true, past: true }, upcoming: [],
    people: [
      { id: 'P1', key: 'k1', name: 'Darshan Singh Rawat', email: 'd@example.com', day: '2026-11-17', inDays: 0, turns: 63, categories: ['Donor'], greeting: { state: 'sent', at: '2026-11-17T00:34:00Z' } },
      { id: 'P2', key: 'k2', name: 'Asha Rao', email: '', day: '2026-11-17', inDays: 0, turns: 36, categories: ['Donor'], greeting: { state: 'no-email' } },
      { id: 'P3', key: 'k3', name: 'Ravi Kumar', email: 'r@example.com', day: '2026-11-17', inDays: 0, turns: 40, categories: ['Member'], greeting: { state: 'none' } }] };
  w.PFAAdmin = { $: (s) => w.document.querySelector(s), esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), say() {}, api: () => Promise.resolve(data) };
  w.eval(js);
  w.PFABirthdays.pane();
  return new Promise((r) => setTimeout(r, 20)).then(() => {
    const rows = [...w.document.querySelectorAll('.bd-row')];
    const line = (i) => rows[i].querySelector('.bd-sent').textContent;
    assert.equal(line(0), 'Card emailed at 6:04 am.');
    assert.equal(line(1), 'No email address: send the card on WhatsApp.');
    assert.equal(line(2), 'Not emailed this morning.');
    assert.equal(rows[0].querySelector('[data-bd="email"]'), null);
    assert.equal(rows[1].querySelector('[data-bd="email"]'), null);
    assert.ok(rows[2].querySelector('[data-bd="email"]'));
  });
});
