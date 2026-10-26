'use strict';

/* The life of a case, through the real routes (8 Oct 2026, review A items 6,
   7, 8 and 9): one transition table for both status routes, no same-state
   rewrite, an explicit reopen that keeps the close it ends, per-kind stages
   that can be reached, the audit row written before the answer, the older
   status route leaving the same trail, and issuing a card needing the
   Caregivers section as well as Submissions. */

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

const APPLICANT = { name: 'Meena Iyer', mobile: '9812345678', email: 'meena@example.com', address: '4 Lake Road, Chennai 600017', city: 'Chennai' };

/* ---- A6: the transition table ------------------------------------------ */

test('A6 closing a closed case again is refused (409 SAME_STATUS), and the first close and its note survive', async () => {
  await seed('PFA-Q-2026-00001');
  const first = await status('PFA-Q-2026-00001', 'handled', 'tok-a', 'Rescued; kite at the hospital');
  assert.equal(first.statusCode, 200, first.raw);
  const again = await status('PFA-Q-2026-00001', 'handled', 'tok-b');
  assert.equal(again.statusCode, 409, again.raw);
  assert.equal(again.json.code, 'SAME_STATUS');
  const r = rec('PFA-Q-2026-00001');
  assert.equal(r.handledBy, 'a@pfa.test', 'the first closer is kept');
  assert.equal(r.handledNote, 'Rescued; kite at the hospital', 'and the note is not wiped');
  assert.equal(r.history.filter((h) => h.status === 'handled').length, 1, 'one close in the history, not two');
});

test('A6 a reopen keeps the close it ends in closes[], clears who handled it, and writes a reopen line', async () => {
  await seed('PFA-Q-2026-00002');
  await status('PFA-Q-2026-00002', 'handled', 'tok-a', 'Resolved by phone');
  const back = await status('PFA-Q-2026-00002', 'new', 'tok-b');
  assert.equal(back.statusCode, 200, back.raw);
  assert.equal(back.json.reopened, true);
  const r = rec('PFA-Q-2026-00002');
  assert.equal(r.status, 'new');
  assert.equal(r.handledBy, '', 'the old closer is not left as the owner');
  assert.equal(r.handledAt, null);
  assert.equal(r.handledNote, '');
  assert.equal(r.closes.length, 1);
  assert.deepEqual({ status: r.closes[0].status, by: r.closes[0].by, note: r.closes[0].note }, { status: 'handled', by: 'a@pfa.test', note: 'Resolved by phone' });
  assert.match(r.closes[0].at, /^2026-|^\d{4}-/);
  const last = r.history[r.history.length - 1];
  assert.deepEqual({ status: last.status, event: last.event, reason: last.reason, by: last.by }, { status: 'new', event: 'reopen', reason: 'staff', by: 'b@pfa.test' });
});

test('A6 a closed case moves on only by a reopen: handled straight to spam is refused', async () => {
  await seed('PFA-Q-2026-00003');
  await status('PFA-Q-2026-00003', 'handled');
  const spam = await status('PFA-Q-2026-00003', 'spam');
  assert.equal(spam.statusCode, 409, spam.raw);
  assert.equal(spam.json.code, 'BAD_MOVE');
  assert.equal(rec('PFA-Q-2026-00003').status, 'handled');
  assert.ok(spam.json.case, 'the refusal still carries the case, so the panel redraws');
});

test('A6 per-kind stages: a volunteer application can be shortlisted, and "handled" (not one of its stages) is refused', async () => {
  await seed('PFA-V-2026-00004');
  const shortlist = await status('PFA-V-2026-00004', 'shortlisted');
  assert.equal(shortlist.statusCode, 200, shortlist.raw);
  assert.equal(shortlist.json.statusLabel, 'Shortlisted');
  const handled = await status('PFA-V-2026-00004', 'handled');
  assert.equal(handled.statusCode, 400);
  assert.equal(handled.json.code, 'BAD_STATUS');
  const view = await call(CASE(), { method: 'GET', query: { reference: 'PFA-V-2026-00004' } });
  assert.equal(view.json.case.status, 'shortlisted', 'the panel shows the stage, not "new"');
  assert.equal(view.json.case.statusLabel, 'Shortlisted');
  /* a closing stage is left by a reopen, which clears and keeps the close */
  await status('PFA-V-2026-00004', 'rejected', 'tok-a', 'Not this year');
  const reopen = await status('PFA-V-2026-00004', 'under-review', 'tok-b');
  assert.equal(reopen.json.reopened, true);
  assert.equal(rec('PFA-V-2026-00004').closes[0].note, 'Not this year');
});

test('A6 GET returns case.moves, the legal next states, with reopen marked', async () => {
  await seed('PFA-Q-2026-00005');
  let c = (await call(CASE(), { method: 'GET', query: { reference: 'PFA-Q-2026-00005' } })).json.case;
  assert.deepEqual(c.moves, [
    { status: 'in-progress', label: 'In progress', reopen: false },
    { status: 'handled', label: 'Handled', reopen: false },
    { status: 'spam', label: 'Spam', reopen: false }
  ]);
  c = (await status('PFA-Q-2026-00005', 'spam')).json.case;
  assert.deepEqual(c.moves.map((m) => [m.status, m.reopen]), [['new', true], ['in-progress', true]]);
  await seed('PFA-CG-2026-00006', { fields: APPLICANT });
  c = (await call(CASE(), { method: 'GET', query: { reference: 'PFA-CG-2026-00006' } })).json.case;
  const offered = c.moves.map((m) => m.status);
  assert.ok(!offered.includes('approved'), 'Card issued is reached by approving, never by a status move');
  assert.ok(!offered.includes('revoked'), 'nothing to revoke before a card exists');
  assert.ok(offered.includes('under-review') && offered.includes('rejected'));
});

test('A6 approve is refused on a closed (rejected) application, and no card is issued', async () => {
  await seed('PFA-CG-2026-00007', { fields: APPLICANT });
  assert.equal((await status('PFA-CG-2026-00007', 'rejected')).statusCode, 200);
  const res = await call(CASE(), { body: { reference: 'PFA-CG-2026-00007', action: 'approve' } });
  assert.equal(res.statusCode, 409, res.raw);
  assert.equal(res.json.code, 'CLOSED');
  assert.equal(Object.keys(db.dump()).filter((k) => /^caretakerCards\/[^/]+$/.test(k)).length, 0, 'no card on the register');
  assert.equal(rec('PFA-CG-2026-00007').cardId, undefined);
});

test('A6 every POST answer carries the case in the shape GET returns', async () => {
  await seed('PFA-Q-2026-00008');
  const note = await call(CASE(), { body: { reference: 'PFA-Q-2026-00008', action: 'note', text: 'Called them.' } });
  assert.equal(note.statusCode, 200);
  assert.equal(note.json.case.reference, 'PFA-Q-2026-00008');
  assert.equal(note.json.case.messages.length, 1);
  assert.ok(Array.isArray(note.json.case.moves));
  const get = await call(CASE(), { method: 'GET', query: { reference: 'PFA-Q-2026-00008' } });
  assert.deepEqual(Object.keys(note.json.case).sort(), Object.keys(get.json.case).sort());
  const assign = await call(CASE(), { body: { reference: 'PFA-Q-2026-00008', action: 'assign', to: 'k@pfa.test' } });
  assert.equal(assign.json.case.assignedTo.email, 'k@pfa.test');
});

test('A6 the table: every kind with stages can reach each of its stages from new, except those owned by an action', () => {
  const S = require('../lib/submissions');
  for (const [kind, stages] of Object.entries(S.STAGES)) {
    const offered = FLOW.movesFor({ kind, status: 'new' }).map((m) => m.status);
    for (const s of stages) {
      if (s.key === 'new' || (kind === 'PFA-CG' && (s.key === 'approved' || s.key === 'revoked'))) continue;
      /* the membership card's steps are facts, reached only by their actions
         (owner, 26 Oct 2026): a link emailed, a photograph on file, a card */
      if (kind === 'PFA-MEM' && ['photo-requested', 'photo-received', 'card-approved'].includes(s.key)) {
        assert.ok(!offered.includes(s.key), `${kind}: ${s.key} must not be offered as a status change`);
        continue;
      }
      assert.ok(offered.includes(s.key), `${kind}: ${s.key} cannot be reached`);
    }
    assert.ok(!offered.includes('handled') && !offered.includes('in-progress'), `${kind}: generic statuses are not its stages`);
  }
  assert.equal(FLOW.takeUpStatus('PFA-Q'), 'in-progress');
  assert.equal(FLOW.takeUpStatus('PFA-V'), 'under-review');
  assert.equal(FLOW.takeUpStatus('PFA-MEM'), null, 'a reply does not dispatch a membership kit');
});

/* ---- A7: the audit row is written before the answer --------------------- */

test('A7 each action has its audit row written before the response is sent', async () => {
  await seed('PFA-S-2026-00009');
  /* an audit write that takes 60 ms: a route that does not wait for it answers first */
  const real = db.collection.bind(db);
  db.collection = (name) => {
    const c = real(name);
    if (name !== 'adminAudit') return c;
    return Object.assign({}, c, { doc: (id) => Object.assign({}, c.doc(id), {
      create: (data) => new Promise((resolve, reject) => setTimeout(() => c.doc(id).create(data).then(resolve, reject), 60))
    }) });
  };
  const actions = [
    { action: 'status', status: 'in-progress' }, { action: 'assign', to: 'k@pfa.test' }, { action: 'note', text: 'called them' },
    { action: 'wall', published: true }, { action: 'reply', text: 'Thank you.' }
  ];
  for (const [i, body] of actions.entries()) {
    const res = await call(CASE(), { body: Object.assign({ reference: 'PFA-S-2026-00009' }, body) });
    assert.equal(res.statusCode, 200, res.raw);
    assert.equal(auditRows().length, i + 1, `${body.action}: its audit row is on file when the answer arrives`);
  }
  assert.deepEqual(auditRows().map((r) => r.action), ['status', 'assign', 'note', 'wall', 'reply']);
});

test('A7 audit.record never throws or rejects, so awaiting it can never break an action', async () => {
  const entry = await audit.record({ email: 'a@pfa.test' }, { module: 'submissions', action: 'status' }, { headers: {} },
    { getDb: () => db, now: () => Infinity });   // until 8 Oct 2026 this threw a RangeError out of record()
  assert.equal(entry.action, 'status');
  const broken = await audit.record({ email: 'a@pfa.test' }, { action: 'note' }, null, { getDb: () => { throw new Error('no database'); } });
  assert.equal(broken.action, 'note');
});

/* ---- A8: the older status route ----------------------------------------- */

test('A8 /api/admin/submission-status leaves the same trail as the case drawer: by, ISO times, the note in the conversation, an audit row, the same rules', async () => {
  await seed('PFA-Q-2026-00010');
  const res = await call(LEGACY(), { token: 'tok-b', body: { reference: 'PFA-Q-2026-00010', status: 'handled', note: 'Sorted on the phone' } });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(auditRows().filter((r) => r.actor.email === 'b@pfa.test').length, 1, 'audit row written before the answer');
  const r = rec('PFA-Q-2026-00010');
  const last = r.history[r.history.length - 1];
  assert.equal(last.by, 'b@pfa.test', 'the history line names who');
  assert.equal(typeof last.at, 'string');
  assert.equal(typeof r.updatedAt, 'string', 'ISO strings, as every other writer stores');
  assert.ok(msgs('PFA-Q-2026-00010').some((m) => m.type === 'note' && m.text === 'Sorted on the phone' && m.by === 'b@pfa.test'), 'the note is in the conversation');
  const twice = await call(LEGACY(), { token: 'tok-a', body: { reference: 'PFA-Q-2026-00010', status: 'handled' } });
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json.code, 'SAME_STATUS');
  assert.equal(rec('PFA-Q-2026-00010').handledNote, 'Sorted on the phone');
  const reopen = await call(LEGACY(), { token: 'tok-a', body: { reference: 'PFA-Q-2026-00010', status: 'new' } });
  assert.equal(reopen.statusCode, 200);
  const after = rec('PFA-Q-2026-00010');
  assert.equal(after.history[after.history.length - 1].event, 'reopen');
  assert.equal(after.closes[0].by, 'b@pfa.test');
});

/* ---- A9: issuing a card needs the Caregivers section too ---------------- */

test('A9 an account with Submissions but not Caregivers cannot issue a card; one with both can', async () => {
  await seed('PFA-CG-2026-00011', { fields: APPLICANT });
  const desk = await call(CASE(), { token: 'tok-desk', body: { reference: 'PFA-CG-2026-00011', action: 'approve' } });
  assert.equal(desk.statusCode, 403, desk.raw);
  assert.equal(desk.json.code, 'FORBIDDEN');
  assert.equal(Object.keys(db.dump()).filter((k) => /^caretakerCards\/[^/]+$/.test(k)).length, 0, 'no card issued');
  const ok = await call(CASE(), { token: 'tok-cards', body: { reference: 'PFA-CG-2026-00011', action: 'approve' } });
  assert.equal(ok.statusCode, 200, ok.raw);
  assert.match(ok.json.cardId, /^PFA-CCT-/);
  assert.equal(ok.json.case.status, 'approved', 'the application is at its own "Card issued" stage');
  assert.equal(ok.json.case.statusLabel, 'Card issued');
  assert.equal(rec('PFA-CG-2026-00011').cardId, ok.json.cardId);
});

test('A9 two approves at once issue one card and record it once', async () => {
  db = memoryFirestore({ latency: 3 });
  firebase._setDbForTests(db);
  await seed('PFA-CG-2026-00012', { fields: Object.assign({}, APPLICANT, { mobile: '9898989898', email: 'ravi@example.com' }) });
  const [a, b] = await Promise.all([
    call(CASE(), { body: { reference: 'PFA-CG-2026-00012', action: 'approve' } }),
    call(CASE(), { token: 'tok-b', body: { reference: 'PFA-CG-2026-00012', action: 'approve' } })
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409], `${a.raw} ${b.raw}`);
  assert.equal(Object.keys(db.dump()).filter((k) => /^caretakerCards\/[^/]+$/.test(k)).length, 1, 'one card');
  assert.equal(msgs('PFA-CG-2026-00012').filter((m) => /Approved/.test(m.text || '')).length, 1, 'one "Approved" note');
  assert.equal(rec('PFA-CG-2026-00012').history.filter((h) => h.status === 'approved').length, 1);
  assert.equal(smtp.sent.filter((m) => m.to === 'ravi@example.com').length, 1, 'one card email');
});

/* Owner, 26 Oct 2026: "why some show waiting to send.. nothing should wait".
   A copy's line was written once, when the form answered, and kept saying
   "Waiting to send" after the email went. Opening the case now reads each
   unsent line against its row on the outbound queue. */
test('an email line shows what happened to it since, not what it was when the form answered', async () => {
  const STORE = require('../lib/caregiver-store');
  const FORWARD = require('../lib/submission-forward');
  const reference = 'PFA-V-2026-00015';
  await seed(reference);
  const ref = db.collection('submissions').doc(reference);
  const inbox = 'gandhim@exmpls.sansad.in';
  /* a line from before v1.469: no emailIds, found from its key */
  const oldId = FORWARD.forwardKey({ reference, threadId: 'abcdefabcdef' }, inbox);
  await db.collection('caregiverEmails').doc(STORE.emailIdFor('submission_forward', oldId)).set({ status: 'sent', to: inbox });
  await ref.collection('messages').doc('out-forward-0123456789ab').set({ id: 'out-forward-0123456789ab', type: 'email', direction: 'out', to: inbox, state: 'queued', at: '2026-10-26T15:20:00.000Z' });
  /* a line that names its row, still being retried */
  await db.collection('caregiverEmails').doc('submission_followup_x').set({ status: 'retry', to: inbox });
  await ref.collection('messages').doc('m2-relay').set({ id: 'm2-relay', type: 'email', direction: 'out', to: inbox, state: 'queued', emailIds: ['submission_followup_x'], at: '2026-10-26T15:30:00.000Z' });

  const view = await call(CASE(), { method: 'GET', query: { reference } });
  assert.equal(view.statusCode, 200, view.raw);
  const shown = (view.json.case.messages || []).reduce((o, m) => Object.assign(o, { [m.id]: m.state }), {});
  assert.equal(shown['out-forward-0123456789ab'], 'sent', 'the copy that went says so');
  assert.equal(shown['m2-relay'], 'retry', 'one still going says how it stands now');
  assert.equal(db.dump()[`submissions/${reference}/messages/out-forward-0123456789ab`].state, 'sent', 'written as sent, so it is not read again');
});

test('the copy to the inbox names its queue row on its conversation line', async () => {
  const STORE = require('../lib/caregiver-store');
  const FORWARD = require('../lib/submission-forward');
  const reference = 'PFA-V-2026-00016';
  await seed(reference);
  const record = Object.assign({}, db.dump()[`submissions/${reference}`]);
  const slow = { isConfigured: () => true, smtpConfigured: () => false, deliver: () => new Promise(() => {}) };
  const out = await FORWARD.forward({ record, siteUrl: 'https://pfa.test', mail: slow, queue: STORE, timeoutMs: 30, db });
  assert.equal(out[0].state, 'queued', 'still going when the form answered');
  const line = Object.entries(db.dump()).find(([k]) => k.startsWith(`submissions/${reference}/messages/out-forward-`))[1];
  assert.equal(line.state, 'queued');
  assert.ok(db.dump()[`caregiverEmails/${line.emailIds[0]}`], 'the id on the line is the row on the queue');
  /* the worker sends it later: the case then says it went */
  await db.collection('caregiverEmails').doc(line.emailIds[0]).set({ status: 'sent' }, { merge: true });
  const view = await call(CASE(), { method: 'GET', query: { reference } });
  assert.equal(view.json.case.messages.find((m) => m.id === line.id).state, 'sent');
});
