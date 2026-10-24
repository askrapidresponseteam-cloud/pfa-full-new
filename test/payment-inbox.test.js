'use strict';

/* Records of money go to the payments inboxes only.

   Owner, 21 Oct 2026: "any record of money collected on the website to only
   go to pfadcmho@gmail.com ; ozairhusain@gmail.com not gandhim .. implement.
   double check and do regression test".

   A record is money when a payment opened it: a membership, a colony
   caregiver application, a donation (a gift is one) and a shop order. Each
   is copied to both payments inboxes, never to gandhim; every form keeps
   going to gandhim as before.

   Owner, 23 Oct 2026: "hope all caregiver application goes to gandhim,
   ensure it does. payment receipt to go to others. but application should
   go to gandhim email ID pls." So a caregiver application is copied twice:
   the application, without a word about the money, to gandhim; the receipt
   for its fee to the payments inboxes. The end-to-end proof, through CCAvenue's
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
    for (const kind of ['PFA-DON', 'PFA-SHP']) {
      assert.deepEqual(F.inboxes({ kind, reference: `${kind}-1` }), PAY, kind);
    }
    /* a caregiver application: the application to gandhim, the receipt to the pair */
    assert.deepEqual(F.copiesOf({ kind: 'PFA-CG', reference: 'PFA-CG-2026-00001' }),
      [{ to: GANDHIM, copy: 'application' }, ...PAY.map((to) => ({ to, copy: 'payment' }))]);
    assert.deepEqual(F.inboxes({ kind: 'PFA-CG' }), [GANDHIM, ...PAY]);
    assert.deepEqual(F.relayInboxes({ kind: 'PFA-CG' }), [GANDHIM], 'what the applicant writes back goes with the application');
    assert.deepEqual(F.relayInboxes({ kind: 'PFA-DON' }), PAY, 'a payer\'s, with the payment');
    /* the photograph sent after the first copy belongs to the application */
    assert.deepEqual(F.copiesOf({ kind: 'PFA-CG', followUp: 'photo' }), [{ to: GANDHIM, copy: 'application' }]);
    /* owner, 23 Oct 2026: "ensure all caregiver and volunteer and job and
       membership applications go to gandhim email id". A membership is
       paid, so it is split like a caregiver application; a volunteer's and
       a job application are forms. Nothing is kept to the panel alone. */
    assert.deepEqual(F.copiesOf({ kind: 'PFA-MEM' }),
      [{ to: GANDHIM, copy: 'application' }, ...PAY.map((to) => ({ to, copy: 'payment' }))]);
    assert.deepEqual(F.relayInboxes({ kind: 'PFA-MEM' }), [GANDHIM]);
    assert.deepEqual([...F.PANEL_ONLY_KINDS], []);
    for (const kind of ['PFA-V', 'PFA-J', 'PFA-U', 'PFA-CR', 'PFA-Q', 'PFA-A', 'PFA-EV', 'PFA-CK']) {
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
  /* gandhim on the payments list too: still only the application, never the receipt */
  withEnv({ PFA_PAYMENTS_INBOX: `${GANDHIM}, pfadcmho@gmail.com` }, (F) => {
    assert.deepEqual(F.copiesOf({ kind: 'PFA-CG' }), [{ to: GANDHIM, copy: 'application' }, { to: 'pfadcmho@gmail.com', copy: 'payment' }]);
  });
  /* an address on both lists gets one copy with both in it */
  withEnv({ PFA_SUBMISSIONS_INBOX: 'pfadcmho@gmail.com', PFA_PAYMENTS_INBOX: 'pfadcmho@gmail.com' }, (F) => {
    assert.deepEqual(F.copiesOf({ kind: 'PFA-CG' }), [{ to: 'pfadcmho@gmail.com', copy: 'whole' }]);
  });
  withEnv({ PFA_PAYMENTS_INBOX: `${GANDHIM}, pfadcmho@gmail.com` }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-DON' }), ['pfadcmho@gmail.com'], 'gandhim is struck from the list');
  });
  withEnv({ PFA_PAYMENTS_INBOX: 'GANDHIM@EXMPLS.SANSAD.IN' }, (F) => {
    assert.deepEqual(F.inboxes({ kind: 'PFA-SHP' }), [], 'whatever the case of the letters');
  });
  withEnv({ PFA_PAYMENTS_INBOX: 'off' }, (F) => {
    assert.deepEqual(F.copiesOf({ kind: 'PFA-MEM' }), [{ to: GANDHIM, copy: 'application' }], 'off is off for the receipt; the application still goes');
    assert.deepEqual(F.inboxes({ kind: 'PFA-DON' }), [], 'off is off');
    assert.deepEqual(F.inboxes({ kind: 'PFA-CR' }), [GANDHIM], 'and forms are untouched by it');
  });
  withEnv({}, (F) => {
    assert.deepEqual(F.forPayments([GANDHIM, 'packing@example.com']), ['packing@example.com']);
  });
});

test('the shop\'s packing note obeys the same rule', () => {
  const src = read('lib/routes/shop/response.js');
  assert.match(src, /const staff = FORWARD\.forPayments\(cleanText\(process\.env\.PFA_SHOP_ORDERS_EMAIL, 160\)\.split\(','\)\)/,
    'PFA_SHOP_ORDERS_EMAIL is passed through forPayments before anything is sent');
});

test('a payer\'s reply is carried on to the payments inboxes, and a bounce names them', () => {
  const src = read('lib/inbound-mail.js');
  assert.match(src, /const inboxes = o\.inboxes \|\| FORWARD\.allInboxes\(\);/, 'staff are recognised from every inbox');
  assert.match(src, /const route = o\.inboxes \|\| FORWARD\.relayInboxes\(data\);/, 'what is sent on follows the record');
  assert.match(src, /if \(wantsRelay\) relayed = await relay\([^;]*, o, route\);/);
  assert.match(src, /return \(inboxes \|\| FORWARD\.inboxes\(data\)\)\.join/);
  assert.match(src, /return \(inboxes \|\| FORWARD\.relayInboxes\(data\)\)\.join/);
});

test('the panel shows both destinations and checks each record against its own', () => {
  const src = read('lib/routes/admin/mail-check.js');
  assert.match(src, /paymentInboxes, recent/, 'the panel is told where records of money go');
  assert.match(src, /FORWARD\.inboxes\(d\)\.some\(\(to\) => !copied\(d, to\)\)/, 'a missing copy is judged by the record\'s own route');
  assert.match(read('admin.html'), /every application included \(caregiver, membership, volunteer and job\), without any payment in it\. Every record of money \(donations, gifts, shop orders, and the fee paid with a membership or a caregiver application\) goes to/);
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
      ['submission_forward', { reference: 'PFA-MEM-2026-00004', copy: 'payment' }],
      ['submission_forward', { reference: 'PFA-CG-2026-00011', copy: 'payment' }],
      ['submission_forward', { reference: 'PFA-CG-2026-00011', copy: 'whole' }],
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
  assert.match(src, /return require\('\.\/submission-forward'\)\.isPaid\(\{ kind: kindOf\(payload\) \}\);/, 'only a record of money is stopped');
});

/* ---- the independent review of v1.433 (21 Oct 2026) found these gaps,
   each open only through a setting; each is closed here ---------------- */

function freshMail(env) {
  const keep = {};
  const names = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_REPLY_TO', 'PFA_PAYMENTS_INBOX', 'PFA_SUBMISSIONS_INBOX', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES'];
  for (const k of names) { keep[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'x' }, env);
  delete require.cache[require.resolve('../lib/caregiver-mail.js')];
  const mail = require('../lib/caregiver-mail.js');
  const sent = [];
  mail._setSmtpTransport(() => ({ async sendMail(m) { sent.push(m); return { messageId: m.messageId || 'x' }; }, close() {} }));
  const done = () => {
    mail._setSmtpTransport(null);
    for (const k of names) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
    delete require.cache[require.resolve('../lib/caregiver-mail.js')];
  };
  return { mail, sent, done };
}

test('an allow-list, not a deny-list: money goes to the payments inboxes and to no other address', () => {
  const { mail, done } = freshMail({ PFA_SUBMISSIONS_INBOX: 'forms-alias@peopleforanimalsindia.org' });
  try {
    const m = mail.moneyToWrongInbox;
    assert.equal(m('forms-alias@peopleforanimalsindia.org', 'submission_forward', { kind: 'PFA-DON' }), true, 'another forms address is refused for money');
    assert.equal(m('someone@example.com', 'shop_order_staff', {}), true, 'so is any third address');
    assert.equal(m('pfadcmho@gmail.com', 'submission_forward', { kind: 'PFA-DON' }), false);
    assert.equal(m('OZAIRHUSAIN@gmail.com', 'submission_followup', { reference: 'pfa-cg-2026-00002' }), false, 'any case, in the address or the reference');
    assert.equal(m('forms-alias@peopleforanimalsindia.org', 'submission_forward', { kind: 'PFA-CR' }), false, 'a form is untouched');
    assert.equal(m('asha@example.com', 'payment_received', {}), false, 'the payer\'s own receipt is not a copy and is untouched');
  } finally { done(); }
});

test('a payer\'s Reply on their receipt never goes to gandhim, whatever PFA_MAIL_REPLY_TO says', async () => {
  const { mail, sent, done } = freshMail({ PFA_MAIL_REPLY_TO: GANDHIM });
  try {
    await mail.deliver({ to: 'asha@example.com', template: 'payment_received', payload: { name: 'Asha', amount: '500', orderId: 'PFA-DON-AB12CD34', reference: 'PFA-DON-AB12CD34' } });
    assert.equal(sent.length, 1);
    assert.ok(![].concat(sent[0].replyTo || []).some((a) => String(a).toLowerCase().includes(GANDHIM)), `Reply-To was ${sent[0].replyTo}`);
  } finally { done(); }
});

test('the shop\'s packing note goes only to payments inboxes, one email each', () => {
  const src = read('lib/routes/shop/response.js');
  assert.match(src, /const allowed = FORWARD\.paymentInboxes\(\);/);
  assert.match(src, /\.filter\(\(a\) => allowed\.includes\(a\)\);/, 'an address that is not a payments inbox gets no note');
  assert.match(src, /staff\.map\(\(to\) => CONFIRM\.send\(\{ to, template: 'shop_order_staff'/, 'one email per address, not a comma list in one "to"');
});

test('the panel neither resends old payments as "missed" nor chases copies the rule now refuses', () => {
  const src = read('lib/routes/admin/mail-check.js');
  assert.match(src, /&& !\(FORWARD\.isPaid\(d\) && copied\(d, FORWARD\.DEFAULT_INBOX\)\)\)/, 'a payment copied under the old route had its copy');
  assert.match(src, /\.filter\(\(d\) => !mail\.moneyToWrongInbox\(d\.to, d\.template, d\.payload\)\)/, 'a superseded copy is not listed as failing');
  assert.match(read('admin.html'), /Copies of forms are switched off<\/b> \(PFA_SUBMISSIONS_INBOX is off\)\. Every record of money still goes to/);
});

/* ---- 23 Oct 2026: every caregiver application reaches gandhim, and the
   receipt for its fee the payments inboxes ------------------------------ */

test('the last door lets a caregiver application through to gandhim, and strips anything about money from it', async () => {
  const { mail, sent, done } = freshMail({});
  try {
    const m = mail.moneyToWrongInbox;
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-CG', copy: 'application' }), false, 'the application goes to gandhim');
    assert.equal(m(GANDHIM, 'submission_forward', { reference: 'PFA-CG-2026-00011' }), false, 'so does one queued before the split');
    assert.equal(m(GANDHIM, 'submission_followup', { reference: 'PFA-CG-2026-00011' }), false, 'and what the applicant writes back');
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-CG', copy: 'payment' }), true, 'the receipt never does');
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-CG', copy: 'whole' }), true);
    assert.equal(m('pfadcmho@gmail.com', 'submission_forward', { kind: 'PFA-CG', copy: 'payment' }), false, 'the receipt goes to the pair');
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-DON' }), true, 'every other record of money is as it was');
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-MEM', copy: 'application' }), false, 'a membership application goes to gandhim');
    assert.equal(m(GANDHIM, 'submission_forward', { kind: 'PFA-MEM', copy: 'payment' }), true, 'its receipt never does');

    /* a payload that somehow carries money (planted here) still reaches
       gandhim without it */
    await mail.deliver({
      to: GANDHIM,
      template: 'submission_forward',
      payload: {
        reference: 'PFA-CG-2026-00011', kind: 'PFA-CG', kindLabel: 'Colony caregiver application', name: 'Asha Rao', email: 'asha@example.com',
        amount: '500', orderId: 'PFA-CG-ORDER-77', payment: { orderId: 'PFA-CG-ORDER-77' },
        rows: [
          { label: 'Address', value: '16 MG Road' },
          { label: 'Amount paid (INR)', value: '500' },
          { label: 'Order ID', value: 'PFA-CG-ORDER-77' },
          { label: 'CCAvenue tracking ID', value: '31233' },
          { label: 'Bank reference', value: 'BNK900' }
        ]
      }
    });
    assert.equal(sent.length, 1, 'it went');
    assert.equal(sent[0].to, GANDHIM);
    assert.match(sent[0].text, /16 MG Road/);
    assert.doesNotMatch(sent[0].text + sent[0].html, /Amount paid|PFA-CG-ORDER-77|31233|BNK900|Bank reference|tracking ID/);
  } finally { done(); }
});

test('a caregiver application\'s copies: what each inbox is given', () => {
  withEnv({}, (F) => {
    const record = {
      reference: 'PFA-CG-2026-00011', kind: 'PFA-CG', kindLabel: 'Colony caregiver application', attachments: 1,
      fields: { name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '16 MG Road', district: 'New Delhi', state: 'Delhi', title: 'Colony caregiver card application', notes: 'About 12 animals.' },
      payment: { orderId: 'PFA-CG-ORDER-77', amount: '500.00', currency: 'INR', trackingId: '31233', bankReference: 'BNK900' }
    };
    const app = F.copyPayload(record, 'https://pfa.test', 'application');
    assert.equal(app.copy, 'application');
    assert.equal(app.attachments, 1, 'the photograph goes with the application');
    /* the address is one line, with a map link, at the head of the email
       (24 Oct 2026), not three rows among the rest */
    assert.deepEqual(app.rows.map((r) => r.label), ['Application', 'About the colony']);
    assert.equal(app.place.label, 'Address');
    assert.equal(app.place.value, '16 MG Road, New Delhi district, Delhi');
    assert.match(app.place.map, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=16%20MG%20Road/);
    assert.ok(!JSON.stringify(app).match(/PFA-CG-ORDER-77|31233|BNK900|500\.00/), 'nothing about the money');

    const receipt = F.copyPayload(record, 'https://pfa.test', 'payment');
    assert.equal(receipt.copy, 'payment');
    assert.equal(receipt.kindLabel, 'Payment for a colony caregiver application');
    assert.equal(receipt.attachments, 0);
    assert.equal(receipt.place, null, 'the receipt carries no address');
    assert.deepEqual(receipt.rows, [
      { label: 'Amount paid', value: '₹500' },
      { label: 'Order ID', value: 'PFA-CG-ORDER-77' },
      { label: 'CCAvenue tracking ID', value: '31233' },
      { label: 'Bank reference', value: 'BNK900' },
      { label: 'The application', value: `Sent separately to ${GANDHIM}` }
    ]);
    assert.equal(receipt.name, 'Asha Rao', 'who paid');
    assert.equal(receipt.email, 'asha@example.com');

    /* a form is untouched */
    const form = F.copyPayload({ reference: 'PFA-CR-1', kind: 'PFA-CR', fields: { name: 'A', what: 'x' } }, '', '');
    assert.equal(form.copy, undefined);
  });
});
