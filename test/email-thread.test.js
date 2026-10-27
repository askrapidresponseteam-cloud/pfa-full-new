'use strict';

/* One conversation per submission, both ways, through PFA's own mailbox.

   Owner, 7 Oct 2026: Person A submits; gandhim@exmpls.sansad.in gets the
   email from info@peopleforanimalsindia.org; Madam presses Reply; her reply
   reaches Person A and is filed on the same record in the admin panel;
   nothing is filed twice and no second record appears.

   13 Oct 2026, how her reply reaches them changed. It used to go straight
   from her mailbox to theirs, because Reply-To named Person A with info@
   added after them. From that first reply the conversation belonged to two
   mailboxes the site does not read, and info@ stayed in it only while every
   person on every message kept a recipient they had not added. Owner: "if I
   reply to gandhim without reply all.. things will go missing." They did.

   Now Reply-To is the site and nothing else. Her reply arrives here, is
   filed, and is carried on to Person A as info@; their answer is addressed
   here too. Every message passes through this mailbox because there is no
   other path, Reply All stops mattering, and her answer reaches them from
   info@ rather than from a personal mailbox, which was the other half of
   the ask. The tests below hold both ends of that.

   Everything below drives the real routes against the in-memory Firestore
   and the real mailer, with GoDaddy's SMTP server stood in for by a stub
   that keeps each message as nodemailer would send it (headers included),
   and the mailbox stood in for by the webhook form of /api/inbound-mail or
   a stub IMAP client handing the real parser a raw email. Madam's mail
   client is simulated the way Gmail and Outlook behave: Reply puts every
   Reply-To address in To, keeps the subject with "Re:", and sets
   In-Reply-To and References to the Message-ID being answered. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', displayName: 'Priya', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mailer = require('../lib/caregiver-mail');
const MT = require('../lib/mail-thread');
const INBOUND = require('../lib/inbound-mail');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');
const { PLACE } = require('./_place');

const ROOT = path.join(__dirname, '..');
const INBOX = 'gandhim@exmpls.sansad.in';
/* A record of money goes to the payments pair and never to gandhim (owner,
   21 Oct 2026). A caregiver application is a form: gandhim gets it, and the
   pair get only the receipt for its fee (owner, 23 Oct 2026). */
const PAY = 'pfadcmho@gmail.com';
const PAY2 = 'ozairhusain@gmail.com';
const SITE_MAILBOX = 'info@peopleforanimalsindia.org';
const PERSON_A = 'asha.rao@example.com';
const WORKING_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const PHOTO = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg')).toString('base64');
const PHOTO_BYTES = fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg'));

const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_MAIL_API_KEY', 'PFA_IMAP_USER', 'PFA_IMAP_PASS', 'PFA_CAPTURE_REPLIES',
  'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PFA_SHOP_ORDERS_EMAIL', 'PUBLIC_SITE_URL', 'CRON_SECRET', 'PFA_ADMIN_TOKEN',
  'CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'PFA_SHOP_FIREBASE_SERVICE_ACCOUNT'];
const saved = {};
let db;
let smtp;

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, {
    PFA_SMTP_USER: SITE_MAILBOX, PFA_SMTP_PASS: 'test-password', PUBLIC_SITE_URL: 'https://pfa.test', CRON_SECRET: 'cron-secret',
    CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: WORKING_KEY, CCAVENUE_MODE: 'test'
  });
  for (const k of ['PFA_MAIL_API_KEY', 'PFA_SMTP_HOST', 'PFA_IMAP_USER', 'PFA_IMAP_PASS', 'PFA_CAPTURE_REPLIES', 'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PFA_SHOP_ORDERS_EMAIL', 'PFA_ADMIN_TOKEN', 'PFA_SHOP_FIREBASE_SERVICE_ACCOUNT']) delete process.env[k];
  db = memoryFirestore();
  firebase._setDbForTests(db);
  require('../lib/routes/admin/records.js')._resetHeal();
  smtp = { sent: [] };
  mailer._setSmtpTransport(() => ({
    async sendMail(message) { smtp.sent.push(message); return { messageId: message.messageId || '<made-up@pfa>' }; },
    close() {}
  }));
  global.fetch = async () => { throw new Error('Resend must not be used when the mailbox is set up'); };
});

test.afterEach(() => {
  mailer._setSmtpTransport(null);
  INBOUND._setClient(null);
  INBOUND._setParser(null);
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/* ---- the harness ------------------------------------------------------- */

function call(handler, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const admin = { authorization: 'Bearer test-admin' };
const cron = { authorization: 'Bearer cron-secret' };

const submit = (kind, data, page, extra = {}) => call(require('../lib/routes/pfa-submissions'), {
  body: Object.assign({ kind, data, page, clientRequestId: 'req-' + kind + '-' + Math.random() }, extra)
});

async function pay(form) {
  const handoff = await call(require('../lib/routes/payment/create'), { body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(handoff.statusCode, 200, handoff.raw.slice(0, 300));
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(handoff.raw);
  assert.ok(enc, 'handed to CCAvenue');
  const out = decodeMerchantData(decrypt(enc[1], WORKING_KEY));
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI', status_message: '' };
  const back = await call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), WORKING_KEY) }, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(back.statusCode, 200, back.raw.slice(0, 300));
  return back.raw;
}

const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: PERSON_A, address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };

const inboxCopies = (to = INBOX) => smtp.sent.filter((m) => m.to === to);
const lastInboxCopy = (to = INBOX) => inboxCopies(to)[inboxCopies(to).length - 1];
const toPersonA = () => smtp.sent.filter((m) => m.to === PERSON_A);
/* where a mail client's Reply goes: the Reply-To list, or the From address */
const bare = (v) => { const m = /<([^>]+)>/.exec(String(v || '')); return (m ? m[1] : String(v || '')).trim().toLowerCase(); };
const replyToList = (m) => (m.replyTo ? (Array.isArray(m.replyTo) ? m.replyTo : [m.replyTo]) : [bare(m.from)]);
const records = () => Object.keys(db.dump()).filter((k) => /^submissions\/[^/]+$/.test(k));
const messagesOf = (ref) => Object.entries(db.dump()).filter(([k]) => k.startsWith(`submissions/${ref}/messages/`)).map(([, v]) => v).sort((a, b) => String(a.at).localeCompare(String(b.at)));

/* Madam's mail client. Reply: To is the Reply-To list, the subject keeps
   its own with "Re:", In-Reply-To and References name the message. */
let counter = 0;
function replyTo(message, { from = INBOX, name = 'Gandhi M', text, attachments, all = false, cc } = {}) {
  counter += 1;
  const refs = MT.idsIn(message.references || '').concat(MT.idsIn(message.messageId || ''));
  return {
    from: `${name} <${from}>`,
    to: all ? [].concat(message.from, replyToList(message)).filter(Boolean) : replyToList(message),
    cc: cc || [],
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    messageId: `<CAK${counter}${Date.now().toString(36)}@mail.sansad.in>`,
    inReplyTo: message.messageId,
    references: refs.join(' '),
    date: new Date().toISOString(),
    text: `${text}\n\nOn Wed, 7 Oct 2026 at 10:00, People for Animals <${SITE_MAILBOX}> wrote:\n> ${String(message.text || '').split('\n')[0]}`,
    attachments: attachments || []
  };
}

/* The site's mailbox receives what was addressed to it. */
const arrives = (message) => call(require('../lib/routes/inbound-mail'), { body: { message }, headers: cron });

async function caseOf(ref) {
  const res = await call(require('../lib/routes/admin/case'), { method: 'GET', query: { reference: ref }, headers: admin });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  return res.json.case;
}

/* ---- 1 to 9: a caregiver application, both ways ------------------------- */

test('a paid caregiver application: gandhim gets the application from info@ with its photograph and not a word about money, the payments inboxes get the receipt, Reply-To is the site alone, and a thread id is on the record', async () => {
  /* owner, 23 Oct 2026: "hope all caregiver application goes to gandhim,
     ensure it does. payment receipt to go to others. but application should
     go to gandhim email ID pls." */
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO } });
  assert.equal(docs.statusCode, 200, docs.raw.slice(0, 300));
  const page = await pay(Object.assign({ type: 'caregiver-application', documents: docs.json.token, animals: '12', notes: 'Feeding them for four years.' }, PERSON));
  const ref = (page.match(/PFA-CG-\d{4}-\d{5}/) || [])[0];
  assert.ok(ref, 'the applicant is shown their number');

  const record = db.dump()['submissions/' + ref];
  assert.ok(MT.isThreadId(record.threadId), 'the record carries a thread id');
  assert.equal(record.threadSubject, 'Your caregiver card application is in - ' + ref);
  const orderId = record.payment.orderId;
  assert.ok(orderId);

  /* the application, to gandhim */
  assert.equal(inboxCopies(INBOX).length, 1, 'gandhim gets the application, once');
  const copy = lastInboxCopy(INBOX);
  assert.equal(copy.from, 'People for Animals <info@peopleforanimalsindia.org>', 'sent as info@');
  assert.equal(copy.subject, `${ref}: Colony caregiver application from Asha Rao`);
  assert.deepEqual(replyToList(copy), [SITE_MAILBOX],
    'Reply-To is the site and nothing else: a second address is a second path, and the path that skips the site is the one that loses the conversation');
  assert.ok(!replyToList(copy).includes(PERSON_A),
    'Person A is not addressed directly, so no Reply can take the conversation out of the record');
  assert.equal(copy.messageId, `<${ref}.${record.threadId}.forward@peopleforanimalsindia.org>`, 'Message-ID names the submission and the thread');
  assert.equal(copy.attachments.length, 1, 'the photograph is attached');
  for (const words of [copy.text, copy.html]) {
    assert.match(words, /16 MG Road, Lajpat Nagar/, 'the application is all there');
    assert.match(words, /Feeding them for four years/);
    assert.doesNotMatch(words, /₹|&#8377;|Amount|Order ID|tracking ID|Bank reference|BNK900|31233|Payment for/i, 'not a word about the money');
    assert.ok(!words.includes(orderId), 'not even the order number');
  }

  /* the receipt, to the payments inboxes */
  for (const to of [PAY, PAY2]) {
    assert.equal(inboxCopies(to).length, 1, `${to} gets the receipt, once`);
    const receipt = lastInboxCopy(to);
    assert.equal(receipt.subject, `${ref}: Payment for a colony caregiver application from Asha Rao`);
    assert.equal(receipt.from, 'People for Animals <info@peopleforanimalsindia.org>');
    assert.deepEqual(replyToList(receipt), [SITE_MAILBOX]);
    assert.equal((receipt.attachments || []).length, 0, 'a receipt: the photograph goes with the application');
    assert.match(receipt.text, /Amount paid: ₹\d/);
    assert.ok(receipt.text.includes(`Order ID: ${orderId}`));
    assert.match(receipt.text, /CCAvenue tracking ID: 31233/);
    assert.match(receipt.text, /Bank reference: BNK900/);
    assert.match(receipt.text, /The application: Sent separately to gandhim@exmpls\.sansad\.in/);
    assert.doesNotMatch(receipt.text, /16 MG Road|Feeding them/, 'the application itself is not in it');
  }

  const letter = toPersonA().find((m) => /caregiver card application is in/.test(m.subject));
  assert.ok(letter, 'Person A gets the letter');
  assert.equal(letter.messageId, `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);
  assert.equal(letter.subject, record.threadSubject);

  const thread = messagesOf(ref);
  assert.equal(thread.length, 3, 'each copy logged: the application to gandhim, the receipt to each payments inbox');
  assert.ok(thread.every((m) => m.type === 'email' && m.messageId === copy.messageId));
  assert.deepEqual(thread.map((m) => m.to), [INBOX, PAY, PAY2]);
  assert.match(thread[0].text, /application sent to PFA's inbox, without the payment/);
  assert.match(thread[1].text, /Receipt for the payment/);
  assert.match(thread[1].subject, /Payment for a colony caregiver application/);
});

test('Madam presses Reply: it goes to the site, is filed on the same record, and is carried on to Person A as info@', async () => {
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO } });
  const page = await pay(Object.assign({ type: 'caregiver-application', documents: docs.json.token, animals: '3' }, PERSON));
  const ref = (page.match(/PFA-CG-\d{4}-\d{5}/) || [])[0];
  const before = records();
  const copy = lastInboxCopy(INBOX);

  const reply = replyTo(copy, { text: 'Thank you Asha. Please send a photograph of the feeding spot.' });
  assert.deepEqual(reply.to, [SITE_MAILBOX],
    'a plain Reply goes to the site: nothing to remember, nothing to drop, no Reply All');

  const filed = await arrives(reply);
  assert.equal(filed.statusCode, 200, filed.raw.slice(0, 300));
  assert.equal(filed.json.filed, true);
  assert.equal(filed.json.reference, ref, 'filed on the existing record');
  assert.equal(filed.json.party, 'staff');
  assert.equal(filed.json.how, 'headers', 'matched by the threading headers, not by names');

  assert.deepEqual(records(), before, 'no new submission, person or case');
  const record = db.dump()['submissions/' + ref];
  /* A caregiver application has its own stages (lib/submissions.js STAGES);
     answered, it is under review, not the generic "in progress" (8 Oct 2026). */
  assert.equal(record.status, 'under-review', 'a case answered is a case taken up, into its own kind\'s stage');
  assert.equal(record.replyCount, 1);
  const thread = messagesOf(ref);
  assert.equal(thread.length, 5, 'the three copies out (the application, two receipts), her reply in, and the note that it was carried on');
  const m = thread.find((x) => x.party === 'staff');
  assert.ok(m, 'her reply is on the record');
  assert.equal(m.type, 'reply');
  assert.equal(m.direction, 'in');
  assert.equal(m.from, INBOX);
  assert.deepEqual(m.to, [SITE_MAILBOX]);
  assert.equal(m.text, 'Thank you Asha. Please send a photograph of the feeding spot.', 'the new text, without the quoted copy');
  assert.match(m.fullText, /wrote:/, 'the whole email is kept too');
  assert.equal(m.messageId, reply.messageId);
  assert.deepEqual(m.inReplyTo, [copy.messageId]);

  /* the same email read again is one message */
  const again = await arrives(reply);
  assert.equal(again.json.filed, false);
  assert.equal(again.json.reason, 'DUPLICATE');
  assert.equal(messagesOf(ref).length, 5);
  assert.equal(db.dump()['submissions/' + ref].replyCount, 1);

  /* and it is carried on to Person A: the half that did not exist before.
     Asserted after the duplicate above, so this also proves a second reading
     of the same email does not send it to them twice. */
  assert.equal(filed.json.answered, 'sent', 'her reply was carried on');
  assert.equal(filed.json.answeredTo, PERSON_A);
  assert.equal(inboxCopies(INBOX).length, 1, 'nothing went back to the inbox');
  assert.equal(inboxCopies(PAY).length, 1, 'and nothing more to the payments inboxes');
  const carried = toPersonA().filter((x) => /^Re:/.test(x.subject));
  assert.equal(carried.length, 1, 'exactly one, however often the email is read again');
  assert.equal(carried[0].from, 'People for Animals <info@peopleforanimalsindia.org>',
    'it reaches them as info@, not from a personal mailbox');
  assert.match(carried[0].text, /photograph of the feeding spot/, 'carrying what Madam wrote');
  assert.deepEqual(replyToList(carried[0]), [SITE_MAILBOX], 'and their answer comes back here too');

  const c = await caseOf(ref);
  assert.equal(c.messages.length, 5);
  assert.equal(c.messages.filter((x) => x.party === 'staff').length, 1);
  assert.equal(c.replyCount, 1);
});

test('the conversation goes on: Madam again, Person A back with a plain Reply, Madam again; one thread, in order, nothing lost', async () => {
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO } });
  const page = await pay(Object.assign({ type: 'caregiver-application', documents: docs.json.token, animals: '3' }, PERSON));
  const ref = (page.match(/PFA-CG-\d{4}-\d{5}/) || [])[0];
  const record = db.dump()['submissions/' + ref];
  const copy = lastInboxCopy(INBOX);

  const first = replyTo(copy, { text: 'Please send a photograph.' });
  assert.equal((await arrives(first)).json.filed, true);
  const second = replyTo(copy, { text: 'Also, which pincode?' });
  assert.equal((await arrives(second)).json.filed, true);

  /* Both of Madam's replies reached Person A, as info@ */
  const carried = toPersonA().filter((x) => /^Re:/.test(x.subject));
  assert.equal(carried.length, 2, 'each of her replies was carried on');
  assert.match(carried[0].text, /send a photograph/);
  assert.match(carried[1].text, /which pincode/);

  /* Person A answers what PFA actually sent them, with a plain Reply. This is
     the case that used to lose the conversation: before 13 Oct it needed
     Reply All, because the email they were answering came from Madam's own
     mailbox and only carried info@ as a second address. Now the address they
     are answering is the site's, so there is nothing to remember. */
  const fromA = replyTo(carried[1], { from: PERSON_A, name: 'Asha Rao', text: 'Pincode 110024. Photo attached.', attachments: [{ filename: 'spot.jpg', contentType: 'image/jpeg', content: PHOTO_BYTES.toString('base64') }] });
  assert.deepEqual(fromA.to, [SITE_MAILBOX], 'a plain Reply, to the site, with no Reply All anywhere');
  const filedA = await arrives(fromA);
  assert.equal(filedA.json.filed, true, filedA.raw);
  assert.equal(filedA.json.reference, ref, 'filed on the same record');
  assert.equal(filedA.json.party, 'sender');
  assert.equal(filedA.json.attachments, 1);
  assert.deepEqual(filedA.json.relayed, ['sent'], 'relayed to gandhim, where the application is');

  const relay = lastInboxCopy(INBOX);
  assert.equal(inboxCopies(PAY).length, 1, 'the payments inboxes had their receipt, and nothing more');
  assert.equal(inboxCopies(PAY2).length, 1);
  assert.match(relay.subject, new RegExp('^Re: ' + ref + ': Colony caregiver application from Asha Rao$'));
  assert.equal(relay.inReplyTo, copy.messageId, 'in the same conversation as the copy');
  assert.ok(MT.idsIn(relay.references).includes(copy.messageId));
  assert.equal(relay.messageId, `<${ref}.${record.threadId}.relay.3@peopleforanimalsindia.org>`);
  assert.deepEqual(replyToList(relay), [SITE_MAILBOX], 'and a Reply to it comes back here, not to Person A directly');
  assert.match(relay.text, /Pincode 110024/);
  assert.equal(relay.attachments.length, 1, 'with the photograph Person A sent');

  /* Madam answers the relay */
  const third = replyTo(relay, { text: 'Got it, thank you.' });
  assert.equal((await arrives(third)).json.filed, true);

  const thread = messagesOf(ref);
  const kinds = thread.map((m) => `${m.type}:${m.direction}:${m.party}`);
  assert.deepEqual(kinds, [
    'email:out:site',    /* the application, to gandhim */
    'email:out:site',    /* the receipt, to the first payments inbox */
    'email:out:site',    /* and to the second */
    'reply:in:staff',    /* Madam: please send a photograph */
    'email:out:site',    /* carried on to Person A as info@ */
    'reply:in:staff',    /* Madam: which pincode */
    'email:out:site',    /* carried on */
    'reply:in:sender',   /* Person A, a plain Reply, with the photograph */
    'email:out:site',    /* relayed to gandhim */
    'reply:in:staff',    /* Madam: got it, thank you */
    'email:out:site'     /* carried on */
  ], 'the whole exchange, oldest first, with every leg of it on the record');
  assert.equal(records().filter((k) => k.startsWith('submissions/PFA-CG')).length, 1, 'still one record');
  assert.equal(db.dump()['submissions/' + ref].replyCount, 4);

  /* the attachment is kept beside the submission's own photograph, and the panel can read it */
  const stored = thread.find((m) => m.party === 'sender').files[0];
  assert.equal(stored.stored, true);
  assert.match(stored.id, /^in-[a-f0-9]{24}-1$/);
  const att = await call(require('../lib/routes/admin/attachment'), { method: 'GET', query: { reference: ref, n: stored.id }, headers: admin });
  assert.equal(att.statusCode, 200, att.raw.slice(0, 200));
  assert.equal(att.json.contentType, 'image/jpeg');
  assert.equal(att.json.label, 'spot.jpg');
  assert.equal(Buffer.from(att.json.data, 'base64').length, PHOTO_BYTES.length);
});

/* ---- 4: nothing is matched on a name, an address or a subject alone ------ */

test('two submissions from the same person: each reply lands on the one it answers; a guessed or headerless email is not filed', async () => {
  const a = await submit('PFA-Q', { question: 'Is there a vet near Lajpat Nagar?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, 'ask.html');
  const b = await submit('PFA-Q', { question: 'Can I foster a kitten?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, 'ask.html');
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  const [copyA, copyB] = inboxCopies();
  assert.notEqual(copyA.messageId, copyB.messageId);

  const r = await arrives(replyTo(copyB, { text: 'Yes, fostering is open.' }));
  assert.equal(r.json.reference, b.json.reference, 'the second question, which it answers');
  assert.equal(messagesOf(a.json.reference).filter((m) => m.type === 'reply').length, 0);
  assert.equal(messagesOf(b.json.reference).filter((m) => m.type === 'reply').length, 1);

  /* right reference, wrong thread id: refused */
  const forged = replyTo(copyA, { text: 'Forged.' });
  forged.inReplyTo = `<${a.json.reference}.000000000000.forward@peopleforanimalsindia.org>`;
  forged.references = forged.inReplyTo;
  const f = await arrives(forged);
  assert.equal(f.json.filed, false);
  assert.equal(f.json.reason, 'NO_THREAD');

  /* no headers at all and a stranger's address: the reference in the subject is not enough */
  const stranger = { from: 'someone@example.net', to: [SITE_MAILBOX], subject: `Re: ${a.json.reference}: Help desk query from Asha Rao`, messageId: '<x1@example.net>', text: 'Hello' };
  assert.equal((await arrives(stranger)).json.reason, 'NO_THREAD');

  /* no headers, but from the inbox itself: filed, and marked as matched by the subject */
  const bare = { from: INBOX, to: [PERSON_A, SITE_MAILBOX], subject: `Re: ${a.json.reference}: Help desk query from Asha Rao`, messageId: '<x2@mail.sansad.in>', text: 'A vet is at Defence Colony.' };
  const filed = await arrives(bare);
  assert.equal(filed.json.filed, true);
  assert.equal(filed.json.reference, a.json.reference);
  assert.equal(filed.json.how, 'subject');

  /* unrelated mail to the mailbox is left alone */
  assert.equal((await arrives({ from: 'news@example.com', to: [SITE_MAILBOX], subject: 'Weekly newsletter', messageId: '<n@example.com>', text: 'Hi' })).json.reason, 'NO_THREAD');
  assert.equal(records().length, 2);
});

/* ---- 11 to 14: every kind the same way ----------------------------------- */

const SAME_WAY = {
  'PFA-CR': ['report.html', { what: 'A dog with a wound near the market.', animal: 'Dog', urgency: 'Happening now', ...PLACE, when: 'This morning', accused: 'Not known', name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, 'Cruelty report', 'Your report is in'],
  'PFA-J': ['careers.html', { role: 'Zonal Head - North North', roleId: 'zonal-head', zone: 'North North', name: 'Asha Rao', ...PLACE, mobile: '9876543210', email: PERSON_A, pfaMember: 'Yes', unit: 'PFA Delhi, volunteer', background: 'Five years of rescue work', travel: 'Yes', 'Q1 Poisoning and FIR refusal': 'I would file the FIR myself.', 'Q2 First ninety days': 'Meet every unit.', timeToApply: '6 minutes' }, 'Job application', 'Your application is in']
};

for (const [kind, [page, data, label, subject]] of Object.entries(SAME_WAY)) {
  test(`${label}: gandhim gets it from info@ with Reply-To the site, the reply is filed on it, the letter threads`, async () => {
    const res = await submit(kind, data, page, kind === 'PFA-CR' ? { photos: [PHOTO] } : {});
    assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
    const ref = res.json.reference;
    const record = db.dump()['submissions/' + ref];
    assert.ok(MT.isThreadId(record.threadId));
    const copy = lastInboxCopy();
    assert.equal(copy.from, 'People for Animals <info@peopleforanimalsindia.org>');
    assert.equal(copy.to, INBOX);
    assert.deepEqual(replyToList(copy), [SITE_MAILBOX], 'every kind of submission is answered to the site, not to the person');
    assert.equal(copy.messageId, `<${ref}.${record.threadId}.forward@peopleforanimalsindia.org>`);
    const letter = toPersonA()[0];
    assert.equal(letter.subject, `${subject} - ${ref}`);
    assert.equal(letter.messageId, `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);
    const filed = await arrives(replyTo(copy, { text: `About your ${label.toLowerCase()}: noted.` }));
    assert.equal(filed.json.filed, true);
    assert.equal(filed.json.reference, ref);
    assert.equal(messagesOf(ref).filter((m) => m.type === 'reply').length, 1);
    assert.equal(records().length, 1);
  });
}

test('a donation: a case under PFA-DON, the payments inboxes get it (never gandhim) with Reply-To the site, the receipt threads, a reply is filed on it, a repeated callback adds nothing', async () => {
  const page = await pay(Object.assign({ type: 'donate', amount: '500', cause: 'Where it is needed most', terms: 'yes', pan: 'ABCDE1234F' }, PERSON));
  assert.match(page, /Donation successful/);
  const refs = records().filter((k) => k.startsWith('submissions/PFA-DON-'));
  assert.equal(refs.length, 1, 'one case for the gift');
  const ref = refs[0].split('/')[1];
  const record = db.dump()[refs[0]];
  assert.equal(record.kind, 'PFA-DON');
  assert.equal(record.fields.email, PERSON_A);
  assert.equal(record.fields.amount, 'INR 500');
  assert.ok(MT.isThreadId(record.threadId));
  const copy = lastInboxCopy(PAY);
  assert.equal(copy.to, PAY);
  assert.ok(lastInboxCopy(PAY2), 'the second payments inbox too');
  assert.equal(inboxCopies(INBOX).length, 0, 'never gandhim');
  assert.equal(copy.from, 'People for Animals <info@peopleforanimalsindia.org>');
  assert.deepEqual(replyToList(copy), [SITE_MAILBOX], 'every kind of submission is answered to the site, not to the person');
  assert.match(copy.subject, new RegExp('^' + ref + ': Donation from Asha Rao$'));
  assert.match(copy.text, /Amount paid: INR 500/);
  assert.match(copy.text, /PAN \(for the 80G certificate\): ABCDE1234F/);
  const receipt = toPersonA().find((m) => /^Donation received by PFA - /.test(m.subject));
  assert.ok(receipt, 'the donor gets the receipt');
  assert.equal(receipt.messageId, `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);
  assert.equal(record.threadSubject, receipt.subject);

  const filed = await arrives(replyTo(copy, { from: PAY, name: 'PFA Accounts', text: 'Thank you for your gift. The 80G certificate follows.' }));
  assert.equal(filed.json.filed, true);
  assert.equal(filed.json.reference, ref);

  /* the ledger row and the case are two different things */
  const list = await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: { type: 'submissions', limit: '50' }, headers: admin });
  /* off the Submissions register since 26 Oct 2026 (it lives under Payments & donations), still opens by reference */
  assert.ok(!list.json.rows.some((r) => r.reference === ref), 'not on the Submissions register');
  const byRef = await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: { type: 'submissions', q: ref }, headers: admin });
  assert.ok(byRef.json.rows.some((r) => r.reference === ref && r.kindLabel === 'Donation'), 'found by its reference');
  const pays = await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: { type: 'payments', limit: '50' }, headers: admin });
  assert.equal(pays.json.rows.filter((r) => r.type === 'donate').length, 1);
});

test('a shop order: a case under its order number, the payments inboxes get it (never gandhim) with Reply-To the site, the confirmation threads, a second callback adds nothing', async () => {
  const backend = require('../lib/shop-backend');
  const C = require('../lib/ccavenue');
  process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'pfa-oldsite', client_email: 's@pfa-oldsite.iam.gserviceaccount.com', private_key: 'x' });
  const docs = new Map();
  let clock = 0;
  backend.use({
    docs,
    async read(c, id) { const d = docs.get(`${c}/${id}`); return d ? { data: JSON.parse(JSON.stringify(d.data)), updateTime: d.updateTime } : null; },
    async commit(writes) {
      for (const w of writes) {
        if (!w.set) continue;
        const d = docs.get(w.set.join('/'));
        if (w.ifUpdateTime && (!d || d.updateTime !== w.ifUpdateTime)) return { ok: false, conflict: true };
        if (w.mustNotExist && d) return { ok: false, conflict: true };
      }
      for (const w of writes) {
        const key = (w.set || w.increment).join('/');
        const d = docs.get(key) || { data: {}, updateTime: '' };
        if (w.set) Object.assign(d.data, JSON.parse(JSON.stringify(w.data)));
        else for (const [k, n] of Object.entries(w.by)) d.data[k] = (Number(d.data[k]) || 0) + n;
        d.updateTime = `t${++clock}`;
        docs.set(key, d);
      }
      return { ok: true };
    }
  });
  const form = (body) => ({ body: new URLSearchParams(body).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'pfa.test' } });
  try {
    const shopper = { name: 'Asha Rao', mobile: '9876543210', email: PERSON_A, address: 'Flat 4, Shanti Niwas, FC Road', state: 'Maharashtra', district: 'Pune', pincode: '411004' };
    const co = await call(require('../lib/routes/shop/checkout'), form(Object.assign({ items: JSON.stringify([{ id: '23', size: 'L', qty: 1 }]) }, shopper)));
    const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(co.raw);
    assert.ok(enc, co.raw.slice(0, 300));
    const sent = Object.fromEntries(new URLSearchParams(C.decrypt(enc[1], WORKING_KEY)));
    const answer = () => call(require('../lib/routes/shop/response'), form({ encResp: C.encrypt(new URLSearchParams({ order_id: sent.order_id, order_status: 'Success', amount: sent.amount, merchant_id: sent.merchant_id, tracking_id: '310000000001', bank_ref_no: 'BRN1', payment_mode: 'UPI' }).toString(), WORKING_KEY) }));
    const first = await answer();
    assert.match(first.raw, /Thank you, Asha\./);
    const ref = sent.order_id;
    assert.match(ref, /^PFA-SHP-[A-Z0-9]{8}$/);
    const record = db.dump()['submissions/' + ref];
    assert.ok(record, 'the order is a case in the panel');
    assert.equal(record.kind, 'PFA-SHP');
    assert.equal(record.fields.email, PERSON_A);
    assert.match(record.fields.items, /Sabyasachi x PFA, size L \(₹2,500\)/);
    assert.ok(MT.isThreadId(record.threadId));
    const copy = lastInboxCopy(PAY);
    assert.equal(copy.to, PAY);
    assert.ok(lastInboxCopy(PAY2), 'the second payments inbox too');
    assert.equal(inboxCopies(INBOX).length, 0, 'never gandhim');
    assert.deepEqual(replyToList(copy), [SITE_MAILBOX], 'every kind of submission is answered to the site, not to the person');
    assert.equal(copy.messageId, `<${ref}.${record.threadId}.forward@peopleforanimalsindia.org>`);
    assert.match(copy.subject, new RegExp('^' + ref + ': Shop order from Asha Rao$'));
    const confirmation = toPersonA().find((m) => m.subject === `Your PFA order ${ref} is placed`);
    assert.ok(confirmation);
    assert.equal(confirmation.messageId, `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);

    const copies = inboxCopies(PAY).length;
    await answer();
    assert.equal(inboxCopies(PAY).length, copies, 'a repeated callback sends nothing again');
    assert.equal(records().filter((k) => k.startsWith('submissions/PFA-SHP')).length, 1);

    const filed = await arrives(replyTo(copy, { from: PAY, name: 'PFA Accounts', text: 'Your order is packed and leaves tomorrow.' }));
    assert.equal(filed.json.filed, true);
    assert.equal(filed.json.reference, ref);
    const c = await caseOf(ref);
    assert.equal(c.kindLabel, 'Shop order');
    assert.equal(c.messages.filter((m) => m.type === 'reply').length, 1);
  } finally { backend.use(null); }
});

/* ---- 15 and 16: the panel and the headers ------------------------------- */

test('a reply from the panel threads with the letter Person A has, and the panel labels Replied, Note and a reply from the inbox', async () => {
  const res = await submit('PFA-CR', SAME_WAY['PFA-CR'][1], 'report.html');
  const ref = res.json.reference;
  const record = db.dump()['submissions/' + ref];
  const letter = toPersonA()[0];

  const reply = await call(require('../lib/routes/admin/case'), { body: { reference: ref, action: 'reply', text: 'We have sent a volunteer.' }, headers: admin });
  assert.equal(reply.statusCode, 200, reply.raw.slice(0, 300));
  const out = toPersonA().find((m) => /^Re: /.test(m.subject));
  assert.ok(out, 'the reply went to Person A');
  assert.equal(out.subject, `Re: ${letter.subject}`, 'the letter\'s own subject, so Gmail files it in the same conversation');
  assert.equal(out.inReplyTo, letter.messageId);
  assert.equal(out.references, letter.messageId);
  assert.equal(out.messageId, `<${ref}.${record.threadId}.reply.1@peopleforanimalsindia.org>`);
  assert.match(out.html, /You can reply to this email and it will reach PFA/, 'because the mailbox reads replies');

  const note = await call(require('../lib/routes/admin/case'), { body: { reference: ref, action: 'note', text: 'Volunteer: Ravi.' }, headers: admin });
  assert.equal(note.statusCode, 200);

  /* Person A answers the reply: filed on the record, relayed to the inbox */
  const back = replyTo(out, { from: PERSON_A, name: 'Asha Rao', text: 'Thank you, the dog is safe now.' });
  assert.deepEqual(back.to, [SITE_MAILBOX], 'Reply on the letter goes to the mailbox the site reads');
  const filed = await arrives(back);
  assert.equal(filed.json.filed, true);
  assert.equal(filed.json.party, 'sender');
  assert.deepEqual(filed.json.relayed, ['sent']);

  const c = await caseOf(ref);
  const types = c.messages.map((m) => `${m.type}:${m.direction || ''}`);
  assert.deepEqual(types, ['email:out', 'reply:out', 'note:', 'reply:in', 'email:out']);
  assert.equal(c.messages[1].messageId, out.messageId);

  /* the panel reads what the route writes */
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /var t = m\.type \|\| m\.kind \|\| 'note'/, 'the panel reads type, which the case route writes');
  assert.match(html, /<b>Replied<\/b> by/, 'a reply from the panel is labelled Replied');
  assert.match(html, /<b>Note<\/b> by/, 'a note is labelled Note');
  assert.match(html, /replied'\s*$|<\/b> replied/m, 'a reply from the inbox is labelled as a reply');
  assert.doesNotMatch(html, /m\.kind === 'reply' \? 'Replied'/, 'the old reading of a field nothing writes is gone');
  assert.match(html, /id="mailRead"/, 'the panel can read the mailbox now');
});

test('the mailbox is read over IMAP: the raw email is parsed, filed, and the mailbox position remembered', async () => {
  const res = await submit('PFA-Q', { question: 'Where can I take a hurt pigeon?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, 'ask.html');
  const ref = res.json.reference;
  const copy = lastInboxCopy();
  const raw = [
    `From: Gandhi M <${INBOX}>`,
    `To: Asha Rao <${PERSON_A}>, People for Animals <${SITE_MAILBOX}>`,
    `Subject: Re: ${copy.subject}`,
    'Date: Wed, 7 Oct 2026 11:15:00 +0530',
    'Message-ID: <abc123@mail.sansad.in>',
    `In-Reply-To: ${copy.messageId}`,
    `References: ${copy.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Take it to the Charity Birds Hospital at Chandni Chowk.',
    '',
    `On Wed, 7 Oct 2026 at 10:00, People for Animals <${SITE_MAILBOX}> wrote:`,
    `> ${ref}: Help desk query from Asha Rao`,
    ''
  ].join('\r\n');
  const calls = [];
  INBOUND._setClient((options) => ({
    mailbox: { uidValidity: 777 },
    async connect() { calls.push(['connect', options.host, options.auth.user]); },
    async getMailboxLock() { return { release() {} }; },
    async search(query) { calls.push(['search', query]); return [41, 42]; },
    async fetchOne(uid) { return { uid: Number(uid), source: Buffer.from(uid === '42' ? raw : raw.replace('<abc123@mail.sansad.in>', '<other@mail.sansad.in>').replace(`In-Reply-To: ${copy.messageId}`, 'In-Reply-To: <nothing@example.com>').replace(`References: ${copy.messageId}`, 'References: <nothing@example.com>')) }; },
    async logout() {}
  }));

  const run = await call(require('../lib/routes/inbound-mail'), { body: {}, headers: cron });
  assert.equal(run.statusCode, 200, run.raw.slice(0, 300));
  assert.equal(run.json.fetched, 2);
  assert.equal(run.json.filed, 1);
  assert.equal(run.json.unmatched, 1);
  assert.equal(calls[0][1], 'imap.secureserver.net', 'GoDaddy\'s own IMAP server first, as its settings page says (8 Oct 2026)');
  assert.equal(calls[0][2], SITE_MAILBOX, 'the sending mailbox is read, no second password needed');

  const m = messagesOf(ref).find((x) => x.type === 'reply');
  assert.ok(m);
  assert.equal(m.from, INBOX);
  assert.equal(m.fromName, 'Gandhi M');
  assert.equal(m.text, 'Take it to the Charity Birds Hospital at Chandni Chowk.');
  assert.equal(m.messageId, '<abc123@mail.sansad.in>');

  const state = db.dump()['counters/inboundMail'];
  assert.equal(state.lastUid, 42);
  assert.equal(state.uidValidity, '777');
  const again = await call(require('../lib/routes/inbound-mail'), { body: {}, headers: cron });
  assert.deepEqual(calls[calls.length - 1][1], { uid: '43:*' }, 'the next run starts after the last message read');
  assert.equal(again.json.fetched, 0);

  const status = await call(require('../lib/routes/inbound-mail'), { method: 'GET', headers: admin });
  assert.equal(status.json.configured, true);
  assert.equal(status.json.mailbox, SITE_MAILBOX);
  assert.equal(status.json.lastUid, 42);
});

test('the route is closed to the public, open to the schedule and to an administrator; the inbox gets the daily cron and Firebase the two-minute one', async () => {
  const anon = await call(require('../lib/routes/inbound-mail'), { method: 'GET', headers: {} });
  assert.equal(anon.statusCode, 401);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/inbound-mail'));
  const fn = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  assert.match(fn, /inboundMailCheck = onSchedule\(\s*\{[^}]*schedule: 'every 2 minutes'/);
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'functions/package.json'), 'utf8')).dependencies;
  for (const d of ['nodemailer', 'imapflow', 'mailparser']) assert.ok(deps[d], `functions/package.json needs ${d}`);
  const { ROUTES } = require('../api/index.js')._private;
  assert.ok(ROUTES['inbound-mail']);
});

test('with reply capture switched off, or no mailbox, Reply-To is Person A alone and nothing else changes', async () => {
  process.env.PFA_CAPTURE_REPLIES = 'off';
  const res = await submit('PFA-Q', { question: 'Is there a shelter near Lajpat Nagar that takes in an injured pigeon?', topic: 'An animal I found or feed', ...PLACE, name: 'Asha Rao', mobile: '9876543210', email: PERSON_A }, 'ask.html');
  assert.equal(res.statusCode, 200);
  const copy = lastInboxCopy();
  assert.equal(copy.replyTo, PERSON_A);
  assert.ok(copy.messageId, 'the thread id still travels, so a copied-in reply would still be filed');
  const status = await call(require('../lib/routes/inbound-mail'), { method: 'GET', headers: admin });
  assert.equal(status.json.captureOff, true);
});

test('a send that outlasts the page\'s wait is still recorded as sent, so the worker does not send the inbox a second copy', async () => {
  const CONFIRM = require('../lib/confirmations');
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const results = [];
  const queue = {
    async queueEmail() { return { emailId: 'e1', created: true }; },
    async recordEmailResult(r) { results.push(r); }
  };
  const mail = { isConfigured: () => true, smtpConfigured: () => false, deliver: () => slow.then(() => ({ providerId: '<late@pfa>' })) };
  const out = await CONFIRM.send({ to: INBOX, template: 'submission_forward', payload: { reference: 'PFA-Q-2026-00001' }, dedupeKey: 'x', mail, queue, timeoutMs: 10 });
  assert.equal(out.state, 'queued');
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(results.length, 2);
  assert.equal(results[1].ok, true);
  assert.equal(results[1].providerId, '<late@pfa>');
});


/* 8 Oct 2026: the panel said "Mailbox could not be read: Command failed".
   Reading tried imap.titan.email first, which turned the login away, and
   stopped there; GoDaddy's own server, imap.secureserver.net, was never
   tried. lib/imap-open.js now tries GoDaddy's first, moves on when a server
   refuses the login, and reports what each server said. */
function refusingLogin(host) {
  return Object.assign(new Error('Command failed'), { authenticationFailed: true, serverResponseCode: 'AUTHENTICATIONFAILED', responseText: `Invalid credentials (${host})` });
}

test('a server that refuses the login is not the end: the next one is tried, and the one that opens is used', async () => {
  const IMAP = require('../lib/imap-open');
  const tried = [];
  const opened = await IMAP.open((options) => ({
    async connect() { tried.push(options.host); if (options.host === 'imap.secureserver.net') throw refusingLogin(options.host); },
    async logout() {}
  }));
  assert.deepEqual(tried, ['imap.secureserver.net', 'imap.titan.email']);
  assert.equal(opened.host, 'imap.titan.email');
});

test('when every server refuses, the panel is told what each one said, not "Command failed"', async () => {
  INBOUND._setClient((options) => ({ async connect() { throw refusingLogin(options.host); }, async logout() {} }));
  const out = await call(require('../lib/routes/inbound-mail'), { body: {}, headers: cron });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.authentication, true);
  assert.match(out.json.error, /GoDaddy did not accept the login/);
  assert.match(out.json.error, /imap\.secureserver\.net: \[AUTHENTICATIONFAILED\] Invalid credentials/);
  assert.match(out.json.error, /imap\.titan\.email: \[AUTHENTICATIONFAILED\]/);
  assert.doesNotMatch(out.json.error, /^Mailbox could not be read: Command failed$/);
  const status = await call(require('../lib/routes/inbound-mail'), { method: 'GET', headers: cron });
  assert.match(status.json.lastError, /imap\.secureserver\.net: \[AUTHENTICATIONFAILED\]/, 'the panel shows the same words');
});

test('once the mailbox is open, a refusal is that mailbox\'s answer, reported as it is and not retried elsewhere', async () => {
  const tried = [];
  INBOUND._setClient((options) => ({
    mailbox: { uidValidity: 1 },
    async connect() { tried.push(options.host); },
    async getMailboxLock() { return { release() {} }; },
    async search() { throw Object.assign(new Error('Command failed'), { responseText: 'SEARCH not allowed' }); },
    async logout() {}
  }));
  const out = await call(require('../lib/routes/inbound-mail'), { body: {}, headers: cron });
  assert.deepEqual(tried, ['imap.secureserver.net']);
  assert.match(out.json.error, /imap\.secureserver\.net answered SEARCH not allowed/);
});

/* ---- kept in the admin panel only: volunteers and memberships ----------

   Owner, 21 Oct 2026: "Keep volunteer and membership submissions in the
   admin panel only; do not forward them by email. Add a Reply feature using
   the email service so admins can email applicants and receive their
   replies within the same admin conversation (entirely within admin panel
   without having to go to email service provider UI). Test the entire flow
   end to end: submission, admin visibility, outgoing email, incoming reply,
   and conversation history."

   Each kind is driven the whole way through the real routes: the form (or
   CCAvenue's callback, for a membership), the panel's register and record,
   the Reply box sending through the mailbox, the person answering with a
   plain Reply, the mailbox reading filing it on the same record, and a
   second round of both. Nothing at any point is emailed to anyone at PFA. */

const VOLUNTEER = { name: 'Asha Rao', mobile: '9876543210', email: PERSON_A, ...PLACE, title: 'Volunteer: Head Office', notes: 'Free on weekends. I can help with feeding drives and first aid.' };

const register = async () => (await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: { type: 'submissions', limit: '50' }, headers: admin })).json.rows;
const panelReply = (reference, text) => call(require('../lib/routes/admin/case'), { body: { reference, action: 'reply', text, requestId: 'r-' + Math.random() }, headers: admin });
const toPFA = () => smtp.sent.filter((m) => m.to !== PERSON_A);

/* Owner, 23 Oct 2026: "ensure all caregiver and volunteer and job and
   membership applications go to gandhim email id." From 21 to 23 Oct a
   volunteer application and a membership were kept in the panel only; now
   each goes to gandhim like any form, and the person's answers are carried
   on to gandhim too. A membership is paid: gandhim gets the application
   without the payment, the payments inboxes a receipt. */
async function conversationWithGandhim(ref, firstLetter, copies) {
  /* 2. admin visibility: in the register, not marked, and readable */
  let row = (await register()).find((r) => r.reference === ref);
  assert.ok(row, 'the register lists it');
  assert.equal(row.awaitingReply, false, 'nobody has written back yet');
  let c = await caseOf(ref);
  assert.equal(c.reference, ref);
  assert.deepEqual(c.messages.map((m) => m.to), copies, 'the copies open the conversation');

  /* 3. outgoing: the Reply box sends through the mailbox, threaded on the
     letter the person already has */
  const r1 = await panelReply(ref, 'Thank you for writing in. Could you come in on Saturday at 10?');
  assert.equal(r1.statusCode, 200, r1.raw.slice(0, 300));
  assert.equal(r1.json.delivered, true);
  const out1 = toPersonA().find((m) => /^Re: /.test(m.subject));
  assert.ok(out1, 'the reply reached the person');
  assert.equal(out1.from, 'People for Animals <info@peopleforanimalsindia.org>', 'from PFA\'s own mailbox');
  assert.equal(out1.subject, `Re: ${firstLetter.subject}`, 'in the same conversation in their mail app');
  assert.equal(out1.inReplyTo, firstLetter.messageId);
  assert.deepEqual(replyToList(out1), [SITE_MAILBOX], 'their Reply comes back to the mailbox the site reads');
  assert.match(out1.text, /come in on Saturday at 10/);

  /* 4. incoming: a plain Reply from the person, read from the mailbox, and
     carried on to gandhim */
  const back1 = replyTo(out1, { from: PERSON_A, name: 'Asha Rao', text: 'Saturday works. See you then.' });
  assert.deepEqual(back1.to, [SITE_MAILBOX]);
  const filed1 = await arrives(back1);
  assert.equal(filed1.statusCode, 200, filed1.raw.slice(0, 300));
  assert.equal(filed1.json.filed, true);
  assert.equal(filed1.json.reference, ref, 'filed on the same record');
  assert.equal(filed1.json.party, 'sender');
  assert.deepEqual(filed1.json.relayed, ['sent'], 'carried on to gandhim, where the application is');
  const relay = lastInboxCopy(INBOX);
  assert.match(relay.subject, new RegExp('^Re: ' + ref + ': '));
  assert.match(relay.text, /Saturday works/);
  row = (await register()).find((r) => r.reference === ref);
  assert.equal(row.awaitingReply, true, 'the register marks it: the person wrote back');

  /* a second round: PFA again, the person again */
  const r2 = await panelReply(ref, 'Wonderful. Please bring an ID.');
  assert.equal(r2.json.delivered, true);
  row = (await register()).find((r) => r.reference === ref);
  assert.equal(row.awaitingReply, false, 'answered: the mark goes');
  const out2 = toPersonA().filter((m) => /^Re: /.test(m.subject))[1];
  assert.ok(out2 && /bring an ID/.test(out2.text));
  assert.ok(MT.idsIn(out2.references).includes(firstLetter.messageId), 'still the same conversation');
  const filed2 = await arrives(replyTo(out2, { from: PERSON_A, name: 'Asha Rao', text: 'Will do.' }));
  assert.equal(filed2.json.reference, ref);
  assert.equal((await register()).find((r) => r.reference === ref).awaitingReply, true);

  /* the same email read twice is one message */
  const dup = await arrives(back1);
  assert.equal(dup.json.reason, 'DUPLICATE');

  /* 5. conversation history: every leg, on the one record */
  c = await caseOf(ref);
  const legs = c.messages.map((m) => `${m.type}:${m.direction}:${m.party}`);
  assert.deepEqual(legs.slice(0, copies.length), copies.map(() => 'email:out:site'), 'the copies first');
  assert.deepEqual(legs.filter((l) => l !== 'email:out:site'), ['reply:out:staff', 'reply:in:sender', 'reply:out:staff', 'reply:in:sender']);
  assert.deepEqual(c.messages.filter((m) => m.type === 'reply').map((m) => m.text), [
    'Thank you for writing in. Could you come in on Saturday at 10?',
    'Saturday works. See you then.',
    'Wonderful. Please bring an ID.',
    'Will do.'
  ]);
  assert.equal(records().filter((k) => k.startsWith('submissions/' + ref.slice(0, 6))).length, 1, 'still one record');

  /* gandhim had the application and both answers; nothing was relayed to the payments inboxes */
  assert.equal(inboxCopies(INBOX).length, 3, 'the copy and two relays');
  for (const to of [PAY, PAY2]) assert.equal(inboxCopies(to).length, copies.includes(to) ? 1 : 0, `${to}: the receipt at most`);
}

test('a volunteer application: to gandhim, answered from the panel, and the whole conversation is there', async () => {
  /* 1. submission */
  const res = await submit('PFA-V', VOLUNTEER, 'get-involved.html');
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  const ref = res.json.reference;
  assert.match(ref, /^PFA-V-\d{4}-\d{5}$/);
  const record = db.dump()['submissions/' + ref];
  assert.ok(record && MT.isThreadId(record.threadId), 'on record, with a conversation');
  assert.deepEqual(toPFA().map((m) => m.to), [INBOX], 'one copy, to gandhim');
  const copy = lastInboxCopy(INBOX);
  assert.match(copy.subject, new RegExp('^' + ref + ': .+ from Asha Rao$'));
  assert.match(copy.text, /Free on weekends/);
  const letter = toPersonA()[0];
  assert.ok(letter, 'the volunteer is sent their confirmation');
  assert.equal(letter.messageId, `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);
  await conversationWithGandhim(ref, letter, [INBOX]);
});

test('a paid membership: the application to gandhim without the payment, the receipt to the payments inboxes, and the whole conversation is there', async () => {
  /* 1. submission, through CCAvenue */
  const page = await pay(Object.assign({ type: 'membership', tier: 'silver', terms: 'yes' }, PERSON));
  const ref = (page.match(/PFA-MEM-\d{4}-\d{5}/) || [])[0];
  assert.ok(ref, 'the member is shown their number');
  const record = db.dump()['submissions/' + ref];
  assert.ok(record && MT.isThreadId(record.threadId));
  assert.deepEqual(toPFA().map((m) => m.to), [INBOX, PAY, PAY2], 'the application to gandhim, a receipt to each payments inbox');
  const application = lastInboxCopy(INBOX);
  assert.equal(application.subject, `${ref}: Membership from Asha Rao`);
  assert.match(application.text, /16 MG Road/);
  assert.doesNotMatch(application.text + application.html, /Amount|Order ID|Bank reference|BNK900|31233|₹/, 'not a word about the money');
  assert.ok(!application.text.includes(record.fields.orderId));
  for (const to of [PAY, PAY2]) {
    const receipt = lastInboxCopy(to);
    assert.equal(receipt.subject, `${ref}: Payment for a membership from Asha Rao`);
    assert.match(receipt.text, /Amount paid: ₹\d/);
    assert.ok(receipt.text.includes(`Order ID: ${record.fields.orderId}`));
    assert.match(receipt.text, /Bank reference: BNK900/);
    assert.doesNotMatch(receipt.text, /16 MG Road/, 'the application is not in it');
  }
  const letter = toPersonA().find((m) => m.messageId === `<${ref}.${record.threadId}.confirm@peopleforanimalsindia.org>`);
  assert.ok(letter, 'the member is sent their welcome letter, which opens the conversation');
  await conversationWithGandhim(ref, letter, [INBOX, PAY, PAY2]);
});

test('the panel shows who wrote back, and no longer says volunteers and memberships stay in it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /function wrote\(r\) \{\s*return r && r\.awaitingReply \?/);
  assert.match(html, /flag\(r\.status, r\.statusLabel\) \+ wrote\(r\) \+ '<\/td>'\n {6}\+ '<td>' \+ esc\(r\.assignedTo/, 'in the register');
  assert.match(html, /flag\(r\.status, r\.statusLabel\) \+ wrote\(r\) \+ '<\/td>'\n {10}\+ '<td>' \+ esc\(when\(r\.createdAt\)\)/, 'and in the volunteers list');
  assert.doesNotMatch(html, /are not emailed to anyone at PFA/);
  assert.match(html, /every application included \(caregiver, membership, volunteer and job\), without any payment in it/);
  assert.deepEqual([...require('../lib/submission-forward.js').PANEL_ONLY_KINDS], [], 'nothing is kept to the panel alone');
});
