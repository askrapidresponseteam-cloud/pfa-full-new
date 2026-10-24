'use strict';

/* Only the printed card goes to the applicant, and only after the back
   office approves it.

   Owner, 24 Oct 2026: "hope card wont be issued to the applicant without it
   being approved by the team at the back office. and only physical card will
   go to the applicant. card print/preview/edit option should be for admin
   only."

   Held here, against the real routes on an in-memory Firestore:
     1. nothing the applicant receives is, or opens, a card: the approval
        email and the posted email carry no card number and no card link,
        and the public card page only checks a number, in words;
     2. a card exists only by the panel's Approve, which needs a postal
        address, because the card is posted;
     3. Print and post: a card is printed, then posted, in that order and
        once; posting tells the holder it is on its way; each step shows on
        the application the applicant follows;
     4. the old "Email the holders" action is refused. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) {
        if (token === 'test-admin') return { uid: 'u1', email: 'admin@pfa.test' };
        throw new Error('bad token');
      },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const SUB = require('../lib/submissions');

const ROOT = path.join(__dirname, '..');
const NOW = Date.UTC(2026, 9, 24, 9, 0);
let db;
const sent = [];
test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); sent.length = 0; });
test.afterEach(() => { firebase._setDbForTests(null); });

function call(handler, { method = 'GET', body, token = 'test-admin', query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api/admin', query, body, headers: { host: 'pfa.test', 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const APP = (n, fields) => ({
  reference: `PFA-CG-2026-0000${n}`, kind: 'PFA-CG', kindLabel: 'Colony caregiver application', status: 'new', attachments: 1,
  receivedAtMs: NOW - 3600000, createdAt: new Date(NOW - 3600000).toISOString(),
  history: [{ status: 'new', at: new Date(NOW - 3600000).toISOString() }],
  payment: { orderId: `PFA-CGA-ORDER00${n}`, amount: 50, currency: 'INR' },
  fields: Object.assign({ name: 'Selina Thakur', mobile: `98765432${10 + n}`, email: `applicant${n}@example.com`,
    address: 'Car Street colony, near the temple', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101', animals: '12' }, fields)
});

function caseRoute() {
  const { createHandler } = require('../lib/routes/admin/case.js')._private;
  return createHandler({
    getDb: () => db, fieldValue: firebase.fieldValue,
    deliver: async (m) => { sent.push(m); return { providerId: 'p' + sent.length, messageId: `<m${sent.length}@pfa>` }; },
    isConfigured: () => true, now: () => NOW,
    requireAdmin: async () => ({ uid: 'u1', email: 'admin@pfa.test', name: 'Admin', role: 'super' })
  });
}
const cards = () => require('../lib/routes/admin/cards.js');
const NOT_A_CARD = /PFA-CCT-|caregiver-card\.html|download|\.png|\.pdf/i;

async function issue(n, fields) {
  await db.collection('submissions').doc(`PFA-CG-2026-0000${n}`).set(APP(n, fields));
  const res = await call(caseRoute(), { method: 'POST', body: { reference: `PFA-CG-2026-0000${n}`, action: 'approve' } });
  return res;
}

const post = (action, ids) => call(cards(), { method: 'POST', body: { action, type: 'caregiver', ids } });
const list = (filter) => call(cards(), { query: { type: 'caregiver', filter } });
const tracker = (reference) => SUB.publicView({ ...db.dump()[`submissions/${reference}`], reference });

test('approval tells the applicant it is approved and will be posted, and gives them no card', async () => {
  const res = await issue(1);
  assert.equal(res.statusCode, 200, res.raw);
  assert.match(res.json.cardId, /^PFA-CCT-[A-Z0-9]{8}$/);
  const approval = sent.find((m) => m.template === 'card_issued');
  assert.ok(approval, 'the applicant is told');
  const letter = mail.render('card_issued', approval.payload);
  for (const part of [letter.subject, letter.html, letter.text]) assert.doesNotMatch(part, NOT_A_CARD);
  assert.match(letter.subject, /approved - PFA-CG-2026-00001/);
  assert.match(letter.text, /Posting to: Car Street colony, near the temple, Udupi, Karnataka 576101/);
  assert.match(letter.text, /not sent by email or shown online/);
  assert.equal(tracker('PFA-CG-2026-00001').statusLabel, 'Card issued');
  assert.match(tracker('PFA-CG-2026-00001').next, /being printed, and the printed card will be posted/);
});

test('no card is issued without a postal address, because the card is posted', async () => {
  const res = await issue(2, { address: '', city: '', pin: '' });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json.code, 'NO_ADDRESS');
  assert.equal(db.dump()['submissions/PFA-CG-2026-00002'].cardId, undefined);
  assert.equal(Object.keys(db.dump()).filter((k) => k.startsWith('caretakerCards/')).length, 0, 'nothing on the register');
  /* and the queue says so before anyone presses Issue */
  const queue = await call(require('../lib/routes/admin/applications.js'));
  const row = queue.json.rows.find((r) => r.reference === 'PFA-CG-2026-00002');
  assert.equal(row.checks.find((c) => c.key === 'post').level, 'stop');
  assert.equal(row.ready, false);
});

test('a card is printed, then posted, once each; posting tells the holder; each step shows on the application', async () => {
  const cardId = (await issue(3)).json.cardId;

  const toPrint = await list('unprinted');
  assert.equal(toPrint.statusCode, 200, toPrint.raw);
  const row = toPrint.json.rows.find((r) => r.id === cardId);
  assert.ok(row, 'an issued card waits to be printed');
  assert.deepEqual(row.postTo, ['Car Street colony, near the temple, Udupi', 'Karnataka 576101'], 'the envelope');
  assert.equal(row.postable, true);
  assert.deepEqual((await list('unposted')).json.rows, [], 'nothing to post before it is printed');

  const early = await post('posted', [cardId]);
  assert.deepEqual(early.json.results, [{ id: cardId, ok: false, reason: 'Not printed yet.' }]);

  const printed = await post('printed', [cardId]);
  assert.deepEqual(printed.json.results, [{ id: cardId, ok: true }]);
  assert.ok(db.dump()[`caretakerCards/${cardId}`].cardPrintedAt);
  assert.equal(tracker('PFA-CG-2026-00003').timeline.at(-1).label, 'Card printed');
  assert.match(tracker('PFA-CG-2026-00003').next, /printed and will be posted/);
  const reprint = await post('printed', [cardId]);
  assert.equal(reprint.json.results[0].again, true, 'a reprint keeps the first date');
  assert.equal(tracker('PFA-CG-2026-00003').timeline.filter((t) => t.label === 'Card printed').length, 1, 'and is not told twice');

  assert.deepEqual((await list('unprinted')).json.rows.map((r) => r.id), []);
  assert.deepEqual((await list('unposted')).json.rows.map((r) => r.id), [cardId]);

  const posted = await post('posted', [cardId]);
  assert.equal(posted.json.results[0].ok, true, posted.raw);
  assert.ok(db.dump()[`caretakerCards/${cardId}`].cardPostedAt);
  assert.deepEqual((await list('unposted')).json.rows, []);
  const t = tracker('PFA-CG-2026-00003');
  assert.deepEqual(t.timeline.map((x) => x.label), ['Submitted', 'Card issued', 'Card printed', 'Card posted']);
  assert.match(t.next, /in the post to the address you gave/);

  /* the holder is told, and the email is not the card */
  const queued = Object.entries(db.dump()).filter(([k, v]) => k.startsWith('caregiverEmails/') && v.template === 'card_posted').map(([, v]) => v);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].to, 'applicant3@example.com');
  assert.equal(queued[0].payload.cardId, undefined);
  const letter = mail.render('card_posted', queued[0].payload);
  for (const part of [letter.subject, letter.html, letter.text]) assert.doesNotMatch(part, NOT_A_CARD);
  assert.match(letter.text, /printed Colony Caregiver Card was posted to you on/);

  const twice = await post('posted', [cardId]);
  assert.deepEqual(twice.json.results, [{ id: cardId, ok: false, reason: 'Already posted.' }]);
});

test('a revoked card is neither printed nor posted, and cards are never emailed', async () => {
  const cardId = (await issue(4)).json.cardId;
  await db.collection('caretakerCards').doc(cardId).set({ status: 'revoked' }, { merge: true });
  assert.deepEqual((await post('printed', [cardId])).json.results, [{ id: cardId, ok: false, reason: 'This card is revoked.' }]);
  const email = await post('email', [cardId]);
  assert.equal(email.statusCode, 400);
  assert.equal(email.json.code, 'BAD_ACTION');
  assert.equal(Object.keys(db.dump()).filter((k) => k.startsWith('caregiverEmails/') && db.dump()[k].template !== 'card_issued').length, 0);
});

test('the public card page checks a number in words and draws no card', () => {
  const page = fs.readFileSync(path.join(ROOT, 'caregiver-card.html'), 'utf8');
  for (const asset of ['assets/caregiver-card.js', 'assets/card-print.js', 'assets/card-fields.js', 'assets/qr.js']) {
    assert.ok(!page.includes(asset), `caregiver-card.html must not load ${asset}`);
  }
  assert.doesNotMatch(page, /<canvas|data-download|downloadPng|downloadPdf|PFACaregiverCard/, 'nothing draws or downloads a card');
  assert.match(page, /The card is only ever a printed card/);
  /* and the only page that draws one is the panel */
  const drawn = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('src="assets/caregiver-card.js"'));
  assert.deepEqual(drawn, ['admin.html']);
});

test('a card comes to exist only through the panel\'s Approve', () => {
  const callers = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  walk(path.join(ROOT, 'lib')).concat(walk(path.join(ROOT, 'api'))).filter((f) => f.endsWith('.js')).forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    if (/\bissueCard\(\{/.test(src) && !file.endsWith('caregiver-store.js')) callers.push(path.relative(ROOT, file));
  });
  assert.deepEqual(callers, [path.join('lib', 'routes', 'admin', 'case.js')]);
  const apply = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'caregiver', 'apply.js'), 'utf8');
  assert.match(apply, /return sendJson\(response, 410, \{\s*code: 'APPLY_MOVED'/, 'the old self-service route answers 410 before anything else');
});
