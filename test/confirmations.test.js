'use strict';

/* Every submission is confirmed in the themed letter, with its number called
   what it is, and every page that shows a number says what happened to the
   confirmation email and where to look for it, Spam and Junk included.

   Before v1.354 only a new member got the letter; a paid colony caregiver
   application got no email at all; and no page mentioned Spam, because no
   page knew whether an email had gone. These pin all of it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = require('../lib/submissions');
const CONFIRM = require('../lib/confirmations');
const mail = require('../lib/caregiver-mail');
const firebase = require('../lib/firebase');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;
const { sendReceipt } = require('../lib/routes/payment/response')._private;
const { PLACE } = require('./_place');

const SITE = 'https://peopleforanimalsindia.org';
const NOW = Date.UTC(2026, 8, 16, 5, 0);
const FORM_KINDS = ['PFA-CR', 'PFA-Q', 'PFA-J', 'PFA-V', 'PFA-EV', 'PFA-S', 'PFA-W', 'PFA-CK'];

/* Just enough Firestore for a record, a queue row and a transaction. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) {
      if (store.has(key(c, id))) { const e = new Error('Document already exists'); e.code = 6; throw e; }
      store.set(key(c, id), Object.assign({}, data));
    },
    async set(data, opts) {
      const prev = (opts && opts.merge && store.get(key(c, id))) || {};
      store.set(key(c, id), Object.assign({}, prev, data));
    },
    async update(data) {
      if (!store.has(key(c, id))) throw new Error('No document to update');
      store.set(key(c, id), Object.assign({}, store.get(key(c, id)), data));
    }
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => { ref.set(data, opts); },
        create: (ref, data) => { ref.create(data); },
        update: (ref, data) => { ref.update(data); }
      };
      return fn(tx);
    }
  };
}

function request({ method = 'POST', body, query = {}, headers = {} } = {}) {
  const r = new EventEmitter();
  r.method = method; r.query = query; r.headers = headers;
  if (body !== undefined) process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
function responder() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
}
async function run(handler, req) { const res = responder(); await handler(req, res); return res; }

test('every form kind is confirmed in the letter, with its number called what it is', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'img', 'mail', 'logo-mark.png')), 'the mark the letter points at is in the tree');
  for (const kind of FORM_KINDS) {
    const reference = S.formatReference(kind, 2026, 42);
    const K = CONFIRM.forKind(kind);
    const letter = mail.render('submission_received', {
      kind, name: 'Asha Rao', reference, kindLabel: S.KIND_LABELS[kind], receivedAt: '2026-09-16T05:00:00.000Z',
      siteUrl: SITE, followUrl: `${SITE}/track.html#ref=${reference}`
    });
    assert.match(letter.subject, new RegExp(reference), `${kind}: the subject does not carry the number`);
    assert.ok(letter.html.includes('background:#ffffff') && letter.html.includes('With thanks,'), `${kind}: not the letter`);
    assert.ok(letter.html.includes(`${SITE}/img/mail/logo-mark.png`), `${kind}: the letter has no mark`);
    /* Dark mode (owner, 8 Oct 2026): the lettering is text a mail app can
       recolour, never part of a picture, and nothing paints a box behind it. */
    assert.match(letter.html, /class="pfa-wordmark"[^>]*>PEOPLE FOR ANIMALS/, `${kind}: the wordmark is live text`);
    assert.ok(!letter.html.includes('logo-ink.png'), `${kind}: no picture with the lettering baked in`);
    assert.ok(!/Where it goes|Being handled/.test(letter.html), `${kind}: the letter shows a timeline`);
    assert.ok(letter.html.includes('Filed by') && letter.html.includes('Asha Rao'), `${kind}: the letter does not say who filed it`);
    assert.ok(letter.html.includes(K.number), `${kind}: the number is unlabelled`);
    assert.ok(letter.text.includes(`${K.number}: ${reference}`), `${kind}: the plain text lacks the number`);
    assert.ok(letter.html.includes(`Track your ${K.short}`), `${kind}: no way to follow it`);
    assert.ok(letter.html.includes('Dear Asha,'), `${kind}: the letter is not addressed to the sender`);
  }
});

test('an application is called an application, a report a reference, a membership a member number', () => {
  for (const kind of ['PFA-J', 'PFA-V', 'PFA-CG']) assert.equal(CONFIRM.forKind(kind).number, 'Application number', kind);
  for (const kind of ['PFA-CR', 'PFA-Q', 'PFA-EV', 'PFA-S', 'PFA-W']) assert.equal(CONFIRM.forKind(kind).number, 'Reference', kind);
  assert.equal(CONFIRM.forKind('PFA-MEM').number, 'Member number');
  assert.equal(CONFIRM.forPayment('donate').number, 'PFA transaction ID');
  /* a kind with no wording of its own is still confirmed, and still named right */
  assert.equal(CONFIRM.forKind('PFA-A').number, 'Application number');
  assert.equal(CONFIRM.forKind('PFA-CSR').number, 'Reference');
  for (const kind of Object.keys(S.KIND_LABELS)) {
    const letter = mail.render('submission_received', { kind, reference: `${kind}-2026-00001`, receivedAt: '2026-09-16', followUrl: `${SITE}/track.html` });
    assert.ok(letter.subject.length > 5 && letter.html.includes('<html') && letter.text.length > 20, `${kind} does not render`);
  }
});

test('the stages a letter lists are the stages the form shows', () => {
  const html = read('get-involved.html');
  const lists = [...html.matchAll(/<(?:ul|ol) class="gi__stages">([\s\S]*?)<\/(?:ul|ol)>/g)]
    .map((m) => [...m[1].matchAll(/<li(?![^>]*gi__arrow)[^>]*>([^<]+)<\/li>/g)].map((li) => li[1].trim()));
  assert.equal(lists.length, 3, 'get-involved.html no longer shows three stage lists');
  assert.deepEqual(lists[0], CONFIRM.forKind('PFA-V').path, 'the volunteer stages drifted');
  assert.deepEqual(lists[1], CONFIRM.forKind('PFA-MEM').path, 'the membership stages drifted');
  assert.deepEqual(lists[2], CONFIRM.forKind('PFA-CG').path, 'the caregiver stages drifted');
  assert.deepEqual(CONFIRM.GENERIC_PATH, ['Received', 'Being handled', 'Closed'], 'the public statuses drifted');
});

test('a letter never carries markup a person typed', () => {
  const letter = mail.render('submission_received', {
    kind: 'PFA-Q', name: '<img src=x onerror=alert(1)>', reference: 'PFA-Q-2026-00001', receivedAt: '2026-09-16', followUrl: `${SITE}/track.html`
  });
  assert.ok(!letter.html.includes('<img src=x'), 'the name reached the letter as markup');
  const application = mail.render('caregiver_application_received', {
    name: 'Ravi', applicationRef: 'PFA-CG-2026-00012', orderId: 'PFA-CGA-AB12CD34', amount: 50, colony: '"><script>alert(1)</script>', siteUrl: SITE
  });
  assert.ok(!application.html.includes('<script>alert'), 'the colony reached the letter as markup');
  assert.ok(!CONFIRM.noticeHtml(CONFIRM.notice({ state: 'sent', to: '<b>@x.io', reference: 'R' })).includes('<b>@'), 'the address reached the page as markup');
});

test('a letter opens with a name, not an initial or a title', () => {
  assert.equal(mail.firstName('Asha Rao'), 'Asha');
  assert.equal(mail.firstName('K. Asha Rao'), 'Asha');
  assert.equal(mail.firstName('Dr. Meena Iyer'), 'Meena');
  assert.equal(mail.firstName('Om'), 'Om');
  assert.equal(mail.firstName(''), '');
});

test('the page is told what happened to the email, and where to look for it', () => {
  const sent = CONFIRM.notice({ state: 'sent', to: 'asha@example.com', number: 'Application number', reference: 'PFA-V-2026-00007' });
  assert.equal(sent.title, 'Check your email.');
  assert.match(sent.lines[0], /application number has been emailed to asha@example\.com/);
  assert.ok(sent.steps.some((s) => /Spam or Junk/.test(s)), 'Spam and Junk are not mentioned');
  assert.ok(sent.steps.some((s) => /Promotions/.test(s)), 'the Gmail tabs are not mentioned');
  assert.ok(sent.steps.some((s) => /Not spam/.test(s)), 'marking it Not spam is not suggested');
  assert.ok(sent.steps.some((s) => s.includes('PFA-V-2026-00007')), 'searching for the number is not offered');

  const queued = CONFIRM.notice({ state: 'queued', to: 'asha@example.com', reference: 'R' });
  assert.match(queued.lines[0], /tries again/);
  assert.ok(queued.steps.length, 'an email still on its way still needs looking for');

  const unsent = CONFIRM.notice({ state: 'unsent', to: 'asha@exmaple.com' });
  assert.match(unsent.lines[0], /asha@exmaple\.com/, 'a mistyped address must be shown so it can be seen');
  assert.equal(unsent.steps.length, 0, 'no Spam advice for an email that never went');

  assert.match(CONFIRM.notice({ state: 'none' }).lines[0], /No email was given/);
});

test('a confirmation goes on the queue first; one the provider cannot take now is left for the worker', async () => {
  const rows = [];
  const results = [];
  const queue = {
    async queueEmail(row) { rows.push(row); return { emailId: `e${rows.length}`, created: true }; },
    async recordEmailResult(result) { results.push(result); return {}; }
  };
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const working = { isConfigured: () => true, deliver: async () => ({ providerId: 'p1' }) };
    const sent = await CONFIRM.send({ to: ' Asha@Example.com ', template: 'submission_received', payload: {}, dedupeKey: 'k1', mail: working, queue });
    assert.equal(sent.state, 'sent');
    assert.equal(sent.to, 'asha@example.com');
    assert.equal(rows[0].dedupeKey, 'k1');
    assert.equal(results[0].ok, true);

    const hanging = { isConfigured: () => true, deliver: () => new Promise(() => {}) };
    const started = Date.now();
    const slow = await CONFIRM.send({ to: 'a@b.in', template: 'submission_received', payload: {}, dedupeKey: 'k2', mail: hanging, queue, timeoutMs: 50 });
    assert.equal(slow.state, 'queued', 'a slow provider leaves the email to the worker');
    assert.equal(results[1].ok, false);
    assert.ok(Date.now() - started < 1000, 'the request waited on the provider');

    const refusing = { isConfigured: () => true, deliver: async () => { const e = new Error('422'); e.permanent = true; throw e; } };
    assert.equal((await CONFIRM.send({ to: 'a@b.in', template: 't', payload: {}, mail: refusing, queue })).state, 'unsent');
    assert.equal((await CONFIRM.send({ to: 'a@b.in', template: 't', payload: {}, mail: hanging, queue: null, timeoutMs: 20 })).state, 'unsent', 'with no queue nothing will retry it');
    assert.equal((await CONFIRM.send({ to: 'a@b.in', template: 't', payload: {}, mail: { isConfigured: () => false }, queue })).state, 'unsent');
    assert.equal((await CONFIRM.send({ to: 'not an email', template: 't', payload: {}, mail: working, queue })).state, 'none');

    let delivered = 0;
    const replay = await CONFIRM.send({
      to: 'a@b.in', template: 't', payload: {},
      mail: { isConfigured: () => true, deliver: async () => { delivered += 1; return {}; } },
      queue: { async queueEmail() { return { emailId: 'x', created: false }; }, async recordEmailResult() { return {}; } }
    });
    assert.equal(replay.state, 'sent');
    assert.equal(delivered, 0, 'an email already on the queue was delivered a second time');
  } finally {
    console.warn = quiet;
  }
});

test('the submissions API answers with what happened to the email, and a replay is told the same', async () => {
  S.resetForTests();
  const db = fakeDb();
  const rows = [];
  const queue = { async queueEmail(row) { rows.push(row); return { emailId: 'e1', created: true }; }, async recordEmailResult() { return {}; } };
  const handler = createHandler({ getDb: () => db, deliver: async () => ({ providerId: 'p' }), isConfigured: () => true, now: () => NOW, queue });
  const body = {
    kind: 'PFA-V', clientRequestId: 'once-1',
    data: { name: 'asha rao', mobile: '9876543210', email: 'asha@example.com', ...PLACE, title: 'Volunteer: Rescue Operations' }
  };
  const res = await run(handler, request({ body, headers: { host: 'peopleforanimalsindia.org' } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.acknowledged, true);
  assert.equal(res.body.confirmation.state, 'sent');
  assert.equal(res.body.confirmation.to, 'asha@example.com');
  assert.match(res.body.confirmation.lines[0], /application number/);
  assert.ok(res.body.confirmation.steps.some((s) => /Spam or Junk/.test(s)));
  assert.equal(rows[0].template, 'submission_received');
  assert.equal(rows[0].payload.kind, 'PFA-V');
  /* CONTRACT section 4: the key carries the record's thread once
     lib/routes/pfa-submissions.js builds it so; either form is the one
     the route gave, and the queue uses it as given */
  assert.ok([`submission_received:${res.body.reference}`, `submission_received:${res.body.reference}:${rows[0].payload.threadId}`].includes(rows[0].dedupeKey), rows[0].dedupeKey);

  const replay = await run(handler, request({ body }));
  assert.equal(replay.body.reference, res.body.reference);
  assert.deepEqual(replay.body.confirmation, res.body.confirmation, 'a double press was told something different');

  const noEmail = await run(handler, request({ body: { kind: 'PFA-EV', data: { title: 'An adoption drive', city: 'Udupi', name: 'Asha Rao', mobile: '9876543210' } } }));
  /* Since 16 Sep 2026 no submission is filed without an email. */
  assert.equal(noEmail.statusCode, 422);
  assert.equal(noEmail.body.fields[0].field, 'email');
  S.resetForTests();
});

test('a paid caregiver application is sent its application number, once', async () => {
  const db = fakeDb();
  firebase._setDbForTests(db);
  const realDeliver = mail.deliver;
  const realConfigured = mail.isConfigured;
  const sent = [];
  mail.deliver = async (message) => { sent.push(message); return { providerId: 'resend_1' }; };
  mail.isConfigured = () => true;
  try {
    const orderId = 'PFA-CGA-TESTTEST';
    await db.collection('transactions').doc(orderId).create({ orderId, type: 'caregiver-application' });
    const transaction = {
      orderId, type: 'caregiver-application', amount: '50.00', currency: 'inr',
      customer: { name: 'Ravi Kumar', mobile: '9876543210', email: 'Ravi@Example.com' },
      metadata: { address: 'Lajpat Nagar', city: 'New Delhi' },
      applicationReference: 'PFA-CG-2026-00012'
    };
    const outcome = await sendReceipt(orderId, transaction, { bankReference: 'BNK9' }, true, SITE);
    assert.equal(outcome.state, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ravi@example.com');
    assert.equal(sent[0].template, 'caregiver_application_received');
    assert.equal(sent[0].payload.applicationRef, 'PFA-CG-2026-00012');
    assert.equal(sent[0].payload.colony, 'Lajpat Nagar, New Delhi');

    const letter = mail.render(sent[0].template, sent[0].payload);
    assert.match(letter.subject, /PFA-CG-2026-00012/);
    assert.ok(letter.html.includes('Your application number') && !letter.html.includes('Card issued'), 'the number is named, and no timeline is shown');
    assert.ok(letter.html.includes('not issued on the spot'), 'the letter must not suggest the card is issued');

    assert.ok(db.store.get(`transactions/${orderId}`).receiptSentAt, 'not recorded, so a redelivered callback would send it again');
    assert.ok([...db.store.keys()].some((k) => k.startsWith('caregiverEmails/')), 'not queued, so a failure would never be retried');
    const again = await sendReceipt(orderId, { ...transaction, receiptSentAt: '2026-09-16T05:00:00.000Z' }, {}, false, SITE);
    assert.equal(again.reason, 'ALREADY_SENT');
    assert.equal(sent.length, 1);
  } finally {
    mail.deliver = realDeliver;
    mail.isConfigured = realConfigured;
    firebase._setDbForTests(null);
  }
});

test('every page that shows a number shows the email note under it', () => {
  /* newsroom.html left the list on 16 Sep 2026 with its form; cinekind.html
     joined it the same day with the 2027 nomination form. */
  for (const page of ['report.html', 'ask.html', 'careers.html', 'events.html', 'cinekind.html', 'get-involved.html', 'wall.html', 'units.html']) {
    assert.match(read(page), /PFAForms\.emailNote\(reference\)/, `${page} shows a number and never says where the email went`);
  }
  const result = read('lib/routes/payment/response.js');
  assert.match(result, /function renderMembershipWelcome\([^)]*mailNote\)/, 'the welcome page lost the email note');
  assert.match(result, /function renderResult\([^)]*mailNote\)/, 'the payment result page lost the email note');
  assert.match(read('lib/routes/pfa-submissions.js'), /notice: confirmation/, 'the page for a form posted without script lost it');
});

test('the helper keeps what the server said, and draws the note with the address in bold', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: `${SITE}/report.html` });
  const w = dom.window;
  const confirmation = CONFIRM.notice({ state: 'sent', to: 'asha@example.com', number: 'Reference', reference: 'PFA-CR-2026-00001' });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reference: 'PFA-CR-2026-00001', confirmation }) });
  w.eval(read('pfa-forms.js'));
  const reference = await w.PFAForms.submit('PFA-CR', { what: 'A dog tied without water' });
  assert.equal(reference, 'PFA-CR-2026-00001', 'submit no longer resolves with the reference alone');
  const note = w.PFAForms.emailNote(reference);
  assert.ok(note, 'no note for a reference the server confirmed');
  assert.equal(note.querySelector('strong').textContent, 'asha@example.com');
  assert.match(note.textContent, /Spam or Junk/);
  assert.ok(w.document.getElementById('pfa-mail-style'), 'the note arrived without its style');
  assert.equal(w.PFAForms.emailNote('PFA-CR-2026-99999'), null, 'a note was drawn for a number this page never issued');
});

test('a retried confirmation carries the same idempotency key; other emails carry none', () => {
  const key = mail.idempotencyKey('submission_received', 'A@b.in', { reference: 'PFA-Q-2026-00001' });
  assert.ok(key);
  assert.equal(key, mail.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00001' }));
  assert.notEqual(key, mail.idempotencyKey('submission_received', 'a@b.in', { reference: 'PFA-Q-2026-00002' }));
  assert.equal(mail.idempotencyKey('card_issued', 'a@b.in', { cardId: 'PFA-CCT-ABCD2345' }), '', 'staff resends must not be swallowed');
});

test('no letter or note says anything with an em dash', () => {
  const renders = [
    mail.render('submission_received', { kind: 'PFA-CR', name: 'A', reference: 'PFA-CR-2026-00001', receivedAt: '2026-09-16', followUrl: `${SITE}/track.html` }),
    mail.render('caregiver_application_received', { name: 'A', applicationRef: 'PFA-CG-2026-00001', orderId: 'PFA-CGA-X', amount: 50, siteUrl: SITE }),
    mail.render('payment_received', { name: 'A', orderId: 'PFA-DON-X', amount: 1500, siteUrl: SITE }),
    mail.render('membership_welcome', { name: 'A', memberId: 'PFA-MEM-2026-00001', orderId: 'PFA-MEM-X', amount: 2500, tierLabel: 'Golden membership', kit: ['A PFA T-shirt'], siteUrl: SITE })
  ];
  for (const r of renders) {
    for (const part of [r.subject, r.html, r.text]) assert.ok(!part.includes('\u2014') && !/&mdash;/.test(part), r.subject);
  }
  for (const state of ['sent', 'queued', 'unsent', 'none']) {
    assert.ok(!JSON.stringify(CONFIRM.notice({ state, to: 'a@b.in', reference: 'R' })).includes('\u2014'), state);
  }
});
