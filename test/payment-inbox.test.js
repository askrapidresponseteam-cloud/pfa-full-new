'use strict';

/* Records of money go to the payments inboxes only.

   Owner, 21 Oct 2026: "any record of money collected on the website to only
   go to pfadcmho@gmail.com ; ozairhusain@gmail.com not gandhim .. implement.
   double check and do regression test".

   A record is money when a payment opened it: a membership, a colony
   caregiver application, a donation (a gift is one) and a shop order. Each
   is copied to both payments inboxes, never to gandhim; every form keeps
   going to gandhim as before. The end-to-end proof, through CCAvenue's
   callback and the real mail queue, is in test/donation-flow.test.js,
   test/email-thread.test.js and test/submissions-end-to-end.test.js. This
   file holds the rule and the guarantees around it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GANDHIM = 'gandhim@exmpls.sansad.in';
const PAY = ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'];
const VARS = ['PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PFA_SHOP_ORDERS_EMAIL'];

function withEnv(vars, fn) {
  const had = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(require('../lib/submission-forward.js')); } finally {
    for (const k of VARS) { if (had[k] === undefined) delete process.env[k]; else process.env[k] = had[k]; }
  }
}

test('every kind a payment files is a record of money', () => {
  /* a new paid flow that files a kind not listed would quietly send its
     copy to the forms inbox: this reads the two files that file them */
  const { PAID_KINDS } = require('../lib/submission-forward.js');
  const filed = new Set();
  for (const f of ['lib/routes/payment/response.js', 'lib/routes/shop/response.js']) {
    for (const m of read(f).matchAll(/\bkind: '(PFA-[A-Z]+)'/g)) filed.add(m[1]);
  }
  assert.deepEqual([...filed].sort(), ['PFA-CG', 'PFA-DON', 'PFA-MEM', 'PFA-SHP']);
  assert.deepEqual([...filed].filter((k) => !PAID_KINDS.has(k)), [], 'filed by a payment but routed as a form');
});

test('a record of money goes to both payments inboxes; a form to gandhim, as before', () => {
  withEnv({}, (F) => {
    for (const kind of ['PFA-MEM', 'PFA-CG', 'PFA-DON', 'PFA-SHP']) {
      assert.deepEqual(F.inboxes({ kind, reference: `${kind}-1` }), PAY, kind);
    }
    for (const kind of ['PFA-CR', 'PFA-Q', 'PFA-V', 'PFA-A', 'PFA-EV', 'PFA-CK']) {
      assert.deepEqual(F.inboxes({ kind }), [GANDHIM], kind);
    }
    assert.deepEqual(F.inboxes(), [GANDHIM], 'no record: the forms inbox, as before');
    assert.deepEqual(F.allInboxes().sort(), [GANDHIM, ...PAY].sort(), 'a reply from any of them is a reply from staff');
  });
});

test('no setting can send a record of money to gandhim', () => {
  /* the forms inbox may be set in Vercel or functions/.env; neither, nor a
     payments setting naming gandhim by mistake, reaches a record of money */
  withEnv({ PFA_SUBMISSIONS_INBOX: GANDHIM }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-DON' }), PAY);
  });
  withEnv({ PFA_PAYMENTS_INBOX: `${GANDHIM}, pfadcmho@gmail.com` }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-DON' }), ['pfadcmho@gmail.com'], 'gandhim is struck from the list');
  });
  withEnv({ PFA_PAYMENTS_INBOX: 'GANDHIM@EXMPLS.SANSAD.IN' }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-SHP' }), [], 'whatever the case of the letters');
  });
  withEnv({ PFA_PAYMENTS_INBOX: 'off' }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-MEM' }), [], 'off is off');
    assert.deepEqual(F.inboxes({ kind: 'PFA-CR' }), [GANDHIM], 'and forms are untouched by it');
  });
  withEnv({}, (F) => {
    assert.deepEqual(F.forPayments([GANDHIM, 'packing@example.com']), ['packing@example.com']);
  });
});

test('the shop\'s packing note obeys the same rule', () => {
  const src = read('lib/routes/shop/response.js');
  assert.match(src, /const staff = FORWARD\.forPayments\(cleanText\(process\.env\.PFA_SHOP_ORDERS_EMAIL, 160\)\.split\(','\)\)\.join\(', '\);/,
    'PFA_SHOP_ORDERS_EMAIL is passed through forPayments before anything is sent');
});

test('a payer\'s reply is carried on to the payments inboxes, and a bounce names them', () => {
  const src = read('lib/inbound-mail.js');
  assert.match(src, /const inboxes = o\.inboxes \|\| FORWARD\.allInboxes\(\);/, 'staff are recognised from every inbox');
  assert.match(src, /const route = o\.inboxes \|\| FORWARD\.inboxes\(data\);/, 'what is sent on follows the record');
  assert.match(src, /if \(wantsRelay\) relayed = await relay\([^;]*, o, route\);/);
  assert.match(src, /return \(inboxes \|\| FORWARD\.inboxes\(data\)\)\.join/);
});

test('the panel shows both destinations and checks each record against its own', () => {
  const src = read('lib/routes/admin/mail-check.js');
  assert.match(src, /paymentInboxes, recent/, 'the panel is told where records of money go');
  assert.match(src, /FORWARD\.inboxes\(d\)\.some\(\(to\) => !copied\(d, to\)\)/, 'a missing copy is judged by the record\'s own route');
  assert.match(read('admin.html'), /Every record of money \(donations, gifts, memberships, caregiver applications and shop orders\) goes to/);
});

test('the last door: no email about money is delivered to gandhim, whatever queued it', async () => {
  /* a copy queued before 21 Oct 2026 and still waiting to be retried, or a
     Resend pressed in the panel, reaches deliver() with its old address */
  const had = { u: process.env.PFA_SMTP_USER, p: process.env.PFA_SMTP_PASS };
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'x';
  const mail = require('../lib/caregiver-mail.js');
  try {
    for (const [template, payload] of [
      ['submission_forward', { reference: 'PFA-DON-AB12CD34', kind: 'PFA-DON' }],
      ['submission_forward', { reference: 'PFA-MEM-2026-00004' }],
      ['submission_followup', { reference: 'PFA-CG-2026-00011' }],
      ['submission_forward', { reference: 'PFA-SHP-ZX81QW22', kind: 'PFA-SHP' }],
      ['shop_order_staff', { orderId: 'PFA-SHP-ZX81QW22' }]
    ]) {
      await assert.rejects(mail.deliver({ to: GANDHIM, template, payload }),
        (e) => e.code === 'MONEY_NOT_FOR_THIS_INBOX' && e.kind === 'recipient', `${template} ${payload.reference || ''} was let through to gandhim`);
    }
  } finally {
    if (had.u === undefined) delete process.env.PFA_SMTP_USER; else process.env.PFA_SMTP_USER = had.u;
    if (had.p === undefined) delete process.env.PFA_SMTP_PASS; else process.env.PFA_SMTP_PASS = had.p;
  }
  /* and a form's copy to gandhim is untouched by it */
  const src = read('lib/caregiver-mail.js');
  assert.match(src, /if \(!MONEY_TEMPLATES\.has\(template\)\) return false;/);
  assert.match(src, /return FORWARD\.isPaid\(\{ kind \}\);/, 'only a record of money is stopped');
});
