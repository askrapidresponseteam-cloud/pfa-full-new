'use strict';

/* The internship quiz (owner, 2 Nov 2026: "quiz result should go to gandhim.
   each week the result should go to gandhim. quiz module should be [exam]
   grade"; 3 Nov 2026: "Make the 10 common incidents (animal related and
   animal laws) quiz. questions be me overall 30 in total. update time . and
   do a mix and it has to be [exam] standard, no less. also have a sample
   quiz/train that doesnt need login. with set of 7 qs.. and these cannot be
   in actual quiz"). Through the real portal routes on an in-memory
   Firestore. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const audit = require('../lib/admin-audit');
const BANK = require('../lib/intern-quiz-bank');
const Q = require('../lib/intern-quiz');
const QR = require('../lib/quiz-report');
const PORTAL = require('../lib/routes/intern/portal');
const ADMIN = require('../lib/routes/admin/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (iso) => Date.parse(iso);
const START = '2026-11-09';
const MIN = 60000;
let NOW;

let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PUBLIC_SITE_URL', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
  NOW = at('2026-11-05T06:00:00.000Z');
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw || '{}'); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
function admin(method, { body, query } = {}) {
  const h = ADMIN.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'priya@pfa.test', role: 'super' }), now: () => NOW });
  return respond(h, { method, url: '/api/admin/internship', query: query || {}, body, headers: {} });
}
function browser() {
  let cookie = '';
  const go = async (op, method, body) => {
    const h = PORTAL.createHandler(op, { getDb: () => db, now: () => NOW });
    const headers = { 'x-real-ip': '203.0.113.9' };
    if (cookie) headers.cookie = `__session=${cookie}`;
    if (method !== 'GET') headers['x-pfa-intern'] = '1';
    const r = await respond(h, { method, url: `/api/intern/${op}`, query: {}, body, headers, socket: { remoteAddress: '203.0.113.9' } });
    const set = r.headers['set-cookie'];
    if (set) { const m = /__session=([^;]*)/.exec(set); cookie = m ? m[1] : ''; }
    return r;
  };
  return { go };
}

/* a batch starting Monday 9 Nov, one intern, signed in */
async function intern(name) {
  const b = await admin('POST', { body: { action: 'batch-save', name: 'November 2026', startDate: START } });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  /* one intern per email (5 Nov 2026: the email finds them at sign-in) */
  const email = `${String(name || 'Asha Rao').split(' ')[0].toLowerCase()}@example.com`;
  const issued = await admin('POST', { body: { action: 'issue', batchId: b.json.batch.batchId, name: name || 'Asha Rao', email, mobile: '9876543210', dob: '2004-05-14' } });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  /* approved: signed in with the three */
  const br = browser();
  assert.equal((await br.go('session', 'POST', { email, mobile: '9876543210', dob: '2004-05-14' })).status, 200);
  return { br, internId: issued.json.internId };
}

/* the letter for a question's right answer, or a wrong one */
async function letterFor(attemptId, qid, right) {
  const a = (await db.collection('intern_quiz').doc(attemptId).get()).data();
  const q = BANK.QUESTIONS.find((x) => x.id === qid);
  const k = a.perm[qid].findIndex((orig) => (right ? orig === q.answer : orig !== q.answer));
  return Q.LETTERS[k];
}

/* answer every question; `rightIf(question)` decides which are right */
async function sit(br, rightIf) {
  let r = await br.go('quiz', 'POST', { action: 'start' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let a = r.json.attempt;
  const id = a.attemptId;
  while (a.state === 'open' && a.question) {
    const q = a.question;
    r = await br.go('quiz', 'POST', { action: 'answer', attemptId: id, qid: q.qid, choice: await letterFor(id, q.qid, rightIf(q)) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    a = r.json.attempt;
  }
  assert.equal(a.state, 'done');
  return r.json;
}

/* ---- the questions -------------------------------------------------------- */

const I = require('../lib/internship');
const PARTNERS = require('../lib/partners');

test('unlimited attempts do not mean unlimited mail: twelve quick fails send one email that day (review of 27 Nov 2026)', async () => {
  NOW = at('2026-11-09T05:00:00.000Z');
  const { br } = await intern();
  NOW = at('2026-11-10T05:00:00.000Z');
  sent = [];
  for (let k = 0; k < 12; k += 1) await sit(br, () => false);
  const quizMails = sent.filter((m) => /internship quiz/.test(m.subject));
  assert.ok(quizMails.length <= 1, `expected at most one fail email a day, got ${quizMails.length}`);
});

test('every attempt is kept and listed (attempts are never deleted)', async () => {
  NOW = at('2026-11-09T05:00:00.000Z');
  const { br, internId } = await intern();
  NOW = at('2026-11-10T05:00:00.000Z');
  for (let k = 0; k < 6; k += 1) await sit(br, () => false);
  const all = await Q.listAttempts(db, internId);
  assert.equal(all.length, 6);
});

test('a batch saved before 27 Nov 2026 shows the rule as it is now: no limit, no wait', async () => {
  NOW = at('2026-11-09T05:00:00.000Z');
  const { br } = await intern();
  /* the law task as v1.634 saved it into every batch */
  const snap = await db.collection('intern_batches').get();
  const doc = snap.docs[0];
  const b = doc.data();
  const tasks = b.tasks.map((t) => (t.auto === 'quiz' ? Object.assign({}, t, { proof: 'Counted for you: pass the quiz with 60 percent or more. Three attempts, at least a day apart; the best counts.' }) : t));
  await db.collection('intern_batches').doc(doc.id).set({ tasks }, { merge: true });
  const me = await br.go('me', 'GET');
  const law = me.json.batch.tasks.find((t) => t.auto === 'quiz');
  assert.doesNotMatch(law.proof, /Three attempts|day apart/, law.proof);
});

test('the letter of thanks moves to /partners even where the first one-time step already ran', async () => {
  await db.collection('siteMeta').doc('partnersSeed').set({ at: 'x' });
  await db.collection('siteMeta').doc('partnersLetter').set({ at: '2026-11-27T05:00:00.000Z' });
  await db.collection(PARTNERS.COLLECTION).doc('rosies-heroes').set(Object.assign({}, PARTNERS.ROSIES, { letter: 'rosies-heroes.html' }));
  const list = await PARTNERS.all(db);
  const r = list.find((p) => p.id === 'rosies-heroes');
  assert.equal(r.letter, 'partners.html');
});
