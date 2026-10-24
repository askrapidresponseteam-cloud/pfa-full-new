'use strict';

/* Issuing and rejecting colony caregiver cards from the panel.

   Owner, 24 Oct 2026: "caregiver card ditto. update. in admin panel. so that
   issuance is easy. there should be issue or reject..do an enterprise grade
   work", then "nothing can be clipped. nothing can overlay nothing else.
   text/font size needs to be same for every card. think like a credit card/
   aadhar card issuance system."

   Held here, against the real routes on an in-memory Firestore:
     1. the queue (GET /api/admin/applications) lists what is waiting, oldest
        first, with the server's own checks, and nothing already decided;
     2. a card is issued only with a name that fits the card at its fixed
        size: a long name needs the reviewer's confirmed short form, which is
        kept on the card, its public record and the application;
     3. Reject needs a reason, closes the application as Not issued, emails
        the applicant in the application's own thread, and is final: no
        second reject, no card after it, no reject after a card. */

const test = require('node:test');
const assert = require('node:assert/strict');

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
const PRINT = require('../assets/card-print.js');

const NOW = Date.UTC(2026, 9, 24, 9, 0);
let db;
test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); });
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

const APP = (n, fields, extra) => Object.assign({
  reference: `PFA-CG-2026-0000${n}`, kind: 'PFA-CG', kindLabel: 'Colony caregiver application', status: 'new', attachments: 1,
  receivedAtMs: NOW - (10 - n) * 3600000, createdAt: new Date(NOW - (10 - n) * 3600000).toISOString(),
  history: [{ status: 'new', at: new Date(NOW - (10 - n) * 3600000).toISOString() }],
  payment: { orderId: `PFA-CGA-ORDER00${n}`, amount: 50, currency: 'INR' },
  fields: Object.assign({ name: 'Selina Thakur', mobile: `98765432${10 + n}`, email: `applicant${n}@example.com`,
    address: 'Car Street colony, near the temple', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101', animals: '12' }, fields)
}, extra || {});

async function seed(list) {
  for (const app of list) await db.collection('submissions').doc(app.reference).set(app);
}

const sent = [];
function caseRoute(deps) {
  const { createHandler } = require('../lib/routes/admin/case.js')._private;
  return createHandler(Object.assign({
    getDb: () => db, fieldValue: firebase.fieldValue,
    deliver: async (m) => { sent.push(m); return { providerId: 'p' + sent.length, messageId: `<m${sent.length}@pfa>` }; },
    isConfigured: () => true, now: () => NOW,
    requireAdmin: async () => ({ uid: 'u1', email: 'admin@pfa.test', name: 'Admin', role: 'super' })
  }, deps || {}));
}
const queue = () => require('../lib/routes/admin/applications.js');

/* ---- 1. the queue ---------------------------------------------------------- */

test('the queue lists what is waiting, oldest first, with the server\'s checks, and nothing already decided', async () => {
  await seed([
    APP(1, {}),
    APP(2, { name: 'Venkata Subramanian Krishnamurthy' }),
    APP(3, {}, { attachments: 0 }),
    APP(4, { district: '', state: '', city: 'Somewhere' }),
    APP(5, {}, { status: 'approved', cardId: 'PFA-CCT-DONE0001' }),
    APP(6, {}, { status: 'rejected' }),
    APP(7, {}, { status: 'spam' }),
    APP(8, {}, { status: 'removed' }),
    APP(9, { mobile: '9123456789' })
  ]);
  await db.collection('caregiverMobileIndex').doc('9123456789').set({ mobile: '9123456789', cardId: 'PFA-CCT-HELD0001' });
  const res = await call(queue());
  assert.equal(res.statusCode, 200, res.raw);
  const refs = res.json.rows.map((r) => r.reference);
  assert.deepEqual(refs, ['PFA-CG-2026-00001', 'PFA-CG-2026-00002', 'PFA-CG-2026-00003', 'PFA-CG-2026-00004', 'PFA-CG-2026-00009'], 'oldest first; issued, rejected, spam and removed are not waiting');
  const by = Object.fromEntries(res.json.rows.map((r) => [r.reference.slice(-1), r]));
  const level = (row, key) => (row.checks.find((c) => c.key === key) || {}).level;
  assert.equal(by['1'].ready, true);
  assert.equal(by['1'].verdict, 'ok');
  assert.equal(by['1'].printName, 'Selina Thakur');
  assert.equal(level(by['2'], 'name'), 'warn', 'a long name is shortened, for the reviewer to check');
  assert.equal(by['2'].printName, 'Venkata S. Krishnamurthy');
  assert.equal(by['2'].printShortened, true);
  assert.equal(by['2'].ready, true, 'a shortened name does not block: the reviewer confirms it');
  assert.equal(level(by['3'], 'photo'), 'stop', 'no face, no card');
  assert.equal(by['3'].ready, false);
  assert.equal(level(by['4'], 'place'), 'stop', 'the card prints the district and state');
  assert.equal(level(by['9'], 'mobile'), 'stop');
  assert.match(by['9'].checks.find((c) => c.key === 'mobile').text, /PFA-CCT-HELD0001/);
  assert.equal(res.json.ready, 2);
});

test('the queue is the panel\'s, behind sign-in', async () => {
  const res = await call(queue(), { token: 'nobody' });
  assert.equal(res.statusCode, 401);
});

/* ---- 2. issuing, with the name the card prints ---------------------------- */

test('a long name is never issued on the rule\'s say alone: the reviewer confirms the name to print, and it is kept', async () => {
  await seed([APP(2, { name: 'Venkata Subramanian Krishnamurthy' })]);
  const route = caseRoute();
  const unconfirmed = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00002', action: 'approve' } });
  assert.equal(unconfirmed.statusCode, 422);
  assert.equal(unconfirmed.json.code, 'PRINT_NAME_NEEDED');
  assert.equal(unconfirmed.json.suggestion, 'Venkata S. Krishnamurthy');
  const tooLong = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00002', action: 'approve', printName: 'Venkata Subramanian Krishnamurthy' } });
  assert.equal(tooLong.statusCode, 422);
  assert.equal(tooLong.json.code, 'PRINT_NAME_BAD');
  assert.equal(db.dump()['submissions/PFA-CG-2026-00002'].cardId, undefined, 'nothing issued');

  const ok = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00002', action: 'approve', printName: 'V. S. Krishnamurthy' } });
  assert.equal(ok.statusCode, 200, ok.raw);
  const cardId = ok.json.cardId;
  const all = db.dump();
  assert.equal(all[`caretakerCards/${cardId}`].printName, 'V. S. Krishnamurthy', 'on the register');
  assert.equal(all[`caretakerCards/${cardId}`].name, 'Venkata Subramanian Krishnamurthy', 'the full name stays the full name');
  assert.equal(all[`caretakerPublic/${cardId}`].printName, 'V. S. Krishnamurthy', 'the holder\'s own card page prints it the same');
  assert.equal(all['submissions/PFA-CG-2026-00002'].printName, 'V. S. Krishnamurthy', 'and the application says what was printed');
  assert.equal(ok.json.case.printName, 'V. S. Krishnamurthy');
  assert.ok(PRINT.fits(all[`caretakerCards/${cardId}`].printName));
});

test('a name that fits is issued whole, without asking', async () => {
  await seed([APP(1, {})]);
  const ok = await call(caseRoute(), { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'approve' } });
  assert.equal(ok.statusCode, 200, ok.raw);
  assert.equal(db.dump()[`caretakerCards/${ok.json.cardId}`].printName, 'Selina Thakur');
});

test('a card is not issued without a district and state to print', async () => {
  await seed([APP(4, { district: '', state: '', city: 'Somewhere' })]);
  const res = await call(caseRoute(), { method: 'POST', body: { reference: 'PFA-CG-2026-00004', action: 'approve' } });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json.code, 'NO_PLACE');
});

/* ---- 3. rejecting ------------------------------------------------------- */

test('Reject needs a reason, closes the application as Not issued, and tells the applicant in their own thread', async () => {
  await seed([APP(1, {})]);
  sent.length = 0;
  const route = caseRoute();
  const bare = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'reject', text: 'No.' } });
  assert.equal(bare.statusCode, 400);
  assert.equal(bare.json.code, 'NO_REASON');

  const text = 'Thank you for applying. We are not able to issue a card.\n\nWhy:\n- We could not confirm the colony.';
  const res = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'reject', reason: 'Could not confirm the colony', text } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.status, 'rejected');
  assert.equal(res.json.statusLabel, 'Not issued');
  assert.equal(res.json.emailed, true);
  assert.equal(res.json.to, 'applicant1@example.com');
  const app = db.dump()['submissions/PFA-CG-2026-00001'];
  assert.equal(app.status, 'rejected');
  assert.equal(app.handledNote, 'Not issued. Could not confirm the colony');
  assert.equal(app.handledBy, 'admin@pfa.test');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].template, 'submission_reply', 'a reply in the application\'s own thread');
  assert.equal(sent[0].to, 'applicant1@example.com');
  assert.equal(sent[0].payload.text, text, 'the words the reviewer saw are the words sent');
  assert.equal(sent[0].payload.reference, 'PFA-CG-2026-00001');
  const audit = Object.entries(db.dump()).filter(([k, v]) => k.startsWith('adminAudit/') && v.action === 'reject');
  assert.equal(audit.length, 1, 'on the audit log');
  assert.match(audit[0][1].detail, /Could not confirm the colony/);

  /* final: no second reject, no card after it */
  const again = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'reject', reason: 'x', text: 'y' } });
  assert.equal(again.statusCode, 409);
  const issue = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'approve' } });
  assert.equal(issue.statusCode, 409);
  assert.equal(issue.json.code, 'CLOSED');
});

test('an issued application is never rejected: its card is revoked instead', async () => {
  await seed([APP(5, {}, { status: 'approved', cardId: 'PFA-CCT-DONE0001' })]);
  const res = await call(caseRoute(), { method: 'POST', body: { reference: 'PFA-CG-2026-00005', action: 'reject', reason: 'x', text: 'y' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json.code, 'ALREADY_ISSUED');
});

test('Reject is a caregiver application\'s, and needs the Colony cards section', async () => {
  await db.collection('submissions').doc('PFA-Q-2026-00001').set({ reference: 'PFA-Q-2026-00001', kind: 'PFA-Q', status: 'new', fields: { name: 'A', email: 'a@example.com' } });
  await seed([APP(1, {})]);
  const notApp = await call(caseRoute(), { method: 'POST', body: { reference: 'PFA-Q-2026-00001', action: 'reject', reason: 'x' } });
  assert.equal(notApp.statusCode, 400);
  const asked = [];
  const route = caseRoute({ requireAdmin: async (request, response, module) => {
    asked.push(module);
    if (module === 'caregivers') { response.statusCode = 403; response.end(JSON.stringify({ code: 'FORBIDDEN' })); return null; }
    return { uid: 'u2', email: 'staff@pfa.test' };
  } });
  const refused = await call(route, { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'reject', reason: 'x', text: 'y' } });
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(asked, ['submissions', 'caregivers']);
  assert.equal(db.dump()['submissions/PFA-CG-2026-00001'].status, 'new', 'nothing changed');
});

test('with no email on the application, Reject still closes it and says to call', async () => {
  await seed([APP(1, { email: '' })]);
  sent.length = 0;
  const res = await call(caseRoute(), { method: 'POST', body: { reference: 'PFA-CG-2026-00001', action: 'reject', reason: 'Details could not be verified', text: 'Sorry.' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.emailed, false);
  assert.match(res.json.message, /Call 98765432/);
  assert.equal(sent.length, 0);
  assert.equal(db.dump()['submissions/PFA-CG-2026-00001'].status, 'rejected');
});

/* ---- the panel offers both, side by side --------------------------------- */

test('the panel puts Issue and Reject on every waiting application, and in the drawer, with the name the card prints', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /<div class="pane" data-pane="apply" role="region" aria-label="Applications to decide">/);
  assert.match(html, /caregivers:[^}]*panes: \['apply', 'caregivers', 'verify', 'cards'\]/, 'first in Colony cards');
  assert.match(html, /data-ap="issue"[\s\S]{0,200}>Issue card<\/button>/);
  assert.match(html, /data-ap="reject">Reject<\/button>/);
  assert.match(html, /id="caseApprove" style="width:auto">Issue card<\/button>\s*<button class="ghost danger" type="button" id="caseReject">Reject<\/button>/);
  assert.match(html, /id="casePrintName"/, 'the drawer asks for the name on the card');
  assert.match(html, /action: 'approve', printName: printName/, 'Issue sends the name the reviewer saw');
  assert.match(html, /action: 'reject', requestId: 'reject:' \+ reference/, 'a double press rejects once and emails once');
  assert.match(html, /<script src="assets\/field-rules\.js"><\/script>\s*<script src="assets\/card-print\.js"><\/script>\s*<script src="assets\/caregiver-card\.js"><\/script>/);
  assert.match(html, /C\.unprintable\(data\)/, 'the batch PDF refuses a card that is not exactly as issued');
});
