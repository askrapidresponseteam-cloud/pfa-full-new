'use strict';

/* Verification of review C (email), C1-C12. The review's repro file asserted
   the DEFECTIVE behaviour; these assert the correct one. Mapping of the old
   test labels: C1=D1, C2=D4, C3=D5, C4=D2/D2b, C5=D3, C6=D6, C7=D7, C8=D9,
   C9=D8, C10=D10, C11=D11, C12=D12. */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_review-recheck-harness');

const INBOX = H.INBOX;
const SITE_MAILBOX = H.SITE_MAILBOX;
const PERSON_A = 'asha.rao@example.com';
const cron = { authorization: 'Bearer cron-secret' };

let W;
test.beforeEach(() => { W = H.fresh(); });
test.afterEach(() => {
  W.restore();
  H.mailer._setAttachmentLoader && H.mailer._setAttachmentLoader(null);
  const INB = require('../lib/inbound-mail'); INB._setClient(null); INB._setParser(null);
  require('../lib/file-store')._reset();
});

const Q = (o) => Object.assign({ question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, o || {});
const submit = (data, extra) => H.call(require('../lib/routes/pfa-submissions'), Object.assign({ token: null, body: { kind: 'PFA-Q', data: Q(data), page: 'ask.html', clientRequestId: 'req-' + Math.random() } }, extra || {}));
const store = () => require('../lib/caregiver-store');
const INB = () => require('../lib/inbound-mail');
const { PLACE } = require('./_place');
const opts = (o) => Object.assign({ inboxes: [INBOX], fieldValue: H.firebase.fieldValue }, o || {});

/* Moves the clock for code that reads Date.now() and new Date(). */
function atTime(t, fn) {
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } };
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
}

test('C1 a reused reference (queue survived a wipe) still sends the new confirmation and forward; the panel sees it', async () => {
  const first = await submit({ name: 'Old Person', email: 'old@example.com', mobile: '9876500001' });
  assert.equal(first.json.reference, 'PFA-Q-2026-00001');
  for (const k of [...W.db._store.keys()]) if (/^(submissions|counters|submissionIdempotency|rateLimits)\//.test(k)) W.db._store.delete(k);
  W.smtp.sent.length = 0;
  const second = await submit({ name: 'New Person', email: 'new@example.com', mobile: '9876500002', question: 'Can I foster a kitten?' });
  assert.equal(second.json.reference, 'PFA-Q-2026-00001');
  assert.ok(W.smtp.sent.some((m) => m.to === 'new@example.com'), 'confirmation to the new person');
  assert.ok(W.smtp.sent.some((m) => m.to === INBOX), 'forward of the new record');
});

test('C2 a refused login (535): the page does not blame the address, nothing is parked, and fixing the password sends everything', async () => {
  let fixed = false;
  W.smtp.fail = () => (fixed ? null : Object.assign(new Error('Invalid login: 535 Authentication Failed'), { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' }));
  const res = await submit({});
  assert.notEqual(res.json.confirmation.state, 'unsent', JSON.stringify(res.json.confirmation));
  const rowId = Object.keys(W.db.dump()).find((k) => k.startsWith('caregiverEmails/submission_received_'));
  assert.ok(rowId);
  const worker = require('../lib/routes/caregiver/email-worker');
  let t = Date.now();
  for (let i = 0; i < 8; i += 1) {
    t += 12 * 3600 * 1000;
    await atTime(t, () => H.call(worker, { token: null, headers: cron }));
  }
  const after = W.db.dump()[rowId];
  assert.notEqual(after.status, 'failed', JSON.stringify({ status: after.status, attempts: after.attempts }));
  /* the panel lists it while it waits */
  const failing = await atTime(t, () => require('../lib/routes/admin/mail-check')._private.failingEmails(W.db));
  assert.ok(failing.some((r) => `caregiverEmails/${r.id}` === rowId), JSON.stringify(failing.map((r) => r.id)));
  fixed = true;
  /* After eight refused logins the worker leaves the mailbox alone for an
     hour at most (lib/caregiver-store.js loginGate, 8 Oct 2026: it now runs
     every ten minutes, and repeated bad logins can lock the mailbox); the
     panel's Send again does not wait. */
  t += 61 * 60 * 1000;
  await atTime(t, () => H.call(worker, { token: null, headers: cron }));
  await atTime(t, () => H.call(worker, { token: null, headers: cron }));
  assert.equal(W.smtp.sent.filter((m) => m.to === PERSON_A).length, 1);
  assert.equal(W.smtp.sent.filter((m) => m.to === INBOX).length, 1);
});

test('C3 a reply whose filing throws is read again on the next run, not skipped', async () => {
  const res = await submit({});
  const ref = res.json.reference;
  const record = W.db.dump()['submissions/' + ref];
  const confirmId = `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`;
  const mailbox = [7, 8].map((uid) => ({ uid, from: PERSON_A, fromName: 'Asha Rao', to: [SITE_MAILBOX], subject: 'Re: ' + ref, messageId: `<a${uid}@example.com>`, inReplyTo: [confirmId], references: [confirmId], text: 'More ' + uid, newText: 'More ' + uid, date: new Date(), attachments: [], cc: [] }));
  let failOnce = true;
  const flaky = Object.assign({}, W.db, { runTransaction(fn) { if (failOnce) { failOnce = false; return Promise.reject(Object.assign(new Error('14 UNAVAILABLE: deadline exceeded'), { code: 14 })); } return W.db.runTransaction(fn); } });
  const read = async ({ lastUid }) => {
    const msgs = mailbox.filter((m) => m.uid > (Number(lastUid) || 0));
    return { messages: msgs, uids: msgs.map((m) => m.uid), failed: [], lastUid: Math.max(Number(lastUid) || 0, ...msgs.map((m) => m.uid)), uidValidity: '1', host: 'imap.test' };
  };
  const o = opts({ read, mail: H.mailer, queue: store() });
  const run1 = await INB().check(flaky, o);
  await INB().check(flaky, o);
  const filed = Object.entries(W.db.dump()).filter(([k]) => k.startsWith(`submissions/${ref}/messages/in-`) && !k.endsWith('-relay')).map(([, v]) => v.messageId).sort();
  assert.deepEqual(filed, ['<a7@example.com>', '<a8@example.com>']);
  assert.ok(run1.lastUid < 7);
});

test('C4a two worker runs at once send each queued email once', async () => {
  W.smtp.hold = () => H.sleep(50);
  await store().queueEmail({ template: 'inbox_test', to: INBOX, payload: { at: new Date().toISOString() }, dedupeKey: 'x1' });
  await store().queueEmail({ template: 'inbox_test', to: PERSON_A, payload: { at: new Date().toISOString() }, dedupeKey: 'x2' });
  const worker = require('../lib/routes/caregiver/email-worker');
  const later = Date.now() + store().HEAD_START_MS + 1000;
  await atTime(later, () => Promise.all([H.call(worker, { token: null, headers: cron }), H.call(worker, { token: null, headers: cron })]));
  assert.equal(W.smtp.sent.length, 2);
});

test('C4b Resend pressed while the form request is still sending does not send the forward twice', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = INBOX;
  let release; const gate = new Promise((r) => { release = r; });
  let calls = 0;
  W.smtp.hold = async (m) => { if (m.to === INBOX) { calls += 1; if (calls === 1) await gate; } };
  const pending = submit({});
  await H.sleep(150);
  const res = await H.call(require('../lib/routes/admin/mail-check'), { token: 'test-admin', body: { action: 'resend' } });
  const res2 = await H.call(require('../lib/routes/admin/mail-check'), { token: 'test-admin', body: { action: 'resend' } });
  release();
  await pending;
  assert.equal(res.statusCode, 200); assert.equal(res2.statusCode, 200);
  assert.equal(W.smtp.sent.filter((m) => m.to === INBOX).length, 1);
});

test('C5 a timeout after the message was handed over is not re-sent through the second server', async () => {
  const hosts = [];
  H.mailer._setSmtpTransport((o) => ({
    async sendMail() { hosts.push(o.host); throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' }); },
    close() {}
  }));
  await assert.rejects(H.mailer.deliver({ to: INBOX, template: 'inbox_test', payload: { at: new Date().toISOString() } }), (e) => e.kind === 'unknown');
  assert.deepEqual(hosts, ['smtpout.secureserver.net']);
  hosts.length = 0;
  H.mailer._setSmtpTransport((o) => ({
    async sendMail(m) { hosts.push(o.host); if (o.host === 'smtpout.secureserver.net') throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' }); return { messageId: m.messageId }; },
    close() {}
  }));
  await H.mailer.deliver({ to: INBOX, template: 'inbox_test', payload: { at: new Date().toISOString() } });
  assert.deepEqual(hosts, ['smtpout.secureserver.net', 'smtp.titan.email']);
});

test('C6 one message that cannot be parsed does not stop the others; it is set aside after a few runs', async () => {
  const client = {
    mailbox: { uidValidity: 1 },
    async connect() {}, async logout() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [3, 4, 5]; },
    async fetchOne(uid) { return { source: Buffer.from(`Message-ID: <m${uid}@x>\r\nFrom: a@example.com\r\nSubject: s\r\n\r\nbody`), uid: Number(uid) }; }
  };
  process.env.PFA_IMAP_USER = SITE_MAILBOX; process.env.PFA_IMAP_PASS = 'x';
  INB()._setClient(() => client);
  INB()._setParser(async (source) => { if (/m4@x/.test(String(source))) throw new Error('Unexpected end of multipart data'); return require('mailparser').simpleParser(source); });
  const runs = [];
  for (let i = 0; i < 6; i += 1) runs.push(await INB().check(W.db, { inboxes: [INBOX] }));
  assert.ok(!runs[0].error, runs[0].error);
  assert.equal(runs[0].fetched, 2);
  assert.equal(runs.at(-1).lastUid, 5);
  assert.ok(runs.some((r) => r.parked === 1));
});

test('C7 auto-replies move nothing and are never relayed; the site marks its own mail auto-generated', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = INBOX;
  const res = await submit({});
  const ref = res.json.reference;
  const record = W.db.dump()['submissions/' + ref];
  const confirm = W.smtp.sent.find((m) => m.to === PERSON_A);
  assert.equal(confirm.headers && (confirm.headers['Auto-Submitted'] || confirm.headers['auto-submitted']), 'auto-generated');
  const fwd = `<${ref}.${record.threadId}.forward@peopleforanimalsindia.org>`;
  const confirmId = `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`;
  W.smtp.sent.length = 0;
  await INB().file(W.db, { from: INBOX, to: [PERSON_A], subject: 'Out of Office: ' + ref, messageId: '<ooo1@sansad.in>', inReplyTo: fwd, references: fwd, text: 'Out of office.', headers: new Map([['auto-submitted', 'auto-replied']]) }, opts());
  const afterOoo = W.db.dump()['submissions/' + ref];
  assert.equal(afterOoo.status, 'new');
  await INB().file(W.db, { from: PERSON_A, to: [SITE_MAILBOX], subject: 'Automatic reply', messageId: '<ar1@example.com>', inReplyTo: confirmId, references: confirmId, text: 'On leave.', headers: new Map([['auto-submitted', 'auto-replied']]) }, opts({ mail: H.mailer, queue: store() }));
  assert.equal(W.smtp.sent.filter((m) => m.to === INBOX).length, 0);
  /* a staff reply typed in the panel is a person writing */
  await H.call(require('../lib/routes/admin/case'), { token: 'test-admin', body: { reference: ref, action: 'reply', text: 'Hello', requestId: 'c7' } });
  const typed = W.smtp.sent.find((m) => m.to === PERSON_A);
  assert.ok(!(typed.headers && typed.headers['Auto-Submitted']));
});

test('C8 a 2 MB photo attached to a reply is kept in Storage and travels with the relay', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = INBOX;
  const box = H.memoryBucket('pfa-new-website.firebasestorage.app');
  require('../lib/file-store')._setBucket(() => box.where);
  const res = await submit({});
  const ref = res.json.reference;
  const record = W.db.dump()['submissions/' + ref];
  const confirmId = `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`;
  W.smtp.sent.length = 0;
  const out = await INB().file(W.db, { from: PERSON_A, to: [SITE_MAILBOX], subject: 'Re: photo', messageId: '<p1@example.com>', inReplyTo: confirmId, references: confirmId, text: 'Photo attached.',
    attachments: [{ filename: 'IMG_2041.jpg', contentType: 'image/jpeg', content: Buffer.alloc(2 * 1024 * 1024, 1) }] }, opts({ mail: H.mailer, queue: store() }));
  assert.equal(out.filed, true);
  const stored = Object.keys(W.db.dump()).filter((k) => k.startsWith(`submissions/${ref}/attachments/in-`));
  assert.equal(stored.length, 1);
  const relay = W.smtp.sent.find((m) => m.to === INBOX);
  assert.ok(relay, 'relayed');
  assert.equal((relay.attachments || []).length, 1);
});

test('C8b without Storage, a 2 MB photo is not claimed to be in the panel', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = INBOX;
  require('../lib/file-store')._setBucket(() => null);
  const res = await submit({});
  const ref = res.json.reference;
  const record = W.db.dump()['submissions/' + ref];
  const confirmId = `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`;
  W.smtp.sent.length = 0;
  await INB().file(W.db, { from: PERSON_A, to: [SITE_MAILBOX], subject: 'Re: photo', messageId: '<p2@example.com>', inReplyTo: confirmId, references: confirmId, text: 'Photo attached.',
    attachments: [{ filename: 'IMG_2041.jpg', contentType: 'image/jpeg', content: Buffer.alloc(2 * 1024 * 1024, 1) }] }, opts({ mail: H.mailer, queue: store() }));
  const relay = W.smtp.sent.find((m) => m.to === INBOX);
  assert.ok(!/1 file, in the admin panel/.test(relay.text), relay.text.match(/Attach.*|Could not.*/g));
});

test('C9 a bounce of the forward is linked to its case and marks the queue row', async () => {
  process.env.PFA_SUBMISSIONS_INBOX = INBOX;
  const res = await submit({});
  const ref = res.json.reference;
  const record = W.db.dump()['submissions/' + ref];
  const fwd = `<${ref}.${record.threadId}.forward@peopleforanimalsindia.org>`;
  const dsn = { from: 'MAILER-DAEMON@mx.sansad.in', to: [SITE_MAILBOX], subject: 'Undelivered Mail Returned to Sender', messageId: '<dsn1@mx.sansad.in>',
    text: `This is the mail system at host mx.sansad.in.\n<${INBOX}>: 552 5.2.2 Mailbox full\n\nMessage-ID: ${fwd}\nSubject: ${ref}: Question from Asha Rao` };
  const out = await INB().file(W.db, dsn, opts({ queue: store() }));
  assert.equal(out.filed, true, JSON.stringify(out));
  const row = Object.entries(W.db.dump()).find(([k]) => k.startsWith('caregiverEmails/submission_forward_'))[1];
  assert.notEqual(row.status, 'sent');
  assert.ok((W.db.dump()['submissions/' + ref].mailProblems || []).length === 1);
});

test('C10 a double click on Send emails the person once', async () => {
  const res = await submit({});
  const ref = res.json.reference;
  W.smtp.sent.length = 0;
  const body = { reference: ref, action: 'reply', text: 'There is a vet at Lajpat Nagar.' };
  const caseRoute = require('../lib/routes/admin/case');
  await Promise.all([H.call(caseRoute, { token: 'test-admin', body }), H.call(caseRoute, { token: 'test-admin', body })]);
  assert.equal(W.smtp.sent.filter((m) => m.to === PERSON_A).length, 1);
});

function sentHarness(behaviour) {
  const SENT = require('../lib/sent-copy');
  process.env.PFA_SENT_COPY = 'on';
  SENT._setDb(() => W.db);
  SENT._setClient(behaviour);
  return SENT;
}

test('C11 one copy the mailbox refuses does not block the rest; it is parked', async () => {
  const sentBox = [];
  let down = true;
  const SENT = sentHarness(() => ({
    async connect() { if (down) throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); },
    async list() { return [{ path: 'Sent', specialUse: '\\Sent' }]; },
    async getMailboxLock() { return { release() {} }; },
    async search() { return []; },
    async append(path, raw) { if (/poison/.test(String(raw).slice(0, 2000))) throw Object.assign(new Error('Command failed'), { responseText: '[TOOBIG] Message too large' }); sentBox.push(String(raw).match(/Message-ID: (.*)/)[1]); },
    async logout() {}
  }));
  try {
    for (const id of ['<5-poison@pfa>', '<1-good@pfa>', '<3-good@pfa>', '<4-good@pfa>']) {
      await SENT.keep({ date: new Date(), messageId: id, from: 'x <info@peopleforanimalsindia.org>', to: INBOX, subject: id.includes('poison') ? 'poison' : 'fine', text: 't' });
    }
    await SENT.settle(3000);
    down = false;
    for (let i = 0; i < 6; i += 1) await SENT.flush(W.db, { settleAfterMs: 0 });
    assert.equal(sentBox.length, 3);
    const docs = Object.entries(W.db.dump()).filter(([k]) => /^sentCopies\/[^/]+$/.test(k)).map(([, v]) => v);
    assert.ok(docs.some((d) => d.status === 'parked'), JSON.stringify(docs.map((d) => [d.messageId, d.status, d.attempts])));
  } finally { SENT._setClient(null); SENT._setDb(null); process.env.PFA_SENT_COPY = 'off'; }
});

test('C12 two flushes at once put a copy into Sent once', async () => {
  const sentBox = [];
  let down = true;
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const SENT = sentHarness(() => ({
    async connect() { if (down) throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); await tick(); },
    async list() { return [{ path: 'Sent', specialUse: '\\Sent' }]; },
    async getMailboxLock() { return { release() {} }; },
    async search(q) { await tick(); return sentBox.map((m, i) => (m === q.header['message-id'] ? i + 1 : 0)).filter(Boolean); },
    async append(path, raw) { await tick(); sentBox.push(String(raw).match(/Message-ID: (.*)/)[1].trim()); },
    async logout() {}
  }));
  try {
    await SENT.keep({ date: new Date(), messageId: '<race-1@pfa>', from: 'x <info@peopleforanimalsindia.org>', to: INBOX, subject: 's', text: 't' });
    await SENT.settle(3000);
    down = false;
    await Promise.all([SENT.flush(W.db, { settleAfterMs: 0 }), SENT.flush(W.db, { settleAfterMs: 0 }), SENT.flush(W.db, { settleAfterMs: 0 })]);
    assert.equal(sentBox.length, 1);
  } finally { SENT._setClient(null); SENT._setDb(null); process.env.PFA_SENT_COPY = 'off'; }
});
