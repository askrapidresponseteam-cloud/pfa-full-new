'use strict';

/* Every email to info@ is kept and can be answered, whatever it answers
   (owner, 28 Nov 2026: "ensure every revert/reply of email is properly sent
   and received from info@ for all queries and responses.. back and forth").

   A reply to an email about a submission was already filed on it
   (lib/inbound-mail.js). Everything else was counted as "unmatched" and left
   in the mailbox, where nobody in the panel saw it: a reply to an intern's
   start link, to a card being posted, to a letter, to a birthday card, and
   any new email someone wrote to info@ of their own accord. Now:

   - The ledger. Every email the site sends from info@ is written down by its
     Message-ID (lib/caregiver-mail.js deliver): which email it was, to whom,
     and what it was about. A reply names that id in In-Reply-To or
     References, so the site knows what it answers.
   - Conversations. A reply the submissions do not claim, and a new email,
     becomes a conversation in the panel (mailConversations), with what it
     answers when the ledger knows. Later messages in the same exchange join
     it: by the panel's own ids (PFA-MAIL-...), or by any id already filed
     on it.
   - Answers. Staff answer from the panel; the answer goes from info@ to the
     person with In-Reply-To and References set, so it threads in their mail
     program, and their next reply comes back here, to the same conversation.
     Back and forth, as long as it lasts, all through info@.

   Nothing here deletes anything. A conversation is closed or reopened, never
   removed. */

const crypto = require('crypto');
const MT = require('./mail-thread');

const CONVERSATIONS = 'mailConversations';
const INDEX = 'mailIndex';
const TEXT_MAX = 20000;
const CHAIN_MAX = 20;
const OWN_PREFIX = 'PFA-MAIL-';

/* what a sent email is called in the panel */
const LABELS = {
  intern_start: 'Internship: the start link', intern_welcome: 'Internship: welcome', intern_reminder: 'Internship: a week\'s reminder',
  intern_nudge: 'Internship: a reminder from PFA', intern_not_started: 'Internship: not started yet', intern_extended: 'Internship: more time',
  intern_feedback: 'Internship: feedback on a task', intern_quiz_result: 'Internship: quiz marks', intern_shelter_change: 'Internship: choose another shelter',
  intern_details_needed: 'Internship: details needed', internship_certificate: 'Internship certificate',
  card_issued: 'Colony caregiver card issued', card_posted: 'Colony caregiver card posted', card_shipping: 'Colony caregiver card: postage',
  caregiver_photo_request: 'Colony caregiver card: photograph asked for', caregiver_photo_received: 'Colony caregiver card: photograph received',
  digital_card: 'Membership card online', member_card_approved: 'Membership card approved', member_card_dispatched: 'Membership card dispatched',
  member_photo_request: 'Membership card: photograph asked for', member_photo_received: 'Membership card: photograph received',
  med_note_published: 'Care Guide published', med_note_changes: 'Care Guide: changes asked for', med_note_update_received: 'Care Guide: update received',
  pfa_letter: 'Letter from PFA', birthday_greeting: 'Birthday card', shipment_update: 'Shop: shipment update', shipping_paid: 'Shop: postage paid',
  payment_received: 'Donation receipt', membership_welcome: 'Membership welcome', submission_received: 'Submission received',
  shop_order_confirmed: 'Shop order confirmed', tax_id_received: '80G details received', staff_invite: 'Admin panel invitation', mail_answer: 'An answer from PFA'
};

const key = (messageId) => crypto.createHash('sha256').update(String(messageId || '').trim().toLowerCase(), 'utf8').digest('hex').slice(0, 32);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

/* a few facts about what an email was about, for the panel; never its body */
function hintOf(payload) {
  const p = payload || {};
  const out = {};
  ['reference', 'internId', 'orderId', 'memberId', 'cardId', 'applicationRef', 'number', 'batchId', 'kindLabel', 'name'].forEach((k) => {
    if (p[k] != null && p[k] !== '') out[k] = clean(p[k], 120);
  });
  return out;
}

/* ---- the ledger --------------------------------------------------------- */

/* Written by caregiver-mail's deliver() for every email that left. Never
   throws: an email that went must never be reported as failed because the
   note of it could not be written. */
async function recordSent(db, { messageId, template, to, subject, payload, money }) {
  if (!db || !messageId) return false;
  try {
    const p = payload || {};
    await db.collection(INDEX).doc(key(messageId)).set({
      messageId: clean(messageId, 300),
      sent: {
        template: clean(template, 60), label: LABELS[template] || clean(template, 60).replace(/_/g, ' '),
        to: clean(Array.isArray(to) ? to.join(', ') : to, 300).toLowerCase(), subject: clean(subject, 300),
        reference: clean(p.reference || p.applicationRef || '', 60), threadId: MT.isThreadId(p.threadId) ? p.threadId : '',
        money: Boolean(money), hint: hintOf(p), at: new Date().toISOString()
      }
    }, { merge: true });
    return true;
  } catch (error) {
    console.warn('sent email not written to the ledger', template, error && error.message);
    return false;
  }
}

async function lookup(db, ids) {
  for (const id of ids) {
    const snap = await db.collection(INDEX).doc(key(id)).get();
    if (snap.exists) return Object.assign({ id }, snap.data() || {});
  }
  return null;
}

/* ---- filing ------------------------------------------------------------- */

const referenceOf = (convId) => OWN_PREFIX + String(convId).replace(/^MC-/, '').toUpperCase();
const convOf = (reference) => 'MC-' + String(reference).slice(OWN_PREFIX.length).toLowerCase();

function idsOf(msg) {
  const inReply = MT.idsIn(msg.inReplyTo);
  const refs = MT.idsIn(msg.references).slice().reverse();
  return inReply.concat(refs.filter((x) => !inReply.includes(x)));
}

/* Which conversation a message belongs to, or a new one. */
async function conversationFor(db, msg) {
  const own = MT.ours({ inReplyTo: msg.inReplyTo, references: msg.references });
  if (own && own.reference.startsWith(OWN_PREFIX)) {
    const id = convOf(own.reference);
    const snap = await db.collection(CONVERSATIONS).doc(id).get();
    if (snap.exists && (snap.data() || {}).threadId === own.threadId) return { id, data: snap.data(), how: 'thread' };
  }
  const hit = await lookup(db, idsOf(msg));
  if (hit && hit.conversation) {
    const snap = await db.collection(CONVERSATIONS).doc(hit.conversation).get();
    if (snap.exists) return { id: hit.conversation, data: snap.data(), how: 'thread' };
  }
  if (hit && hit.sent) return { id: 'MC-' + key(hit.messageId || hit.id).slice(0, 12), data: null, answers: hit, how: 'answers' };
  return { id: 'MC-' + key(msg.messageId || `${msg.from}|${msg.subject}|${msg.date.toISOString()}`).slice(0, 12), data: null, how: 'new' };
}

/* Files a message nothing else claimed. Answers as inbound-mail's file():
   { filed: true, conversation, how, auto } or { filed: false, reason }. */
async function fileUnmatched(db, msg, options) {
  const o = options || {};
  if (!msg || !msg.from) return { filed: false, reason: 'NO_SENDER' };
  const inboxes = new Set((o.inboxes || []).map((a) => String(a || '').toLowerCase()));
  const own = String(o.mailbox || '').toLowerCase();
  const from = String(msg.from).toLowerCase();
  /* the site's own mailbox writing to itself (a copy, a test) is not a conversation */
  if (own && from === own) return { filed: false, reason: 'OWN_MAILBOX' };
  const party = inboxes.has(from) ? 'staff' : 'person';
  const found = await conversationFor(db, msg);
  /* A new email (it answers nothing the site sent) is a query only when a
     person wrote it to PFA: a newsletter, an automatic notice, or staff
     copying info@ on their own mail is left in the mailbox as before. */
  /* staff writing to info@ outside a conversation (an answer to the site's
     own report, a copy of their own mail) is theirs, not a query */
  if (party === 'staff' && !found.data) return { filed: false, reason: 'NO_THREAD' };
  if (found.how === 'new') {
    if (msg.autoReply || msg.bulk || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?)[@+.]/i.test(from)) return { filed: false, reason: 'NO_THREAD' };
  }
  const convRef = db.collection(CONVERSATIONS).doc(found.id);
  const id = o.docId || ('in-' + key(msg.messageId || `${msg.from}|${msg.date.toISOString()}|${msg.subject}`).slice(0, 24));
  const at = new Date(o.now ? o.now() : Date.now()).toISOString();
  const auto = msg.autoReply || '';
  const text = clean(msg.newText || msg.text, TEXT_MAX);
  const message = {
    id, direction: 'in', party, from, fromName: clean(msg.fromName, 120), to: msg.to || [], subject: clean(msg.subject, 300),
    text, fullText: clean(msg.text, TEXT_MAX), html: typeof msg.html === 'string' && msg.html.length < 200000 ? msg.html : '',
    at, sentAt: msg.date instanceof Date ? msg.date.toISOString() : at, messageId: clean(msg.messageId, 300),
    inReplyTo: MT.idsIn(msg.inReplyTo), references: MT.idsIn(msg.references).slice(-CHAIN_MAX),
    attachments: (Array.isArray(msg.attachments) ? msg.attachments : []).map((a, i) => ({ n: i + 1, filename: clean(a.filename, 120), contentType: clean(a.contentType, 80), size: a.bytes ? a.bytes.length : 0 }))
  };
  if (auto) message.auto = auto;
  const msgRef = convRef.collection('messages').doc(id);
  const out = await db.runTransaction(async (tx) => {
    const [mSnap, cSnap] = [await tx.get(msgRef), await tx.get(convRef)];
    if (mSnap.exists) return { duplicate: true };
    const was = cSnap.exists ? cSnap.data() || {} : null;
    /* only what the person sent is threaded on: staff's own messages to
       info@ are never what an answer to the person says it answers */
    const theirs = party === 'person' && message.messageId;
    const chain = ((was && was.chain) || []).concat(theirs ? [message.messageId] : []).slice(-CHAIN_MAX);
    const next = {
      updatedAt: at, lastInAt: at, lastFrom: from, lastInMessageId: (theirs ? message.messageId : '') || (was && was.lastInMessageId) || '',
      chain, count: ((was && was.count) || 0) + 1,
      subject: (was && was.subject) || message.subject || '(no subject)'
    };
    /* the person is who wrote first and is not staff; an automatic reply moves nothing */
    if (!auto) {
      next.needsAnswer = party === 'person';
      next.state = party === 'person' ? 'open' : ((was && was.state) || 'open');
    }
    if (!was) {
      Object.assign(next, {
        id: found.id, threadId: MT.newThreadId(), createdAt: at, how: found.how,
        person: party === 'person' ? { email: from, name: message.fromName } : { email: '', name: '' },
        answers: found.answers && found.answers.sent ? Object.assign({ messageId: found.answers.messageId || found.answers.id }, found.answers.sent) : null,
        replies: 0, state: auto ? 'open' : next.state || 'open', needsAnswer: auto ? false : next.needsAnswer
      });
    } else if (party === 'person' && !(was.person && was.person.email)) {
      next.person = { email: from, name: message.fromName };
    }
    tx.set(convRef, next, { merge: true });
    tx.set(msgRef, message);
    if (message.messageId) tx.set(db.collection(INDEX).doc(key(message.messageId)), { messageId: message.messageId, conversation: found.id }, { merge: true });
    return { created: !was };
  });
  if (out.duplicate) return { filed: false, reason: 'DUPLICATE', messageId: msg.messageId };
  return { filed: true, conversation: found.id, how: found.how, party, auto: Boolean(auto), created: out.created, messageDoc: id };
}

/* ---- answering ---------------------------------------------------------- */

async function answer(db, { conversation, text, by, send, domain, siteUrl, now }) {
  const ref = db.collection(CONVERSATIONS).doc(String(conversation || ''));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, status: 404, code: 'NO_CONVERSATION', message: 'That conversation is not here. Refresh the page.' };
  const c = snap.data() || {};
  const to = String((c.person && c.person.email) || '').toLowerCase();
  if (!to) return { ok: false, status: 422, code: 'NO_ADDRESS', message: 'There is no one to answer in this conversation.' };
  const body = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, TEXT_MAX);
  if (body.length < 2) return { ok: false, status: 422, code: 'NO_TEXT', message: 'Write the answer first.' };
  const n = (Number(c.replies) || 0) + 1;
  const reference = referenceOf(c.id || conversation);
  const messageId = MT.messageId({ reference, threadId: c.threadId, part: `reply.${n}` }, domain || MT.DEFAULT_DOMAIN);
  const inReplyTo = c.lastInMessageId || '';
  const references = MT.references((c.chain || []).filter((x) => x !== inReplyTo), inReplyTo);
  const at = new Date(now ? now() : Date.now()).toISOString();
  const signoff = by && (by.name || by.email) ? `${by.name || String(by.email).split('@')[0].replace(/[._-]+/g, ' ')}, People for Animals` : 'People for Animals';
  const subject = 'Re: ' + String(c.subject || 'Your email to People for Animals').replace(/^(re|fwd?):\s*/i, '');
  const payload = { reference, threadId: c.threadId, n, name: (c.person && c.person.name) || '', text: body, subject, signoff, inReplyTo, references, siteUrl: siteUrl || '' };
  const outId = `out-${n}`;
  /* written before it goes, so an answer is never sent without being on file */
  await ref.collection('messages').doc(outId).set({ id: outId, direction: 'out', party: 'staff', from: 'info', by: by || null, to: [to], subject, text: body, at, messageId, inReplyTo: inReplyTo ? [inReplyTo] : [], state: 'sending' });
  await ref.set({ replies: n, needsAnswer: false, state: 'answered', updatedAt: at, lastOutAt: at, chain: (c.chain || []).concat([messageId]).slice(-CHAIN_MAX) }, { merge: true });
  await db.collection(INDEX).doc(key(messageId)).set({ messageId, conversation: c.id || conversation }, { merge: true });
  const sent = await send({ template: 'mail_answer', to, payload, dedupeKey: `mail_answer:${c.id || conversation}:${n}` });
  const state = sent && sent.sent ? 'sent' : sent && sent.queued ? 'queued' : 'unsent';
  await ref.collection('messages').doc(outId).set({ state, reason: (sent && sent.reason) || '' }, { merge: true });
  return { ok: true, n, state, messageId, to };
}

/* ---- carrying it on ----------------------------------------------------

   Where what a person writes is carried, by what it answers (the owner's
   standing rules): an answer to an email about money goes to the payments
   inboxes and never the forms inbox; anything about the internship stays in
   the panel (remote internship goes to a monthly report, not gandhim); a
   reply to any other email from the site goes to the forms inbox. A new
   email nobody asked for stays in the panel, where it can be answered, so
   gandhim's inbox does not fill with what any address on the internet sends
   to info@. */
function routeFor(answers, inboxes) {
  if (!answers) return [];
  const t = String(answers.template || '');
  if (answers.money) return inboxes.payments();
  if (/^intern(ship)?_/.test(t) || t === 'quiz_report' || t === 'intern_applications_report') return [];
  /* the site's own reports to staff: a reply to one is staff talking among themselves */
  if (/(_report|_digest|^weekly_digest|_staff)$/.test(t) || t === 'staff_invite' || t === 'inbox_test' || t === 'mail_relay') return [];
  return inboxes.forms();
}

function hintText(hint) {
  const h = hint || {};
  return ['reference', 'internId', 'orderId', 'memberId', 'cardId', 'applicationRef', 'number', 'kindLabel']
    .filter((k) => h[k]).map((k) => `${k === 'kindLabel' ? '' : k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) + ' '}${h[k]}`.trim()).join(', ');
}

/* After fileUnmatched: a person's message is carried to the inbox it
   concerns; staff writing back (to a relay, from their own inbox) is sent on
   to the person from info@, threaded, as an answer from the panel would be.
   `send(template, to, payload, dedupeKey)` sends one email. */
async function carry(db, filed, msg, o) {
  const opts = o || {};
  if (!filed || !filed.filed || filed.auto) return { relayed: [] };
  const text = clean(msg.newText || msg.text, TEXT_MAX);
  if (!text) return { relayed: [] };
  const ref = db.collection(CONVERSATIONS).doc(filed.conversation);
  const c = (await ref.get()).data() || {};
  if (filed.party === 'staff') {
    if (!c.person || !c.person.email) return { relayed: [] };
    const out = await answer(db, { conversation: filed.conversation, text, by: { email: msg.from, name: msg.fromName || '' }, domain: opts.domain, siteUrl: opts.siteUrl,
      send: ({ template, to, payload, dedupeKey }) => opts.send(template, to, payload, dedupeKey) });
    return { relayed: out.ok ? [out.to] : [], answered: out };
  }
  const to = routeFor(c.answers, opts.inboxes || { forms: () => [], payments: () => [] });
  if (!to.length) return { relayed: [] };
  const n = (Number(c.relays) || 0) + 1;
  await ref.set({ relays: n }, { merge: true });
  const site = String(opts.siteUrl || '').replace(/\/+$/, '');
  const payload = {
    reference: referenceOf(filed.conversation), threadId: c.threadId, n, from: msg.from, name: msg.fromName || '', text, subject: msg.subject || c.subject,
    label: c.answers ? c.answers.label : '', aboutSubject: c.answers ? c.answers.subject : '', hintText: c.answers ? hintText(c.answers.hint) : '',
    attachments: (msg.attachments || []).length, receivedAt: new Date().toISOString(), inReplyTo: msg.messageId || '', references: [],
    siteUrl: site, panelUrl: site ? `${site}/admin.html#mailbox` : ''
  };
  const states = [];
  for (const addr of to) {
    try { const r = await opts.send('mail_relay', addr, payload, `mail_relay:${filed.conversation}:${n}:${addr}`); states.push(r && (r.state || (r.sent ? 'sent' : r.queued ? 'queued' : 'unsent'))); }
    catch (error) { console.warn('conversation not relayed', filed.conversation, error && error.message); states.push('unsent'); }
  }
  const relayId = MT.messageId({ reference: payload.reference, threadId: c.threadId, part: `relay.${n}` }, opts.domain || MT.DEFAULT_DOMAIN);
  await db.collection(INDEX).doc(key(relayId)).set({ messageId: relayId, conversation: filed.conversation }, { merge: true });
  const id = filed.messageDoc;
  if (id) await ref.collection('messages').doc(id).set({ relay: { to, state: states.every((x) => x === 'sent') ? 'sent' : states[0] || 'unsent' } }, { merge: true });
  return { relayed: to };
}

/* ---- reading ------------------------------------------------------------ */

const visible = (c, money) => money !== false || !(c.answers && c.answers.money);

async function list(db, { state, money } = {}) {
  const snap = await db.collection(CONVERSATIONS).get();
  const all = snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {})).filter((c) => visible(c, money));
  const want = state === 'all' ? null : state || 'open';
  return all
    .filter((c) => !want || (want === 'open' ? c.state !== 'closed' : c.state === want))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((c) => ({ id: c.id, subject: c.subject, person: c.person, state: c.state, needsAnswer: Boolean(c.needsAnswer), count: c.count || 0, replies: c.replies || 0,
      updatedAt: c.updatedAt, createdAt: c.createdAt, answers: c.answers ? { label: c.answers.label, subject: c.answers.subject, reference: c.answers.reference, hint: c.answers.hint || {} } : null, how: c.how }));
}

async function get(db, id) {
  const ref = db.collection(CONVERSATIONS).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const messages = (await ref.collection('messages').get()).docs.map((d) => d.data() || {})
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return Object.assign({ id: snap.id }, snap.data() || {}, { messages });
}

async function setState(db, id, state, by) {
  if (!['open', 'closed'].includes(state)) return { ok: false, status: 422, code: 'BAD_STATE', message: 'Open or closed.' };
  const ref = db.collection(CONVERSATIONS).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, status: 404, code: 'NO_CONVERSATION', message: 'That conversation is not here.' };
  const at = new Date().toISOString();
  await ref.set({ state, needsAnswer: state === 'closed' ? false : Boolean((snap.data() || {}).needsAnswer), updatedAt: at, closedBy: state === 'closed' ? (by || null) : null }, { merge: true });
  return { ok: true, state };
}

async function counts(db, { money } = {}) {
  const snap = await db.collection(CONVERSATIONS).get();
  let open = 0;
  let waiting = 0;
  snap.docs.forEach((d) => { const c = d.data() || {}; if (!visible(c, money)) return; if (c.state !== 'closed') open += 1; if (c.state !== 'closed' && c.needsAnswer) waiting += 1; });
  return { open, waiting };
}

module.exports = { recordSent, lookup, fileUnmatched, carry, routeFor, answer, list, get, setState, counts, hintOf, key, referenceOf, LABELS, CONVERSATIONS, INDEX, OWN_PREFIX };
