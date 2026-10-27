'use strict';

/* Reading the mailbox, run after run (8 Oct 2026, review C items 3 and 6).
   The position (lastUid) moves past a message only once it is filed or
   deliberately left; a message whose filing threw is read again on the next
   run; one that cannot be fetched or parsed is caught on its own and the
   others are still read; a message that fails five runs in a row is set
   aside with a problem line the panel can show, and the reading moves on. */

const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const INBOUND = require('../lib/inbound-mail');

const INBOX = 'gandhim@exmpls.sansad.in';
const SITE = 'info@peopleforanimalsindia.org';
const PERSON = 'asha@example.com';
const REF = 'PFA-Q-2026-00001';
const CONFIRM_ID = `<${REF}.abcdefabcdef.confirm@peopleforanimalsindia.org>`;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_SUBMISSIONS_INBOX', 'PFA_IMAP_USER', 'PFA_IMAP_PASS'];
const saved = {};
let db;

test.beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, { PFA_SMTP_USER: SITE, PFA_SMTP_PASS: 'x', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret', PFA_SUBMISSIONS_INBOX: INBOX });
  delete process.env.PFA_IMAP_USER; delete process.env.PFA_IMAP_PASS;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  mailer._setSmtpTransport(() => ({ async sendMail(m) { return { messageId: m.messageId }; }, close() {} }));
  global.fetch = async () => { throw new Error('no network in tests'); };
  const createdAt = '2026-10-08T05:00:00.000Z';
  await db.collection('submissions').doc(REF).set({
    reference: REF, kind: 'PFA-Q', status: 'new', createdAt, receivedAtMs: Date.parse(createdAt),
    fields: { name: 'Asha Rao', email: PERSON }, history: [{ status: 'new', at: createdAt }], threadId: 'abcdefabcdef'
  });
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  INBOUND._setClient(null);
  INBOUND._setParser(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const filedIds = () => Object.entries(db.dump()).filter(([k, v]) => k.startsWith(`submissions/${REF}/messages/in-`) && v.type === 'reply').map(([, v]) => v.messageId).sort();
const state = () => db.dump()['counters/inboundMail'] || {};

function mailbox(list) {
  return async ({ lastUid }) => {
    const messages = list.filter((m) => m.uid > (Number(lastUid) || 0));
    return { messages, uids: messages.map((m) => m.uid), lastUid: Math.max(Number(lastUid) || 0, ...messages.map((m) => m.uid)), uidValidity: '1', host: 'imap.test' };
  };
}

const reply = (uid, id, text) => ({ uid, from: PERSON, fromName: 'Asha Rao', to: [SITE], cc: [], subject: `Re: ${REF}`, messageId: id, inReplyTo: [CONFIRM_ID], references: [CONFIRM_ID], text, newText: text, date: new Date(), attachments: [] });

test('C3 a reply whose filing threw (a database hiccup) is read again on the next run and filed', async () => {
  /* the first transaction is the reading's own lease (27 Oct 2026); the
     second is the first filing, which is the one that fails here */
  let calls = 0;
  const flaky = Object.assign({}, db, {
    async runTransaction(fn) {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('14 UNAVAILABLE: deadline exceeded'), { code: 14 });
      return db.runTransaction(fn);
    }
  });
  const read = mailbox([reply(7, '<a1@example.com>', 'Here is more detail'), reply(8, '<a2@example.com>', 'And one more')]);
  const opts = { read, inboxes: [INBOX], fieldValue: firebase.fieldValue };
  const run1 = await INBOUND.check(flaky, opts);
  assert.equal(run1.filed, 1);
  assert.equal(run1.problems.length, 1);
  assert.deepEqual([run1.problems[0].uid, run1.problems[0].attempts], [7, 1]);
  assert.equal(state().lastUid, 0, 'the position stays before the message that failed');
  const run2 = await INBOUND.check(flaky, opts);
  assert.equal(run2.fetched, 2, 'read again');
  assert.equal(run2.filed, 1);
  assert.equal(run2.duplicates, 1, 'the one already filed is not filed twice');
  assert.deepEqual(filedIds(), ['<a1@example.com>', '<a2@example.com>'], 'nothing lost');
  assert.equal(state().lastUid, 8);
  assert.deepEqual(state().failing, {}, 'and nothing left waiting');
});

test('C3 a message that keeps failing is set aside after 5 tries, with a problem line, and the reading moves on', async () => {
  const bad = reply(7, '<bad@example.com>', 'x');
  Object.defineProperty(bad, 'attachments', { get() { throw new Error('a part of this email cannot be read'); } });
  const read = mailbox([bad, reply(8, '<ok@example.com>', 'fine')]);
  const opts = { read, inboxes: [INBOX], fieldValue: firebase.fieldValue };
  for (let i = 1; i <= 4; i += 1) {
    const run = await INBOUND.check(db, opts);
    assert.equal(run.problems[0].attempts, i);
    assert.equal(state().lastUid, 0, `run ${i}: still held for another try`);
  }
  const fifth = await INBOUND.check(db, opts);
  assert.equal(fifth.parked, 1);
  assert.equal(fifth.problems[0].parked, true);
  assert.match(fifth.problem, /could not be filed after 5 tries/);
  assert.match(fifth.problem, /<bad@example\.com>/);
  assert.equal(state().lastUid, 8, 'set aside, so the position moves past it');
  assert.equal(state().parked[0].uid, 7);
  const sixth = await INBOUND.check(db, opts);
  assert.equal(sixth.fetched, 0);
  const status = await INBOUND.status(db);
  assert.match(status.problem, /set aside/, 'the panel\'s status shows the problem line');
  assert.equal(status.parked[0].messageId, '<bad@example.com>');
  assert.deepEqual(filedIds(), ['<ok@example.com>']);
});

test('C6 one message that cannot be parsed (or fetched) does not stop the reading: the others are filed, the run succeeds', async () => {
  const raw = (uid) => [
    `From: Asha Rao <${PERSON}>`, `To: ${SITE}`, `Subject: Re: ${REF}`, `Message-ID: <m${uid}@example.com>`,
    `In-Reply-To: ${CONFIRM_ID}`, 'Content-Type: text/plain', '', `Message number ${uid}`, ''
  ].join('\r\n');
  INBOUND._setClient(() => ({
    mailbox: { uidValidity: 1 }, async connect() {}, async logout() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [3, 4, 5, 6]; },
    async fetchOne(uid) {
      if (uid === '6') throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
      return { uid: Number(uid), source: Buffer.from(raw(uid)) };
    }
  }));
  INBOUND._setParser(async (source) => {
    if (/m4@example/.test(String(source))) throw new Error('Unexpected end of multipart data');
    return require('mailparser').simpleParser(source);
  });
  const route = require('../lib/routes/inbound-mail');
  const res = await new Promise((resolve) => {
    const out = {};
    route({ method: 'POST', url: '/api/inbound-mail', query: {}, body: {}, headers: { authorization: 'Bearer cron-secret' } }, {
      set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; },
      setHeader() {}, end(r) { out.json = JSON.parse(r); resolve(out); }
    });
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.json));
  assert.equal(res.json.ok, true, 'the run is not reported as a mailbox failure');
  assert.equal(res.json.filed, 2, 'messages 3 and 5 are filed');
  assert.deepEqual(res.json.problems.map((p) => [p.uid, p.attempts]), [[4, 1], [6, 1]]);
  assert.equal(res.json.problems[0].messageId, '<m4@example.com>', 'the problem names the message');
  assert.equal(state().lastUid, 3, 'held at the first message to be read again');
  assert.deepEqual(filedIds(), ['<m3@example.com>', '<m5@example.com>']);
  for (let i = 2; i <= 5; i += 1) await INBOUND.check(db, { inboxes: [INBOX] });
  assert.equal(state().lastUid, 6, 'both set aside after five runs, and the reading moves on');
  assert.deepEqual(state().parked.map((p) => [p.uid, p.stage]), [[4, 'parse'], [6, 'fetch']]);
});
