'use strict';

/* The office kept up to date on a cruelty case worked in the panel (owner,
   16 Nov 2026: "can you ensure that when user replies/works on cruelty cases
   from here- a copy goes to gandhim on what was told? ... gandhim should
   always be aware of the progress"). lib/case-progress.js. */

const test = require('node:test');
const assert = require('node:assert/strict');

const USERS = {
  'tok-a': { uid: 'ua', email: 'a@pfa.test', claims: { admin: true, role: 'super' } },
  'tok-b': { uid: 'ub', email: 'b@pfa.test', claims: { admin: true, role: 'super' } },
  'tok-desk': { uid: 'ud', email: 'desk@pfa.test', claims: { admin: true, role: 'staff', modules: ['overview', 'submissions', 'verify'] } },
  'tok-cards': { uid: 'uc', email: 'cards@pfa.test', claims: { admin: true, role: 'staff', modules: ['submissions', 'caregivers'] } }
};
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { const u = USERS[token]; if (!u) throw new Error('bad token'); return { uid: u.uid, email: u.email }; },
      async getUser(uid) { const u = Object.values(USERS).find((x) => x.uid === uid); return { uid, email: u.email, customClaims: u.claims }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const audit = require('../lib/admin-audit');
const FLOW = require('../lib/case-flow');

const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_SUBMISSIONS_INBOX'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'x', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret' });
  delete process.env.PFA_SUBMISSIONS_INBOX;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = { sent: [] };
  mailer._setSmtpTransport(() => ({ async sendMail(m) { smtp.sent.push(m); return { messageId: m.messageId }; }, close() {} }));
  global.fetch = async () => { throw new Error('no network in tests'); };
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, token = 'tok-a' }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {}, getHeader() {}, writeHead(c) { out.statusCode = c; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.9', authorization: 'Bearer ' + token } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const CASE = () => require('../lib/routes/admin/case');
const LEGACY = () => require('../lib/routes/admin/submission-status');
const rec = (ref) => db.dump()['submissions/' + ref];
const msgs = (ref) => Object.entries(db.dump()).filter(([k]) => k.startsWith(`submissions/${ref}/messages/`)).map(([, v]) => v);
const auditRows = () => Object.entries(db.dump()).filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v);
const status = (reference, s, token = 'tok-a', note) => call(CASE(), { token, body: { reference, action: 'status', status: s, note } });

async function seed(reference, extra = {}) {
  const createdAt = '2026-10-08T05:00:00.000Z';
  await db.collection('submissions').doc(reference).set(Object.assign({
    reference, kind: reference.split('-').slice(0, 2).join('-'), status: 'new', createdAt, receivedAtMs: Date.parse(createdAt),
    fields: { name: 'Asha Rao', email: 'asha@example.com', question: 'Injured kite on my roof' },
    history: [{ status: 'new', at: createdAt }], threadId: 'abcdefabcdef', threadSubject: `Your question is in - ${reference}`
  }, extra));
}


const PROGRESS = require('../lib/case-progress');
const GANDHIM = 'gandhim@exmpls.sansad.in';
const toOffice = () => smtp.sent.filter((m) => String(m.to).includes(GANDHIM));
const visible = (html) => String(html).replace(/<(style|head|title)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '\'').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

test('a reply to the person who reported cruelty: they get it, and gandhim gets what was told, in the case\'s thread', async () => {
  await seed('PFA-CR-2026-00056', { fields: { name: 'Jaswanth', email: 'trishit@example.com', what: 'A dog is chained without water' } });
  const r = await call(CASE(), { body: { reference: 'PFA-CR-2026-00056', action: 'reply', text: 'We have spoken to the police.\n\nA team visits tomorrow.', requestId: 'r1' } });
  assert.equal(r.statusCode, 200, r.raw);
  assert.ok(smtp.sent.some((m) => String(m.to).includes('trishit@example.com')), 'the reporter has the reply');
  const copy = toOffice();
  assert.equal(copy.length, 1, 'one copy to the office');
  assert.equal(copy[0].subject, 'Re: PFA-CR-2026-00056: Cruelty report from Jaswanth');
  const seen = visible(copy[0].html);
  assert.match(seen, /a@pfa\.test replied to Jaswanth\.|a replied to Jaswanth\./);
  assert.match(seen, /We have spoken to the police\. A team visits tomorrow\./, 'what was told, word for word');
  assert.match(seen, /Status now In progress/, 'the case was taken up by the reply');
  assert.match(String(copy[0].inReplyTo || copy[0].headers && copy[0].headers['In-Reply-To'] || ''), /PFA-CR-2026-00056/i, 'in the case\'s own thread');
  assert.equal(String(copy[0].replyTo || ''), 'a@pfa.test', 'answering it reaches whoever did it, never the reporter');
  /* the same request again sends nothing to anyone */
  const again = await call(CASE(), { body: { reference: 'PFA-CR-2026-00056', action: 'reply', text: 'We have spoken to the police.\n\nA team visits tomorrow.', requestId: 'r1' } });
  assert.equal(again.json.duplicate, true);
  assert.equal(toOffice().length, 1);
});

test('a status moved, a note, an assignment: each is told once, with what was said', async () => {
  await seed('PFA-CR-2026-00057', { fields: { name: 'Shreya', email: 'shreya@example.com', what: 'Puppies thrown in a drain' } });
  await call(CASE(), { body: { reference: 'PFA-CR-2026-00057', action: 'note', text: 'Called the unit in Hyderabad.' } });
  await call(CASE(), { body: { reference: 'PFA-CR-2026-00057', action: 'assign', to: 'b@pfa.test' } });
  await status('PFA-CR-2026-00057', 'in-progress', 'tok-a', 'A volunteer is on the way.');
  await status('PFA-CR-2026-00057', 'handled', 'tok-b', 'Puppies rescued, at the shelter.');
  const copies = toOffice().map((m) => visible(m.html));
  assert.equal(copies.length, 4);
  assert.match(copies[0], /added a note\..*Called the unit in Hyderabad\./);
  assert.match(copies[0], /notes stay inside PFA; Shreya does not see them/);
  assert.match(copies[1], /With b@pfa\.test now\./);
  assert.match(copies[2], /Moved to In progress\..*from Waiting to In progress, with this note:.*A volunteer is on the way\./);
  assert.match(copies[3], /Moved to Handled\..*Puppies rescued, at the shelter\..*Status now Handled/);
  assert.ok(toOffice().every((m) => m.subject === 'Re: PFA-CR-2026-00057: Cruelty report from Shreya'), 'one conversation in the inbox');
});

test('the older status route tells the office too', async () => {
  await seed('PFA-CR-2026-00058', { fields: { name: 'Mohit', email: 'mohit@example.com' } });
  const r = await call(LEGACY(), { body: { reference: 'PFA-CR-2026-00058', status: 'handled', note: 'Closed after the FIR' } });
  assert.equal(r.statusCode, 200, r.raw);
  assert.equal(toOffice().length, 1);
  assert.match(visible(toOffice()[0].html), /Moved to Handled\..*Closed after the FIR/);
});

test('not told: a reply that did not reach them, a case of another kind, or someone in that inbox doing it themselves', async () => {
  await seed('PFA-Q-2026-00009');
  await call(CASE(), { body: { reference: 'PFA-Q-2026-00009', action: 'note', text: 'A help desk note' } });
  assert.equal(toOffice().length, 0, 'a help desk query is not a cruelty case');
  assert.deepEqual(PROGRESS.recipients({ kind: 'PFA-CR' }, { email: GANDHIM }), [], 'whoever did it is not told');
  assert.deepEqual(PROGRESS.recipients({ kind: 'PFA-CR' }, { email: 'a@pfa.test' }), [GANDHIM]);
  assert.deepEqual(PROGRESS.recipients({ kind: 'PFA-DON' }, { email: 'a@pfa.test' }), [], 'never a record of money');
  await seed('PFA-CR-2026-00059', { fields: { name: 'Alisha', email: 'alisha@example.com' } });
  mailer._setSmtpTransport(() => ({ async sendMail(m) { if (String(m.to).includes('alisha')) throw Object.assign(new Error('550 no such user'), { responseCode: 550 }); smtp.sent.push(m); return { messageId: m.messageId }; }, close() {} }));
  await call(CASE(), { body: { reference: 'PFA-CR-2026-00059', action: 'reply', text: 'Hello', requestId: 'x1' } });
  assert.equal(toOffice().length, 0, 'nothing was told, so nothing is copied');
});

test('the case drawer says so, on these cases only', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /<p class="hint" id="caseOffice" hidden>Every reply, note, assignment and status change here is also emailed to PFA&#8217;s office inbox\.<\/p>/);
  assert.match(html, /\$\('#caseOffice'\)\.hidden = !\/\^PFA-CR\?\$\/\.test\(c\.kind \|\| ''\);/);
  assert.deepEqual([...PROGRESS.WATCHED].sort(), ['PFA-C', 'PFA-CR']);
});
