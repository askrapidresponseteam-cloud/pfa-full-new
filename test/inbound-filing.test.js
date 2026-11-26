'use strict';

/* Filing what arrives in the mailbox (8 Oct 2026, review A items 1, 2, 4 and
   7, review C items 7, 8 and 9): only the schedule or webhook may hand in an
   email; a case is taken up only while it is still new, with its own status
   line; the person writing back reopens a handled case; automatic replies
   are recorded and move nothing; a large photo is kept in Storage and the
   relay counts only what was kept; a bounce is linked to the case it was
   about. */

const test = require('node:test');
const assert = require('node:assert/strict');

const USERS = {
  'tok-a': { uid: 'ua', email: 'a@pfa.test', claims: { admin: true, role: 'super' } },
  'tok-desk': { uid: 'ud', email: 'desk@pfa.test', claims: { admin: true, role: 'staff', modules: ['overview', 'submissions', 'verify'] } }
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
const INBOUND = require('../lib/inbound-mail');
const FILES = require('../lib/file-store');

const INBOX = 'gandhim@exmpls.sansad.in';
const SITE = 'info@peopleforanimalsindia.org';
const PERSON = 'asha@example.com';
const TID = 'abcdefabcdef';
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_SUBMISSIONS_INBOX', 'PFA_IMAP_USER', 'PFA_IMAP_PASS'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: SITE, PFA_SMTP_PASS: 'x', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret', PFA_SUBMISSIONS_INBOX: INBOX });
  delete process.env.PFA_IMAP_USER; delete process.env.PFA_IMAP_PASS;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = { sent: [] };
  mailer._setSmtpTransport(() => ({ async sendMail(m) { smtp.sent.push(m); return { messageId: m.messageId }; }, close() {} }));
  global.fetch = async () => { throw new Error('no network in tests'); };
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  FILES._setBucket(null);
  INBOUND._setClient(null);
  INBOUND._setParser(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, token = 'tok-a', bearer }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {}, getHeader() {}, writeHead(c) { out.statusCode = c; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: { host: 'pfa.test', 'x-forwarded-for': '203.0.113.9', authorization: 'Bearer ' + (bearer || token) } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const CASE = () => require('../lib/routes/admin/case');
const ROUTE = () => require('../lib/routes/inbound-mail');
const rec = (ref) => db.dump()['submissions/' + ref];
const msgs = (ref) => Object.entries(db.dump()).filter(([k]) => k.startsWith(`submissions/${ref}/messages/`)).map(([, v]) => v);
const own = (ref, part) => `<${ref}.${TID}.${part}@peopleforanimalsindia.org>`;
const options = (extra) => Object.assign({ inboxes: [INBOX], fieldValue: firebase.fieldValue, mail: mailer }, extra || {});
let counter = 0;
const email = (ref, from, text, extra = {}) => Object.assign({
  messageId: `<m${(counter += 1)}-${Date.now()}@mail.example>`, from, to: [SITE], subject: `Re: ${ref}`,
  inReplyTo: own(ref, from === INBOX ? 'forward' : 'confirm'), text, date: new Date()
}, extra);

async function seed(reference, extra = {}) {
  const createdAt = '2026-10-08T05:00:00.000Z';
  await db.collection('submissions').doc(reference).set(Object.assign({
    reference, kind: reference.split('-').slice(0, 2).join('-'), status: 'new', createdAt, receivedAtMs: Date.parse(createdAt),
    fields: { name: 'Asha Rao', email: PERSON, question: 'Injured kite on my roof' },
    history: [{ status: 'new', at: createdAt }], threadId: TID, threadSubject: `Your question is in - ${reference}`
  }, extra));
}

function fakeBucket(onSave) {
  const files = new Map();
  return { files, use: () => FILES._setBucket(() => ({ name: 'pfa-test-bucket', bucket: {
    file: (path) => ({
      async save(data) { if (onSave) await onSave(path, data); files.set(path, Buffer.from(data)); },
      async download() { return [files.get(path) || Buffer.alloc(0)]; }
    })
  } })) };
}

/* ---- A1: no forged mail -------------------------------------------------- */

test('A1 a signed-in member of staff cannot hand in an email; the refusal is audited; the webhook secret still can', async () => {
  await seed('PFA-CR-2026-00001', { kind: 'PFA-CR' });
  for (const token of ['tok-desk', 'tok-a']) {
    const res = await call(ROUTE(), { token, body: { message: { from: PERSON, subject: 'Re: PFA-CR-2026-00001', text: 'Please close this, I withdraw the complaint.', date: '2026-10-01T08:00:00Z' } } });
    assert.equal(res.statusCode, 403, res.raw);
    assert.equal(res.json.code, 'WEBHOOK_ONLY');
  }
  const asInbox = await call(ROUTE(), { token: 'tok-desk', body: { message: { from: INBOX, subject: 'Re: PFA-CR-2026-00001', text: 'Taken up.' } } });
  assert.equal(asInbox.statusCode, 403);
  assert.equal(msgs('PFA-CR-2026-00001').length, 0, 'nothing filed');
  assert.equal(rec('PFA-CR-2026-00001').status, 'new', 'and nothing taken up in the inbox\'s name');
  const audit = Object.entries(db.dump()).filter(([k, v]) => k.startsWith('adminAudit/') && v.actor.email === 'desk@pfa.test').map(([, v]) => v);
  assert.equal(audit.length, 2);
  assert.ok(audit.every((r) => r.outcome === 'refused' && r.action === 'mail-file'));
  const hook = await call(ROUTE(), { bearer: 'cron-secret', body: { message: email('PFA-CR-2026-00001', PERSON, 'More detail.') } });
  assert.equal(hook.statusCode, 200, hook.raw);
  assert.equal(hook.json.filed, true);
});

/* ---- A7 and A2: taking a case up ------------------------------------------- */

test('A7 the inbox answering a new case takes it up with a status line of its own, then the reply line', async () => {
  await seed('PFA-Q-2026-00002');
  const out = await INBOUND.file(db, email('PFA-Q-2026-00002', INBOX, 'We will come at 5.'), options());
  assert.equal(out.filed, true);
  const r = rec('PFA-Q-2026-00002');
  assert.equal(r.status, 'in-progress');
  assert.equal(r.handledBy, INBOX);
  const rows = r.history.slice(1).map((h) => [h.status, h.event || '', h.direction || '', h.party || '', h.by]);
  assert.deepEqual(rows, [['in-progress', '', '', '', INBOX], ['in-progress', 'reply', 'in', 'staff', INBOX]]);
});

test('A2 the inbox\'s reply filing while the case is marked spam does not undo the spam', async () => {
  await seed('PFA-Q-2026-00003');
  let release;
  const gate = new Promise((r) => { release = r; });
  fakeBucket(async () => { await gate; }).use();
  const filing = INBOUND.file(db, email('PFA-Q-2026-00003', INBOX, 'Please send the kite to the hospital.',
    { attachments: [{ filename: 'map.jpg', contentType: 'image/jpeg', content: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }] }), options());
  await new Promise((r) => setTimeout(r, 30));
  const spam = await call(CASE(), { body: { reference: 'PFA-Q-2026-00003', action: 'status', status: 'spam' } });
  assert.equal(spam.statusCode, 200);
  release();
  const out = await filing;
  assert.equal(out.filed, true, 'the email is still filed');
  const r = rec('PFA-Q-2026-00003');
  assert.equal(r.status, 'spam', 'and the case stays where the administrator put it');
  assert.equal(r.handledBy, 'a@pfa.test');
  assert.deepEqual(r.history.map((h) => h.status), ['new', 'spam', 'spam']);
});

test('A2 a take-up and a spam fired together end as spam', async () => {
  db = memoryFirestore({ latency: 3 });
  firebase._setDbForTests(db);
  await seed('PFA-Q-2026-00004');
  await Promise.all([
    INBOUND.file(db, email('PFA-Q-2026-00004', INBOX, 'Taken up.'), options()),
    call(CASE(), { body: { reference: 'PFA-Q-2026-00004', action: 'status', status: 'spam' } })
  ]);
  assert.equal(rec('PFA-Q-2026-00004').status, 'spam');
});

/* ---- A4: the person writing back ------------------------------------------- */

test('A4 the person writing back to a handled case reopens it to new, with a sender-replied reopen line, the close kept', async () => {
  await seed('PFA-Q-2026-00005');
  await call(CASE(), { body: { reference: 'PFA-Q-2026-00005', action: 'status', status: 'handled', note: 'Kite rescued' } });
  const out = await INBOUND.file(db, email('PFA-Q-2026-00005', PERSON, 'It is NOT resolved, the kite is still on the roof.'), options());
  assert.equal(out.filed, true);
  assert.equal(out.party, 'sender');
  assert.deepEqual(out.relayed, ['sent'], 'and the inbox is told');
  const r = rec('PFA-Q-2026-00005');
  assert.equal(r.status, 'new');
  assert.equal(r.handledBy, '');
  assert.equal(r.handledNote, '');
  assert.deepEqual([r.closes[0].status, r.closes[0].by, r.closes[0].note], ['handled', 'a@pfa.test', 'Kite rescued']);
  const tail = r.history.slice(-2).map((h) => [h.status, h.event, h.direction || '', h.party || '', h.reason || '']);
  assert.deepEqual(tail, [['handled', 'reply', 'in', 'sender', ''], ['new', 'reopen', '', '', 'sender-replied']]);
  const m = msgs('PFA-Q-2026-00005').find((x) => x.type === 'reply');
  assert.deepEqual([m.direction, m.party], ['in', 'sender']);
});

test('A4 a case marked spam is not reopened by its sender, nor a handled case by somebody else', async () => {
  await seed('PFA-Q-2026-00006', { status: 'spam' });
  await INBOUND.file(db, email('PFA-Q-2026-00006', PERSON, 'Why was I ignored?'), options());
  assert.equal(rec('PFA-Q-2026-00006').status, 'spam');
  await seed('PFA-Q-2026-00007', { status: 'handled', handledBy: 'a@pfa.test' });
  const other = await INBOUND.file(db, email('PFA-Q-2026-00007', 'neighbour@example.net', 'I saw it too.'), options());
  assert.equal(other.party, 'other');
  assert.equal(rec('PFA-Q-2026-00007').status, 'handled');
});

/* ---- C7: automatic replies ---------------------------------------------- */

test('C7 an out-of-office from the inbox is recorded but takes nothing up; the person\'s autoresponder is never relayed', async () => {
  await seed('PFA-Q-2026-00008');
  const ooo = await INBOUND.file(db, email('PFA-Q-2026-00008', INBOX, 'I am out of office until 20 Oct.',
    { subject: 'Out of Office: PFA-Q-2026-00008', headers: new Map([['auto-submitted', 'auto-replied']]) }), options());
  assert.equal(ooo.filed, true, 'recorded, so it can be seen');
  assert.equal(ooo.auto, 'Auto-Submitted: auto-replied');
  let r = rec('PFA-Q-2026-00008');
  assert.equal(r.status, 'new', 'not taken up');
  assert.equal(r.replyCount, undefined, 'not counted as a reply');
  assert.equal(r.history[r.history.length - 1].event, 'auto-reply');
  const auto = await INBOUND.file(db, email('PFA-Q-2026-00008', PERSON, 'Thank you for your email. I am on leave.',
    { headers: { 'X-Autoreply': 'yes' } }), options());
  assert.equal(auto.filed, true);
  assert.deepEqual(auto.relayed, [], 'not relayed to the inbox');
  assert.equal(smtp.sent.filter((m) => m.to === INBOX).length, 0);
  const stored = msgs('PFA-Q-2026-00008').filter((m) => m.auto);
  assert.equal(stored.length, 2);
  /* and an autoresponder never reopens a closed case */
  await call(CASE(), { body: { reference: 'PFA-Q-2026-00008', action: 'status', status: 'handled' } });
  await INBOUND.file(db, email('PFA-Q-2026-00008', PERSON, 'On leave.', { headers: [{ name: 'Precedence', value: 'bulk' }] }), options());
  r = rec('PFA-Q-2026-00008');
  assert.equal(r.status, 'handled');
  /* Auto-Submitted: no is a person */
  const person = await INBOUND.file(db, email('PFA-Q-2026-00008', PERSON, 'I am back; it is not fixed.', { headers: { 'auto-submitted': 'no' } }), options());
  assert.equal(person.auto, undefined);
  assert.equal(rec('PFA-Q-2026-00008').status, 'new');
});

test('C7 the headers that mark an automatic reply', () => {
  assert.equal(INBOUND.autoReplyOf({ 'Auto-Submitted': 'auto-generated' }), 'Auto-Submitted: auto-generated');
  assert.equal(INBOUND.autoReplyOf({ 'X-Autorespond': 'on' }), 'X-Autorespond');
  assert.equal(INBOUND.autoReplyOf({ Precedence: 'list' }), 'Precedence: list');
  assert.equal(INBOUND.autoReplyOf({ Precedence: 'junk' }), 'Precedence: junk');
  assert.equal(INBOUND.autoReplyOf({ Precedence: 'auto_reply' }), 'Precedence: auto_reply');
  assert.equal(INBOUND.autoReplyOf({ 'Auto-Submitted': 'no' }), '');
  assert.equal(INBOUND.autoReplyOf({}), '');
});

/* ---- C8: large attachments --------------------------------------------- */

test('C8 a 2 MB phone photo on a reply is kept in Storage, and goes with the relay; a 12 MB file is listed as not kept and not counted', async () => {
  await seed('PFA-Q-2026-00009');
  const bucket = fakeBucket();
  bucket.use();
  const queued = [];
  const queue = { async queueEmail(row) { queued.push(row); return { emailId: `e${queued.length}`, created: true }; }, async recordEmailResult() {} };
  const out = await INBOUND.file(db, email('PFA-Q-2026-00009', PERSON, 'Photos of the injured dog attached.', { attachments: [
    { filename: 'IMG_2041.jpg', contentType: 'image/jpeg', content: Buffer.alloc(2 * 1024 * 1024, 1) },
    { filename: 'VIDEO.mov', contentType: 'video/quicktime', content: Buffer.alloc(12 * 1024 * 1024, 2) }
  ] }), options({ queue }));
  assert.equal(out.filed, true);
  assert.equal(out.attachments, 1, 'one file kept');
  const docs = Object.entries(db.dump()).filter(([k]) => k.startsWith('submissions/PFA-Q-2026-00009/attachments/'));
  assert.equal(docs.length, 1);
  assert.equal(docs[0][1].storage, 'gcs', 'in Storage, not squeezed into a document');
  assert.equal(bucket.files.get(docs[0][1].path).length, 2 * 1024 * 1024);
  const m = msgs('PFA-Q-2026-00009').find((x) => x.type === 'reply');
  assert.deepEqual(m.files.map((f) => [f.filename, f.stored, f.why || '']), [['IMG_2041.jpg', true, ''], ['VIDEO.mov', false, 'larger than 10 MB']]);
  const relay = queued.find((q) => q.template === 'submission_followup');
  assert.equal(relay.payload.attachments, 1, 'the relay counts only what was kept');
  assert.deepEqual(relay.payload.attachmentIds, [m.files[0].id], 'and names the kept file, to go with it');
  assert.equal(relay.payload.notKept, 1);
});

test('C8 without Storage a large photo is listed as not kept, and the relay does not claim it', async () => {
  await seed('PFA-Q-2026-00010');
  const out = await INBOUND.file(db, email('PFA-Q-2026-00010', PERSON, 'Photo attached.', { attachments: [
    { filename: 'IMG_1.jpg', contentType: 'image/jpeg', content: Buffer.alloc(2 * 1024 * 1024, 1) }] }), options());
  assert.equal(out.filed, true);
  assert.equal(out.attachments, 0);
  const relay = smtp.sent.find((m) => m.to === INBOX);
  assert.ok(relay, 'relayed');
  assert.doesNotMatch(relay.text, /Attachments: 1 file/, 'the relay does not say a file is in the panel when it is not');
  const m = msgs('PFA-Q-2026-00010').find((x) => x.type === 'reply');
  assert.equal(m.files[0].stored, false);
  assert.match(m.files[0].why, /file storage/);
});

test('C8 Storage refusing a large file just now leaves the email to the next reading, rather than filing it without the file', async () => {
  await seed('PFA-Q-2026-00011');
  let refuse = true;
  fakeBucket(async () => { if (refuse) throw new Error('503 Service Unavailable'); }).use();
  const message = email('PFA-Q-2026-00011', PERSON, 'Photo attached.', { attachments: [
    { filename: 'IMG_1.jpg', contentType: 'image/jpeg', content: Buffer.alloc(2 * 1024 * 1024, 1) }] });
  await assert.rejects(INBOUND.file(db, message, options()), /could not be stored just now/);
  assert.equal(msgs('PFA-Q-2026-00011').length, 0, 'not filed yet');
  refuse = false;
  const out = await INBOUND.file(db, message, options());
  assert.equal(out.filed, true);
  assert.equal(out.attachments, 1);
});

/* ---- C9: bounces --------------------------------------------------------- */

test('C9 a bounce of the copy to the inbox is linked to its case: a note, a bounce line, mailProblems, once', async () => {
  await seed('PFA-Q-2026-00012', { status: 'in-progress' });
  const marked = [];
  const dsn = {
    from: 'MAILER-DAEMON@mx.sansad.in', to: [SITE], subject: 'Undelivered Mail Returned to Sender', messageId: '<dsn1@mx.sansad.in>',
    text: `This is the mail system at host mx.sansad.in.\n<${INBOX}>: 552 5.2.2 Mailbox full\n\nMessage-ID: ${own('PFA-Q-2026-00012', 'forward')}\nSubject: PFA-Q-2026-00012: Help desk query from Asha Rao`
  };
  const out = await INBOUND.file(db, dsn, options({ queue: { async markBounced(p) { marked.push(p); } } }));
  assert.equal(out.filed, true, JSON.stringify(out));
  assert.equal(out.bounce, true);
  const note = msgs('PFA-Q-2026-00012').find((m) => m.event === 'bounce');
  assert.equal(note.type, 'note');
  assert.equal(note.text, `The email to ${INBOX} was not delivered: 552 5.2.2 Mailbox full`);
  const r = rec('PFA-Q-2026-00012');
  assert.equal(r.status, 'in-progress', 'a bounce moves nothing');
  const line = r.history[r.history.length - 1];
  assert.deepEqual([line.event, line.status, line.to], ['bounce', 'in-progress', INBOX]);
  assert.equal(r.mailProblems.length, 1);
  assert.deepEqual([r.mailProblems[0].to, r.mailProblems[0].part, r.mailProblems[0].messageId], [INBOX, 'forward', own('PFA-Q-2026-00012', 'forward')]);
  assert.equal(marked.length, 1, 'the outbound queue is asked to mark its row, when it can');
  assert.equal(marked[0].messageId, own('PFA-Q-2026-00012', 'forward'));
  const again = await INBOUND.file(db, dsn, options());
  assert.equal(again.reason, 'DUPLICATE');
  assert.equal(rec('PFA-Q-2026-00012').mailProblems.length, 1);
  const c = (await call(CASE(), { method: 'GET', query: { reference: 'PFA-Q-2026-00012' } })).json.case;
  assert.equal(c.mailProblems[0].reason, '552 5.2.2 Mailbox full');
  /* never a match on a guessed thread */
  const forged = Object.assign({}, dsn, { messageId: '<dsn2@mx.sansad.in>', text: dsn.text.replace(TID, '000000000000') });
  assert.equal((await INBOUND.file(db, forged, options())).filed, false);
});

test('C9 a real delivery report (multipart/report) read from the mailbox, about a reply to the person, names the person and the reason', async () => {
  await seed('PFA-Q-2026-00013');
  const bounced = own('PFA-Q-2026-00013', 'reply.1');
  const raw = [
    'From: Mail Delivery System <MAILER-DAEMON@mx.example.com>', `To: ${SITE}`, 'Subject: Undelivered Mail Returned to Sender',
    'Message-ID: <dsn9@mx.example.com>', 'Date: Thu, 8 Oct 2026 10:00:00 +0000', 'Auto-Submitted: auto-replied', 'MIME-Version: 1.0',
    'Content-Type: multipart/report; report-type=delivery-status; boundary="BB"', '',
    '--BB', 'Content-Type: text/plain; charset=us-ascii', '', 'I could not deliver your message.', '',
    '--BB', 'Content-Type: message/delivery-status', '', 'Reporting-MTA: dns; mx.example.com', '',
    `Final-Recipient: rfc822; ${PERSON}`, 'Action: failed', 'Status: 5.1.1', 'Diagnostic-Code: smtp; 550 5.1.1 User unknown', '',
    '--BB', 'Content-Type: text/rfc822-headers', '', `From: People for Animals <${SITE}>`, `To: ${PERSON}`,
    'Subject: Re: Your question is in - PFA-Q-2026-00013', `Message-ID: ${bounced}`,
    `References: ${own('PFA-Q-2026-00013', 'confirm')}`, '', '--BB--', ''
  ].join('\r\n');
  INBOUND._setClient(() => ({
    mailbox: { uidValidity: 1 }, async connect() {}, async logout() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [11]; },
    async fetchOne(uid) { return { uid: Number(uid), source: Buffer.from(raw) }; }
  }));
  const run = await INBOUND.check(db, options());
  assert.equal(run.error, undefined);
  assert.equal(run.bounces, 1);
  const r = rec('PFA-Q-2026-00013');
  assert.equal(r.mailProblems[0].to, PERSON);
  assert.equal(r.mailProblems[0].messageId, bounced, 'the bounced email, not one it referred to');
  assert.equal(r.mailProblems[0].reason, '550 5.1.1 User unknown');
  assert.equal(msgs('PFA-Q-2026-00013')[0].text, `The email to ${PERSON} was not delivered: 550 5.1.1 User unknown`);
  assert.equal(r.status, 'new');
});

/* ---- the details go with every reply (owner, 26 Nov 2026: "how is it that
   the form doesnt capture details.. i told u capturing details are a must") */
test('a reply relayed to PFA carries everything the form captured: name, mobile, address, every answer, never money', async () => {
  await seed('PFA-V-2026-00055', { kind: 'PFA-V', kindLabel: 'Volunteer application', fields: {
    name: 'Khushboo Aggarwal', email: PERSON, mobile: '9876543210', address: '12 Lake Road', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pincode: '576101',
    areas: ['Rescue', 'Fostering'], availability: 'Weekends', about: 'I feed dogs in my lane.', amount: '500'
  } });
  const queued = [];
  const queue = { async queueEmail(row) { queued.push(row); return { emailId: `e${queued.length}`, created: true }; }, async recordEmailResult() {} };
  const out = await INBOUND.file(db, email('PFA-V-2026-00055', PERSON, 'I am interested.'), options({ queue }));
  assert.equal(out.filed, true);
  const relay = queued.find((q) => q.template === 'submission_followup');
  const a = relay.payload.application;
  assert.equal(a.name, 'Khushboo Aggarwal');
  assert.equal(a.mobile, '9876543210');
  assert.match(a.place.value, /12 Lake Road, Udupi.*Karnataka 576101/);
  const values = a.rows.map((r) => r.value).join(' | ');
  assert.match(values, /Rescue, Fostering/);
  assert.match(values, /Weekends/);
  assert.match(values, /I feed dogs in my lane\./);
  assert.ok(!a.rows.some((r) => /500/.test(r.value)), 'nothing about money');
  const m = require('../lib/caregiver-mail.js').render('submission_followup', relay.payload);
  for (const want of ['I am interested.', 'Khushboo Aggarwal', '9876543210', '12 Lake Road', 'Rescue, Fostering', 'Weekends', 'Applied on']) {
    assert.ok(m.text.includes(want), `the email text carries ${want}`);
    assert.ok(m.html.includes(want), `the email carries ${want}`);
  }
});
