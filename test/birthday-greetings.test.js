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

/* owner, 21 Nov 2026: "automatically trigger the happy birthday card between 8-9 A.M on the birthday" */
test('only between 8:00 and 8:59 in the morning, India time, and never when switched off', async () => {
  for (const t of ['06:02', '07:59', '09:00', '12:00', '23:30']) {
    assert.deepEqual(await G.run({ db, nowMs: at(t), readPeople }), { state: 'not-due' }, t);
  }
  assert.equal(sent.length, 0);
  process.env.PFA_BIRTHDAY_GREETINGS = 'off';
  assert.deepEqual(await G.run({ db, nowMs: at('08:05'), readPeople }), { state: 'not-due' });
  assert.equal(sent.length, 0);
});

test('at 8, today\'s birthdays are emailed their card once; the runs after find the day done', async () => {
  const first = await G.run({ db, nowMs: at('08:02'), readPeople });
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

  const again = await G.run({ db, nowMs: at('08:12'), readPeople });
  assert.equal(again.state, 'done');
  /* even with the day's marker gone, the queue's key refuses a second card */
  await db.collection('counters').doc('birthdayGreetings').delete();
  const third = await G.run({ db, nowMs: at('08:40'), readPeople });
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
  assert.deepEqual(got.json.greetings, { hour: 8, on: true, past: true });
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
  assert.match(js, /Each is emailed their card by itself ' \+ window_\(\) \+ ' on the day\./, 'the hour the server sends at');
  assert.equal(require('../lib/birthday-greetings').HOUR, 8, 'between 8 and 9');
  assert.match(js, /No email address: send the card on WhatsApp\./);
  assert.doesNotMatch(js, /[–—]/);
  /* drawn in a page, for one of today's in each state */
  const dom = new JSDOM('<div id="paneNote"></div><div data-pane="birthdays"></div><div id="bdayNote" hidden><p id="bdayNoteText"></p></div><div id="pipBirthdays"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const data = { today: '2026-11-17', withDate: 3, ahead: 30, greetings: { hour: 8, on: true, past: true }, upcoming: [],
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

/* owner, 21 Nov 2026: "also maintain the list of to who it has been sent. and have standard filters" */
test('the cards sent: every one kept, newest first, filtered by period, status, how and words; the CSV logged', async () => {
  /* the morning sends Darshan's card by itself, and the panel sends one by hand */
  await G.run({ db, nowMs: at('08:02'), readPeople });
  const route = require('../lib/routes/admin/birthdays');
  const earlier = (id, o) => db.collection('caregiverEmails').doc(id).set(Object.assign({ template: 'birthday_greeting' }, o));
  await earlier('old1', { to: 'ravi@example.com', payload: { name: 'Ravi Kumar', day: '2026-10-21', turns: 40, by: 'karthik@pfa.test' }, status: 'sent', sentAt: '2026-10-21T09:12:00.000Z' });
  await earlier('old2', { to: 'gone@example.com', payload: { name: 'Old Address', day: '2026-11-02', turns: 52, by: 'schedule' }, status: 'failed', updatedAt: '2026-11-02T02:40:00.000Z' });
  await db.collection('caregiverEmails').doc('other').set({ template: 'membership_welcome', to: 'x@example.com', payload: { name: 'Not a birthday' }, status: 'sent' });
  const deps = { requireAdmin: async () => ({ email: 'karthik@pfa.test', uid: 'u1' }), readPeople, now: () => at('10:00'), getDb: () => db };
  const ask = (query) => new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {} };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      end(raw) { out.raw = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(route({ method: 'GET', url: '/api/admin/birthdays', query: Object.assign({ sent: '1' }, query), headers: { host: 'pfa.test' } }, response, deps)).catch(reject);
  });
  const all = await ask({});
  assert.equal(all.statusCode, 200);
  assert.deepEqual(all.json.rows.map((r) => [r.day, r.name, r.state, r.how]), [
    ['2026-11-17', 'Darshan Singh Rawat', 'sent', 'auto'],
    ['2026-11-02', 'Old Address', 'failed', 'auto'],
    ['2026-10-21', 'Ravi Kumar', 'sent', 'panel']
  ], 'every birthday card, newest first, and nothing else');
  assert.equal(all.json.rows[0].email, 'darshan@example.com');
  assert.equal(all.json.rows[0].turns, 63);
  assert.equal(all.json.rows[2].by, 'karthik@pfa.test');
  const names = async (q) => (await ask(q)).json.rows.map((r) => r.name);
  assert.deepEqual(await names({ from: '2026-11-01', to: '2026-11-30' }), ['Darshan Singh Rawat', 'Old Address'], 'a period');
  assert.deepEqual(await names({ state: 'failed' }), ['Old Address'], 'a status');
  assert.deepEqual(await names({ how: 'panel' }), ['Ravi Kumar'], 'sent from the panel');
  assert.deepEqual(await names({ q: 'DARSHAN rawat' }), ['Darshan Singh Rawat'], 'words, any case');
  assert.deepEqual(await names({ q: 'ravi@example' }), ['Ravi Kumar'], 'an email');
  const filtered = await ask({ from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual([filtered.json.count, filtered.json.total], [2, 3]);
  const csv = await ask({ state: 'sent', format: 'csv' });
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /PFA-birthday-cards-sent-2026-11-17\.csv/);
  const lines = csv.raw.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Birthday,Name,Email,Turned,Status,At,How');
  /* the test database stamps sentAt with the real clock; the line after has a set time */
  assert.match(lines[1], /^2026-11-17,Darshan Singh Rawat,darshan@example\.com,63,Sent,\d{4}-\d{2}-\d{2} \d{2}:\d{2} IST,Automatically$/, 'India time');
  assert.equal(lines[2], '2026-10-21,Ravi Kumar,ravi@example.com,40,Sent,2026-10-21 14:42 IST,From the panel by karthik@pfa.test');
  assert.equal(lines.length, 3, 'only what the filter shows');
  const log = (await db.collection('adminAudit').get()).docs.map((d) => d.data()).filter((a) => a.action === 'birthday-cards-download');
  assert.equal(log.length, 1);
  assert.match(log[0].detail, /^2 cards, state sent$/);
  const js = read('assets/admin-birthdays.js');
  for (const f of ['period', 'from', 'to', 'state', 'how', 'q']) assert.ok(js.includes(`data-bdf="${f}"`), `the ${f} filter`);
  assert.match(js, /opt\('month', 'This month', f\.period\) \+ opt\('last', 'Last month', f\.period\) \+ opt\('3m', 'Last 3 months', f\.period\) \+ opt\('year', 'This year', f\.period\) \+ opt\('all', 'All time', f\.period\) \+ opt\('custom', 'Choose the dates', f\.period\)/);
});
