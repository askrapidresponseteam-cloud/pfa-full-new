'use strict';

/* Every email back and forth through info@ (owner, 28 Nov 2026: "ensure
   every revert/reply of email is properly sent and received from info@ for
   all queries and responses.. back and forth").

   Before this, a reply to any email that was not about a submission (a card
   posted, an intern's start link, a letter, a birthday card) and any new
   email to info@ was counted as "unmatched" and left in the mailbox, seen by
   no one in the panel and sent on to no one. These tests drive the real
   mailer, the real inbound route and the real panel route, against the
   in-memory Firestore, with GoDaddy's SMTP server stood in for by a stub:

   - every email the site sends a person leaves from info@, and their Reply
     comes to info@;
   - every such reply is kept (Conversations), knows which email it answers,
     and is carried to the right inbox: money to the payments pair only,
     internship to no one (the panel only), anything else to gandhim;
   - staff answer it, from the panel or by replying to the relay, and the
     answer goes from info@, threaded; the person's next reply comes back to
     the same conversation, as many times as it goes back and forth;
   - newsletters, automatic replies and staff's own copies are left alone;
     nothing is filed twice. */

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
        if (token === 'test-admin') return { uid: 'u1', email: 'admin@pfa.test', name: 'Priya' };
        if (token === 'test-staff') return { uid: 'u2', email: 'desk@pfa.test', name: 'Ravi' };
        throw new Error('bad token');
      },
      async getUser(uid) {
        return uid === 'u2'
          ? { uid: 'u2', email: 'desk@pfa.test', displayName: 'Ravi', customClaims: { admin: true, role: 'staff', modules: ['overview', 'submissions'] } }
          : { uid: 'u1', email: 'admin@pfa.test', displayName: 'Priya', customClaims: { admin: true, role: 'super' } };
      }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const MT = require('../lib/mail-thread');
const INBOUND = require('../lib/inbound-mail');
const CONV = require('../lib/mail-conversations');

const INBOX = 'gandhim@exmpls.sansad.in';
const PAY = 'pfadcmho@gmail.com';
const PAY2 = 'ozairhusain@gmail.com';
const SITE_MAILBOX = 'info@peopleforanimalsindia.org';
const PERSON = 'asha.rao@example.com';

const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_IMAP_USER', 'PFA_IMAP_PASS', 'PFA_CAPTURE_REPLIES', 'PFA_MAIL_REPLY_TO',
  'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_ADMIN_TOKEN'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { PFA_SMTP_USER: SITE_MAILBOX, PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret' });
  db = memoryFirestore();
  firebase._setDbForTests(db);
  smtp = { sent: [] };
  mailer._setSmtpTransport(() => ({
    async sendMail(message) { smtp.sent.push(message); return { messageId: message.messageId || '<made-up@pfa>' }; },
    close() {}
  }));
  mailer._setAttachmentLoader(async () => []);
  global.fetch = async () => { throw new Error('Resend must not be used when the mailbox is set up'); };
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  mailer._setAttachmentLoader(null);
  INBOUND._setClient(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const cron = { authorization: 'Bearer cron-secret' };
const admin = { authorization: 'Bearer test-admin' };
const staffOnly = { authorization: 'Bearer test-staff' };
const arrives = (message) => call(require('../lib/routes/inbound-mail'), { body: { message }, headers: cron });
const panel = (o) => call(require('../lib/routes/admin/conversations'), Object.assign({ headers: admin }, o));

const bare = (v) => { const m = /<([^>]+)>/.exec(String(v || '')); return (m ? m[1] : String(v || '')).trim().toLowerCase(); };
const replyToList = (m) => (m.replyTo ? (Array.isArray(m.replyTo) ? m.replyTo : [m.replyTo]) : [bare(m.from)]);
const sentTo = (to) => smtp.sent.filter((m) => [].concat(m.to).map(bare).includes(to));
const last = (to) => sentTo(to)[sentTo(to).length - 1];

/* a mail client's Reply: to the Reply-To list, "Re:" subject, In-Reply-To and References set */
let n = 0;
function reply(message, { from = PERSON, name = 'Asha Rao', text } = {}) {
  n += 1;
  return {
    from: `${name} <${from}>`, to: replyToList(message),
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    messageId: `<R${n}.${Date.now().toString(36)}@example.com>`,
    inReplyTo: message.messageId,
    references: MT.idsIn(message.references || '').concat(MT.idsIn(message.messageId || '')).join(' '),
    date: new Date().toISOString(),
    text: `${text}\n\nOn Wed, 28 Nov 2026, People for Animals <${SITE_MAILBOX}> wrote:\n> earlier`
  };
}

/* the wording test's own cases: every email the site can send, with a payload */
function cases() {
  const src = fs.readFileSync(path.join(__dirname, 'email-wording.test.js'), 'utf8');
  const head = src.slice(src.indexOf('const site ='), src.indexOf('const CASES = {'));
  const i = src.indexOf('const CASES = {');
  let d = 0; let j = i + 'const CASES = '.length;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) { j++; break; } } }
  // eslint-disable-next-line no-new-func
  return new Function(head.replace(/\bconst /g, 'var ') + 'return ' + src.slice(i + 'const CASES = '.length, j))();
}

const conversations = () => Object.entries(db.dump()).filter(([k]) => /^mailConversations\/[^/]+$/.test(k)).map(([k, v]) => Object.assign({ id: k.split('/')[1] }, v));
const messagesIn = (id) => Object.entries(db.dump()).filter(([k]) => k.startsWith(`mailConversations/${id}/messages/`)).map(([, v]) => v).sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));

/* ---- every email to a person, answered ---------------------------------- */

test('every email the site sends a person goes from info@, their Reply comes to info@, is kept with what it answers, and goes to the right inbox', async () => {
  const all = cases();
  const people = Object.entries(all).filter(([, [, who]]) => who === 'person');
  assert.ok(people.length >= 30, `the wording test lists the emails (${people.length})`);
  const seen = [];
  for (const [name, [template, , payload]] of people) {
    smtp.sent = [];
    try { await mailer.deliver({ to: PERSON, template, payload }); } catch (error) { assert.fail(`${name}: ${error.message}`); }
    const out = last(PERSON);
    assert.ok(out, `${name}: sent`);
    assert.equal(bare(out.from), SITE_MAILBOX, `${name}: from info@`);
    assert.ok(replyToList(out).map(bare).includes(SITE_MAILBOX), `${name}: a Reply reaches info@ (${replyToList(out)})`);
    assert.ok(out.messageId, `${name}: carries a Message-ID`);
    const ledger = await CONV.lookup(db, [out.messageId]);
    assert.ok(ledger && ledger.sent, `${name}: written in the ledger`);
    assert.equal(ledger.sent.template, template);

    smtp.sent = [];
    const r = await arrives(reply(out, { text: `About ${name}: thank you, one question.` }));
    assert.equal(r.statusCode, 200, r.raw.slice(0, 200));
    assert.equal(r.json.filed, true, `${name}: their reply is filed (${r.raw.slice(0, 200)})`);
    /* none of these has a submission in this database, so all are conversations */
    assert.match(String(r.json.conversation), /^MC-[a-f0-9]{12}$/, `${name}: kept as a conversation`);
    const c = conversations().find((x) => x.id === r.json.conversation);
    assert.equal(c.answers.template, template, `${name}: knows what it answers`);
    assert.equal(c.person.email, PERSON);
    assert.equal(c.needsAnswer, true);

    const relays = smtp.sent.filter((m) => /wrote to PFA/.test(String(m.text || '')));
    const to = relays.map((m) => bare(m.to)).sort();
    if (ledger.sent.money) assert.deepEqual(to, [PAY2, PAY].sort(), `${name}: money goes to the payments pair only`);
    else if (/^intern(ship)?_/.test(template) || template === 'staff_invite') assert.deepEqual(to, [], `${name}: the internship, and an invitation to the panel, stay in the panel`);
    else assert.deepEqual(to, [INBOX], `${name}: carried to gandhim`);
    for (const m of relays) {
      assert.equal(bare(m.from), SITE_MAILBOX);
      assert.deepEqual(replyToList(m).map(bare), [SITE_MAILBOX], 'staff answering the relay answer through info@');
      assert.match(m.text, /thank you, one question/);
    }
    seen.push(template);
  }
  assert.ok(seen.includes('card_posted') && seen.includes('intern_start') && seen.includes('birthday_greeting'));
});

/* ---- the whole back and forth ------------------------------------------- */

test('back and forth: person, gandhim by email, person again, the panel, closed, and reopened when they write again, every step through info@ and threaded', async () => {
  const all = cases();
  const [template, , payload] = all.card_posted || Object.values(all).find(([t]) => t === 'card_posted');
  await mailer.deliver({ to: PERSON, template, payload });
  const first = last(PERSON);

  /* 1. the person replies */
  smtp.sent = [];
  const r1 = await arrives(reply(first, { text: 'The card has not reached me yet.' }));
  const id = r1.json.conversation;
  const relay = last(INBOX);
  assert.ok(relay, 'carried to gandhim');
  assert.match(relay.subject, /^Re: .*\(about: Colony caregiver card posted\)$/);
  assert.match(relay.messageId, /^<PFA-MAIL-[A-F0-9]{12}\.[a-f0-9]{12}\.relay\.1@peopleforanimalsindia\.org>$/);

  /* 2. gandhim presses Reply on the relay: it goes to the person from info@, threaded under their message */
  smtp.sent = [];
  const personMsg = messagesIn(id).find((m) => m.direction === 'in');
  const r2 = await arrives(reply(relay, { from: INBOX, name: 'Gandhi M', text: 'It was posted on Monday, tracking EK123456789IN.' }));
  assert.equal(r2.json.filed, true);
  assert.equal(r2.json.conversation, id, 'the same conversation');
  const toPerson = last(PERSON);
  assert.ok(toPerson, 'sent on to the person');
  assert.equal(bare(toPerson.from), SITE_MAILBOX, 'from info@, never from gandhim');
  assert.deepEqual(replyToList(toPerson).map(bare), [SITE_MAILBOX]);
  assert.match(toPerson.text, /tracking EK123456789IN/);
  assert.doesNotMatch(toPerson.text, /wrote:/, 'only what she wrote, not the quoted thread');
  assert.equal(toPerson.inReplyTo, personMsg.messageId, 'threaded under what they wrote');
  assert.ok(String(toPerson.references).includes(personMsg.messageId));
  assert.equal(toPerson.subject, `Re: ${first.subject.replace(/^re:\s*/i, '')}`);
  assert.equal(sentTo(INBOX).length, 0, 'gandhim is not sent her own words back');

  /* 3. the person replies to that answer: the same conversation, carried to gandhim again */
  smtp.sent = [];
  const r3 = await arrives(reply(toPerson, { text: 'Thank you, it arrived today.' }));
  assert.equal(r3.json.conversation, id);
  assert.match(last(INBOX).messageId, /\.relay\.2@/);

  /* 4. the panel answers */
  smtp.sent = [];
  const list = await panel({ method: 'GET', query: {} });
  assert.equal(list.statusCode, 200, list.raw.slice(0, 200));
  assert.equal(list.json.counts.waiting, 1);
  const row = list.json.conversations.find((c) => c.id === id);
  assert.ok(row && row.needsAnswer);
  assert.equal(row.answers.label, 'Colony caregiver card posted');
  const one = await panel({ method: 'GET', query: { id } });
  assert.equal(one.json.messages.length, 4, 'their two, gandhim\'s, and the answer that went from info@');
  const a = await panel({ body: { action: 'answer', id, text: 'Glad it reached you. Thank you for caring for the colony.' } });
  assert.equal(a.statusCode, 200, a.raw.slice(0, 200));
  assert.equal(a.json.state, 'sent');
  const fromPanel = last(PERSON);
  assert.equal(bare(fromPanel.from), SITE_MAILBOX);
  assert.match(fromPanel.text, /Dear Asha/);
  assert.match(fromPanel.text, /Priya, People for Animals/);
  const theirLast = messagesIn(id).filter((m) => m.direction === 'in' && m.party === 'person').pop();
  assert.equal(fromPanel.inReplyTo, theirLast.messageId, 'answers their latest message');
  assert.equal(fromPanel.headers && fromPanel.headers['Auto-Submitted'], undefined, 'typed by a person, so not marked automatic');

  /* 5. closed, then they write again: open and waiting */
  const closed = await panel({ body: { action: 'close', id } });
  assert.equal(closed.json.state, 'closed');
  assert.equal((await panel({ method: 'GET', query: {} })).json.conversations.length, 0);
  const r5 = await arrives(reply(fromPanel, { text: 'One more thing, can I get a second card?' }));
  assert.equal(r5.json.conversation, id);
  const back = (await panel({ method: 'GET', query: {} })).json;
  assert.equal(back.counts.waiting, 1);
  assert.equal(back.conversations[0].state, 'open');

  /* nothing twice: the same email arriving again is one message */
  const again = await arrives(reply(fromPanel, { text: 'x' }));
  const before = messagesIn(id).length;
  const dup = await arrives(Object.assign({}, { from: `Asha Rao <${PERSON}>`, to: [SITE_MAILBOX], subject: 'dup', messageId: again.json && messagesIn(id).pop().messageId, text: 'x', inReplyTo: fromPanel.messageId }));
  assert.equal(dup.json.reason, 'DUPLICATE');
  assert.equal(messagesIn(id).length, before);
});

/* ---- a new email to info@ ----------------------------------------------- */

test('a new email to info@ is a query in the panel, answered from info@, and the answer to the answer comes back to it', async () => {
  smtp.sent = [];
  const fresh = { from: 'Meera Iyer <meera@example.org>', to: [SITE_MAILBOX], subject: 'Injured cow near our school', messageId: '<new1@example.org>', date: new Date().toISOString(), text: 'There is a cow with a wound on her leg near DPS. Who do we call?' };
  const r = await arrives(fresh);
  assert.equal(r.json.filed, true);
  assert.equal(r.json.how, 'new');
  assert.equal(smtp.sent.length, 0, 'a new email is not sent on to gandhim: it waits in the panel');
  const id = r.json.conversation;
  const a = await panel({ body: { action: 'answer', id, text: 'Please call the PFA ambulance on the number on our help page.' } });
  assert.equal(a.json.state, 'sent');
  const out = last('meera@example.org');
  assert.equal(bare(out.from), SITE_MAILBOX);
  assert.equal(out.subject, 'Re: Injured cow near our school');
  assert.equal(out.inReplyTo, '<new1@example.org>');
  assert.match(out.messageId, /^<PFA-MAIL-[A-F0-9]{12}\.[a-f0-9]{12}\.reply\.1@/);

  /* their reply, even from a mail client that keeps only In-Reply-To */
  const back = await arrives({ from: 'Meera Iyer <meera@example.org>', to: [SITE_MAILBOX], subject: 'Re: Injured cow near our school', messageId: '<new2@example.org>', inReplyTo: out.messageId, date: new Date().toISOString(), text: 'Called, they are coming. Thank you!' });
  assert.equal(back.json.conversation, id, 'back in the same conversation');
  /* and one that keeps only References, with an id the site never sent */
  const back2 = await arrives({ from: 'Meera Iyer <meera@example.org>', to: [SITE_MAILBOX], subject: 'Re: Injured cow near our school', messageId: '<new3@example.org>', references: '<new1@example.org> <unknown@elsewhere>', date: new Date().toISOString(), text: 'The cow is in the shelter now.' });
  assert.equal(back2.json.conversation, id);
  const c = (await panel({ method: 'GET', query: { id } })).json;
  assert.equal(c.messages.length, 4);
  assert.equal(c.conversation.needsAnswer, true);
});

/* ---- what is left alone -------------------------------------------------- */

test('newsletters, automatic replies, no-reply senders and staff copies are not made into queries', async () => {
  const at = new Date().toISOString();
  const news = await arrives({ from: 'news@example.com', to: [SITE_MAILBOX], subject: 'Weekly offers', messageId: '<n1@example.com>', date: at, text: 'Sale', headers: { 'List-Unsubscribe': '<mailto:o@example.com>' } });
  assert.equal(news.json.filed, false);
  const auto = await arrives({ from: 'someone@example.com', to: [SITE_MAILBOX], subject: 'Out of office', messageId: '<n2@example.com>', date: at, text: 'Away', headers: { 'Auto-Submitted': 'auto-replied' } });
  assert.equal(auto.json.filed, false);
  const robot = await arrives({ from: 'no-reply@bank.example', to: [SITE_MAILBOX], subject: 'Statement', messageId: '<n3@bank.example>', date: at, text: 'Your statement' });
  assert.equal(robot.json.filed, false);
  const staffCopy = await arrives({ from: `Gandhi M <${INBOX}>`, to: [SITE_MAILBOX, 'x@example.com'], subject: 'FYI', messageId: '<n4@mail.sansad.in>', date: at, text: 'Copying info@' });
  assert.equal(staffCopy.json.filed, false);
  assert.equal(conversations().length, 0);
});

test('an automatic reply to a site email is kept on the conversation but asks for nothing and goes to no one', async () => {
  await mailer.deliver({ to: PERSON, template: 'birthday_greeting', payload: { name: 'Asha Rao', siteUrl: 'https://pfa.test' } });
  const out = last(PERSON);
  smtp.sent = [];
  const ooo = Object.assign(reply(out, { text: 'I am away until Monday.' }), { headers: { 'Auto-Submitted': 'auto-replied' } });
  const r = await arrives(ooo);
  assert.equal(r.json.filed, true);
  assert.equal(r.json.auto, true);
  assert.equal(smtp.sent.length, 0);
  assert.equal(conversations()[0].needsAnswer, false);
});

/* ---- money stays with those who see money -------------------------------- */

test('a reply about money: only the payments pair get it, and staff without Payments do not see it in the panel', async () => {
  const all = cases();
  const money = Object.entries(all).find(([, [t, who, p]]) => who === 'person' && require('../lib/caregiver-mail').TEMPLATES[t] && (() => { try { return /receipt|payment|donation/i.test(t); } catch (_) { return false; } })());
  assert.ok(money, 'a money email in the wording cases');
  const [template, , payload] = money[1];
  await mailer.deliver({ to: PERSON, template, payload });
  const out = last(PERSON);
  const ledger = await CONV.lookup(db, [out.messageId]);
  assert.equal(ledger.sent.money, true, `${template} is about money`);
  smtp.sent = [];
  const r = await arrives(reply(out, { text: 'Can I have the receipt in my company name?' }));
  assert.equal(r.json.filed, true);
  assert.deepEqual(smtp.sent.map((m) => bare(m.to)).sort(), [PAY2, PAY].sort());
  assert.equal(sentTo(INBOX).length, 0, 'never gandhim');

  const desk = await call(require('../lib/routes/admin/conversations'), { method: 'GET', query: {}, headers: staffOnly });
  assert.equal(desk.statusCode, 200, desk.raw.slice(0, 200));
  assert.equal(desk.json.conversations.length, 0, 'not shown without Payments');
  const peek = await call(require('../lib/routes/admin/conversations'), { method: 'GET', query: { id: r.json.conversation }, headers: staffOnly });
  assert.equal(peek.statusCode, 404);
  const boss = await panel({ method: 'GET', query: {} });
  assert.equal(boss.json.conversations.length, 1);
});

/* ---- the panel route itself ---------------------------------------------- */

test('the panel route needs a signed-in administrator and refuses an empty answer', async () => {
  const anon = await call(require('../lib/routes/admin/conversations'), { method: 'GET', query: {} });
  assert.equal(anon.statusCode, 401);
  const r = await arrives({ from: 'a@example.org', to: [SITE_MAILBOX], subject: 'Hello', messageId: '<h1@example.org>', date: new Date().toISOString(), text: 'Hi' });
  const empty = await panel({ body: { action: 'answer', id: r.json.conversation, text: ' ' } });
  assert.equal(empty.statusCode, 422);
  const missing = await panel({ body: { action: 'answer', id: 'MC-000000000000', text: 'Hello there' } });
  assert.equal(missing.statusCode, 404);
  const routes = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  assert.match(routes, /'admin\/conversations': '\.\/admin\/conversations\.js'/);
  assert.match(routes, /'admin\/conversations': \(\) => require\('\.\.\/lib\/routes\/admin\/conversations\.js'\)/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(page, /id="conversations"/);
  assert.match(page, /assets\/admin-conversations\.js/);
});
