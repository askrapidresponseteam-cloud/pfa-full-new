'use strict';

/* Every kind of submission the server accepts reaches gandhim, without fail
   (owner, 9 Oct 2026: "every single submission goes to gandhim via info@ ..
   without fail. enterprise grade standards across").

   test/submissions-end-to-end.test.js drives each page's own form with what a
   browser sent. This is the net under it: it reads the server's own list of
   kinds (lib/submissions.js) rather than a list kept here, so a kind added
   later is held to the same rule the day it is added, with or without a
   page. For each kind the public route accepts, a submission built from that
   kind's own field rules (lib/submission-fields.js) must be:

     1. filed under a reference of its own series;
     2. copied once to gandhim@exmpls.sansad.in, Reply-To the sender;
     3. sent from info@ when PFA's own mailbox is set up.

   The kinds a payment opens (membership, caregiver card, donation, shop
   order) are never filed by the browser; each is proved by name elsewhere,
   and the last test here checks those proofs still exist. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const F = require('../lib/submission-fields');
const FORWARD = require('../lib/submission-forward');

const ROOT = path.join(__dirname, '..');
const INBOX = 'gandhim@exmpls.sansad.in';
const SENDER = 'tester.pfa@example.com';

const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SUBMISSIONS_INBOX', 'PUBLIC_SITE_URL',
  'PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_IMAP_USER', 'PFA_MAIL_FROM'];
const saved = {};
const realFetch = global.fetch;
let db;
let sent;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  sent = [];
  global.fetch = async (url, init) => {
    assert.equal(String(url), 'https://mail.test/emails');
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

test.afterEach(() => {
  global.fetch = realFetch;
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method: 'POST', url: '/api', query: {}, body,
      headers: { host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

/* A submission that passes a kind's own rules: every required field, every
   field another answer makes required, a listed choice wherever there is a
   list. */
function valueFor(spec, field) {
  const options = (spec.options || {})[field];
  if (options && options.length) return options[0];
  if (/^e-?mail$/i.test(field)) return SENDER;
  if (/^(mobile|phone)$/i.test(field)) return '9876543210';
  if (/^(url|link)$/i.test(field)) return 'https://www.youtube.com/watch?v=LCwIbbSg-8E';
  if (/^(pincode)$/i.test(field)) return '110001';
  if (/name$|^nominee$/i.test(field)) return 'Asha Rao';
  if (/^state$/i.test(field)) return 'Delhi';
  if (/^city$/i.test(field)) return 'New Delhi';
  if (/^(what|why|question|background|notes|story|details|message|plan|description)$/i.test(field)) {
    return 'A community dog near the vegetable market has a deep wound on its back leg and is limping. It needs a vet to look at it soon.';
  }
  return 'A test answer';
}

function payloadFor(kind) {
  const spec = (F.specFor && F.specFor(kind)) || {};
  const data = {};
  for (const field of Object.keys(spec.required || {})) data[field] = valueFor(spec, field);
  for (const rule of spec.requiredWhen || []) {
    if (!data[rule.when.field] && !rule.when.orBlank) data[rule.when.field] = rule.when.in[0];
    data[rule.field] = valueFor(spec, rule.field);
  }
  if (!data.name) data.name = 'Asha Rao';
  if (!data.email) data.email = SENDER;
  if (!data.mobile) data.mobile = '9876543210';
  return data;
}

const PUBLIC = Object.keys(S.KIND_LABELS).filter((kind) => !S.PAID_KINDS.has(kind));

test('the list below is the server\'s own, not a copy', () => {
  assert.ok(PUBLIC.length >= 20, 'every public kind, ' + PUBLIC.length + ' of them');
  for (const kind of ['PFA-Q', 'PFA-CR', 'PFA-J', 'PFA-V', 'PFA-CAM', 'PFA-CSR', 'PFA-LEG', 'PFA-CMP', 'PFA-SG', 'PFA-PRV']) {
    assert.ok(PUBLIC.includes(kind), kind + ' is a kind the public route accepts');
  }
  assert.equal(FORWARD.DEFAULT_INBOX, INBOX);
  assert.deepEqual(FORWARD.inboxes(), [INBOX], 'with nothing set, copies go to gandhim');
});

for (const kind of PUBLIC) {
  test(kind + ' (' + S.KIND_LABELS[kind] + '): filed, and one copy reaches gandhim with Reply-To the sender', async () => {
    const res = await call(require('../lib/routes/pfa-submissions'), { kind, data: payloadFor(kind), page: 'contract-test', clientRequestId: 'contract-' + kind });
    assert.equal(res.statusCode, 200, kind + ' was refused: ' + res.raw.slice(0, 300));
    const ref = res.json.reference;
    assert.match(ref, new RegExp('^' + kind + '-\\d{4}-\\d{5}$'));
    assert.ok(db.dump()['submissions/' + ref], 'on record');
    const copies = sent.filter((m) => [].concat(m.to).includes(INBOX));
    assert.equal(copies.length, 1, 'exactly one copy to gandhim');
    assert.equal(copies[0].reply_to, SENDER, 'Reply goes to the sender');
    assert.ok(copies[0].subject.startsWith(ref + ':'), copies[0].subject);
  });
}

test('with PFA\'s own mailbox set up, the copy to gandhim is sent from info@', async () => {
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'not-a-real-password';
  const mailer = require('../lib/caregiver-mail');
  assert.equal(mailer.smtpConfigured(), true);
  assert.equal(mailer.sender().address, 'info@peopleforanimalsindia.org');
});

test('the kinds a payment opens are each proved to reach gandhim by name', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
  const e2e = read('submissions-end-to-end.test.js');
  assert.match(e2e, /a paid membership: on record, in gandhim\\?'s inbox/);
  assert.match(e2e, /a paid colony caregiver application: on record with its photograph, in the inbox/);
  const thread = read('email-thread.test.js');
  assert.match(thread, /a donation: a case under PFA-DON, gandhim gets it with Reply-To the site/);
  assert.match(thread, /a shop order: a case under its order number, gandhim gets it with Reply-To the site/);
  assert.deepEqual([...S.PAID_KINDS].sort(), ['PFA-CG', 'PFA-DON', 'PFA-MEM', 'PFA-SHP'],
    'a new paid kind needs its own proof above before it is added');
  /* and each payment path calls the same forward */
  const paid = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  for (const fn of ['recordMembership', 'recordCaregiverApplication', 'recordDonation']) {
    const body = paid.slice(paid.indexOf('async function ' + fn), paid.indexOf('\n}\n', paid.indexOf('async function ' + fn)));
    assert.match(body, /FORWARD\.forward\(/, fn + ' forwards to the inbox');
  }
  const shop = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'shop', 'response.js'), 'utf8');
  assert.match(shop, /submission-forward/);
});
