'use strict';

/* Replies, read from PFA's mailbox and filed on the submission they answer.

   The copy of every submission goes to PFA's inbox with Reply-To naming the
   sender and, after it, the site's own mailbox (lib/caregiver-mail.js,
   captureAddress). A Reply from the inbox therefore goes to the sender, as
   it always did, and a copy arrives here. This module reads that mailbox
   over IMAP (GoDaddy's Titan mail offers it on every mailbox; nothing to
   buy or switch on), or takes the same message from a webhook, and files
   each one on the record it belongs to.

   Which record. Every email the site sends carries a Message-ID that names
   the submission and its thread (lib/mail-thread.js). A reply keeps that id
   in In-Reply-To and References, so the reference is read from the header
   and the threadId checked against the record: no guessing from names,
   addresses or subject lines. Mail that arrives with no threading headers
   at all is matched only by a reference quoted in its subject AND a sender
   already on the conversation, and the record says it was matched that way.

   What is filed. One message document under submissions/{reference}/messages,
   keyed by the email's own Message-ID, so the same email read twice is one
   message; its attachments beside the submission's photographs; and the
   record moved along: replyCount, lastReplyAt, a line in history. The
   message and the record's move are one transaction (8 Oct 2026), so a
   message is never on file without its move, and a retried reading cannot
   find the message filed but the record never moved.

   How the case moves (8 Oct 2026, lib/case-flow.js):
   - PFA's inbox answering a case that is still new takes it up, with a
     status line of its own; a case closed or marked spam meanwhile is left
     as it is (the state is re-read in the transaction).
   - The person writing back to a case that was handled reopens it to new,
     with a 'reopen' line, reason 'sender-replied'. Not a case marked spam.
   - An automatic reply (out of office, an autoresponder, a list) is filed so
     it can be seen, and moves nothing: it never takes a case up, never
     reopens it and is never relayed.
   - A bounce (a delivery report from a mail server) that names one of our
     Message-IDs is linked to its case: a note "The email to X was not
     delivered: why", a 'bounce' line in history and record.mailProblems.

   Which way. A message from PFA's inbox is Madam's reply: the person already
   has it, so it is filed and nothing else. A message from the person
   (answering their confirmation, or Reply-all to Madam) is filed and
   relayed to PFA's inbox under the same conversation, Reply-To the person,
   so the inbox sees both sides and can answer with one click again.

   When. An incoming email's `at` is the moment it was recorded here, so the
   conversation reads in the order things reached PFA; the email's own Date
   header (whatever the sender's clock said) is kept as `sentAt`. */

const crypto = require('crypto');
const S = require('./submissions');
const MT = require('./mail-thread');
const ORDER = require('./message-order');
const FORWARD = require('./submission-forward');
const CONFIRM = require('./confirmations');
const IMAP = require('./imap-open');
const FILES = require('./file-store');
const FLOW = require('./case-flow');

const MAX_TEXT = 20000;
/* What fits in a Firestore document beside its fields. A larger file is kept
   only in Storage (lib/file-store.js), which has no such limit. */
const MAX_INLINE_BYTES = 950 * 1024;
/* A sane cap for a reply's files (8 Oct 2026): phone photos are 2 to 6 MB. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;
const STATE_DOC = 'inboundMail';
/* A message that fails this many readings in a row is set aside, so one bad
   email cannot hold the mailbox's position back for ever. */
const PARK_AFTER = 5;
const KEEP_PARKED = 50;
const PROBLEM_DAYS = 14;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const DAEMON = /^(mailer-daemon|postmaster|mail-daemon)@/i;
const REPORT_PART = /^(message\/(rfc822|delivery-status|global|global-headers|global-delivery-status)|text\/rfc822-headers)/i;

/* ---- what a message looks like once read ----------------------------- */

function address(value) {
  if (!value) return { address: '', name: '' };
  if (typeof value === 'string') {
    const m = /^(.*?)<([^>]+)>\s*$/.exec(value.trim());
    const a = (m ? m[2] : value).trim().toLowerCase();
    return { address: EMAIL.test(a) ? a : '', name: m ? m[1].trim().replace(/^"|"$/g, '') : '' };
  }
  if (Array.isArray(value)) return address(value[0]);
  if (value.value && Array.isArray(value.value)) return address(value.value[0]);
  const a = String(value.address || '').trim().toLowerCase();
  return { address: EMAIL.test(a) ? a : '', name: String(value.name || '').trim() };
}

function addresses(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.split(',').map((v) => address(v).address).filter(Boolean);
  if (Array.isArray(value)) return value.map((v) => address(v).address).filter(Boolean);
  if (value.value && Array.isArray(value.value)) return value.value.map((v) => address(v).address).filter(Boolean);
  return [address(value).address].filter(Boolean);
}

/* The reply itself, without the quoted copy of what it answers. Gmail,
   Outlook and Apple Mail each mark the quote their own way; the first
   marker found ends the new text. The full text is kept as well. */
const QUOTE_MARKERS = [
  /^On .{0,200}wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/mi,
  /^From:\s.+$/m,
  /^_{10,}\s*$/m,
  /^>\s?/m
];

function newText(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  let cut = t.length;
  for (const marker of QUOTE_MARKERS) {
    const m = marker.exec(t);
    if (m && m.index < cut && m.index > 0) cut = m.index;
  }
  return t.slice(0, cut).trim();
}

/* A header by name, whichever shape the headers came in: mailparser's Map
   (lower-case keys), a webhook's plain object, or a list of { name, value }. */
function headerReader(m) {
  const h = m && m.headers;
  if (!h) return () => undefined;
  if (typeof h.get === 'function') return (name) => h.get(name);
  if (Array.isArray(h)) {
    return (name) => {
      const hit = h.find((x) => x && String(x.key || x.name || x.Name || '').toLowerCase() === name);
      return hit ? (hit.value !== undefined ? hit.value : hit.Value) : undefined;
    };
  }
  if (typeof h === 'object') {
    const lower = {};
    Object.keys(h).forEach((k) => { lower[k.toLowerCase()] = h[k]; });
    return (name) => lower[name];
  }
  return () => undefined;
}

function headerText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(headerText).join(', ');
  if (typeof value === 'object' && value.value !== undefined) {
    const params = value.params && typeof value.params === 'object'
      ? Object.keys(value.params).map((k) => `; ${k}=${value.params[k]}`).join('') : '';
    return `${value.value}${params}`;
  }
  if (typeof value === 'object' && value.text !== undefined) return String(value.text);
  return String(value);
}

/* Why a message is an automatic reply, or '' for one a person wrote
   (RFC 3834 Auto-Submitted, the common X- headers, and Precedence). */
function autoReplyOf(get) {
  const submitted = headerText(get('auto-submitted')).split(';')[0].trim().toLowerCase();
  if (submitted && submitted !== 'no') return `Auto-Submitted: ${submitted}`;
  for (const [name, label] of [['x-autoreply', 'X-Autoreply'], ['x-autorespond', 'X-Autorespond']]) {
    const v = headerText(get(name)).trim().toLowerCase();
    if (v && !/^(no|false|0)$/.test(v)) return label;
  }
  const precedence = headerText(get('precedence')).trim().toLowerCase();
  if (/^(auto_reply|bulk|junk|list)$/.test(precedence)) return `Precedence: ${precedence}`;
  return '';
}

/* One shape, whichever way the message arrived: mailparser's parsed mail
   (from IMAP) or a webhook's JSON. */
function normalise(raw) {
  const m = raw || {};
  const get = headerReader(m);
  const messageId = String(m.messageId || headerText(get('message-id')) || '').trim();
  const inReplyTo = MT.idsIn(m.inReplyTo || headerText(get('in-reply-to')) || '');
  const references = MT.idsIn(m.references || headerText(get('references')) || '');
  const from = address(m.from);
  const date = m.date ? new Date(m.date) : new Date();
  const text = String(m.text || (typeof m.html === 'string' ? m.html.replace(/<[^>]+>/g, ' ') : '') || '').replace(/\u0000/g, '').slice(0, MAX_TEXT);
  const all = (Array.isArray(m.attachments) ? m.attachments : []).map((a) => {
    const bytes = Buffer.isBuffer(a.content) ? a.content : (typeof a.content === 'string' ? Buffer.from(a.content, 'base64') : Buffer.alloc(0));
    return { filename: String(a.filename || 'attachment').slice(0, 120), contentType: String(a.contentType || 'application/octet-stream').slice(0, 80), bytes };
  }).filter((a) => a.bytes.length > 0);
  const contentType = headerText(get('content-type')).toLowerCase();
  const report = /multipart\/report/.test(contentType) && /report-type="?delivery-status/.test(contentType);
  return {
    messageId,
    inReplyTo,
    references,
    from: from.address,
    fromName: from.name,
    to: addresses(m.to),
    cc: addresses(m.cc),
    subject: String(m.subject || '').slice(0, 500),
    date: isNaN(date.getTime()) ? new Date() : date,
    text,
    newText: newText(text),
    attachments: all.filter((a) => !REPORT_PART.test(a.contentType)),
    /* the parts of a delivery report: the original message's headers and
       the per-recipient status, read only to link a bounce */
    reportParts: all.filter((a) => REPORT_PART.test(a.contentType)).map((a) => a.bytes.slice(0, 64 * 1024).toString('utf8')),
    autoReply: autoReplyOf(get),
    bounce: DAEMON.test(from.address) || report
  };
}

/* ---- which record --------------------------------------------------- */

function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
}

/* The record a message belongs to, or null. */
async function matchThread(db, msg, inboxes) {
  const own = MT.ours({ inReplyTo: msg.inReplyTo, references: msg.references });
  if (own) {
    const snap = await db.collection('submissions').doc(own.reference).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.threadId === own.threadId) return { reference: own.reference, data, how: 'headers', answers: own.part, threadId: own.threadId };
      /* a right reference under a wrong thread id is not a match: an id
         someone made up, or a record re-filed under the same number */
      console.warn('inbound mail names a thread the record does not carry', { reference: own.reference });
    }
    return null;
  }
  /* No threading headers at all. A reference in the subject, from an
     address already on the conversation, is accepted and marked as such. */
  if (msg.inReplyTo.length || msg.references.length) return null;
  const reference = MT.referenceIn(msg.subject);
  if (!reference) return null;
  const snap = await db.collection('submissions').doc(reference).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const contact = S.contactOf(data.fields);
  const known = sameAddress(contact.email, msg.from) || (inboxes || []).some((i) => sameAddress(i, msg.from));
  return known ? { reference, data, how: 'subject', answers: '' } : null;
}

/* Who wrote: PFA's inbox (Madam), the person who sent the submission, or
   somebody else altogether. */
function partyOf(msg, data, inboxes) {
  if ((inboxes || []).some((i) => sameAddress(i, msg.from))) return 'staff';
  const contact = S.contactOf(data.fields);
  if (sameAddress(contact.email, msg.from)) return 'sender';
  return 'other';
}

function messageDocId(msg) {
  const key = msg.messageId || `${msg.from}|${msg.date.toISOString()}|${msg.subject}`;
  return `in-${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}`;
}

function alreadyExists(error) {
  return Boolean(error && (error.code === 6 || /already exists/i.test(String(error.message))));
}

/* ---- attachments ------------------------------------------------------ */

/* Keeps a reply's files beside the submission's photographs. Each one is
   either kept (`stored: true`, with the id the panel and the relay read it
   by) or listed with why it was not. A file too large for a Firestore
   document goes to Storage (lib/file-store.js); until 8 Oct 2026 anything
   over 950 KB was dropped while the relay said it was in the admin panel.
   Throws when Storage is there but refused a file just now, so the whole
   message is tried again on the next reading rather than filed without it. */
async function keepAttachments(ref, reference, id, list, recordedAt) {
  const kept = [];
  let total = 0;
  for (const [i, a] of list.entries()) {
    const n = i + 1;
    const base = { n, filename: a.filename, contentType: a.contentType, size: a.bytes.length };
    if (i >= MAX_ATTACHMENTS) { kept.push(Object.assign(base, { stored: false, why: `more than ${MAX_ATTACHMENTS} files in one email` })); continue; }
    if (a.bytes.length > MAX_ATTACHMENT_BYTES) { kept.push(Object.assign(base, { stored: false, why: 'larger than 10 MB' })); continue; }
    if (total + a.bytes.length > MAX_TOTAL_BYTES) { kept.push(Object.assign(base, { stored: false, why: 'over 25 MB for one email' })); continue; }
    const attachmentId = `${id}-${n}`;
    const docRef = ref.collection('attachments').doc(attachmentId);
    const existing = await docRef.get();
    if (!existing.exists) {
      const large = a.bytes.length > MAX_INLINE_BYTES;
      if (large && !(typeof FILES.bucket === 'function' && await FILES.bucket())) {
        kept.push(Object.assign(base, { stored: false, why: 'too large to keep until file storage is switched on' }));
        continue;
      }
      const stored = await FILES.put(`submissions/${reference}/${attachmentId}`, a.bytes, a.contentType);
      if (large && !(stored && stored.storage)) throw new Error(`Attachment ${n} (${a.filename}) could not be stored just now`);
      try {
        await docRef.create(Object.assign({
          contentType: a.contentType, size: a.bytes.length, label: a.filename, messageId: id, createdAt: recordedAt
        }, stored));
      } catch (error) {
        if (!alreadyExists(error)) throw error;
      }
    }
    total += a.bytes.length;
    kept.push(Object.assign(base, { id: attachmentId, stored: true }));
  }
  return kept;
}

/* ---- bounces ------------------------------------------------------------ */

/* What a delivery report says: which of our emails came back, to whom, and
   why. The bounced email is named by the Message-ID line of the original
   headers the report carries (or quotes); a References line there is not
   the bounced email, so it is not read. */
function bounceOf(msg) {
  const texts = (msg.reportParts || []).concat([msg.text || '']);
  const ids = [];
  for (const t of texts) {
    const re = /^[ \t]*message-id:[ \t]*(<[^<>\s]+@[^<>\s]+>)/gim;
    let hit;
    while ((hit = re.exec(t))) if (!ids.includes(hit[1])) ids.push(hit[1]);
  }
  (msg.inReplyTo || []).concat(msg.references || []).forEach((x) => { if (!ids.includes(x)) ids.push(x); });
  const all = texts.join('\n');
  const diagnostic = /^[ \t]*diagnostic-code:[ \t]*(?:[a-z0-9-]+;[ \t]*)?(.+)$/im.exec(all);
  const smtp = /\b([45]\d\d[ -](?:[245]\.\d{1,3}\.\d{1,3} )?.{2,160})$/m.exec(all);
  const status = /^[ \t]*status:[ \t]*([45]\.\d{1,3}\.\d{1,3})/im.exec(all);
  const recipient = /^[ \t]*(?:final|original)-recipient:[ \t]*(?:[a-z0-9-]+;[ \t]*)?<?([^\s<>;]+@[^\s<>;]+?)>?\s*$/im.exec(all)
    || /<([^\s<>]+@[^\s<>]+)>:/.exec(all);
  const reason = String((diagnostic && diagnostic[1]) || (smtp && smtp[1]) || (status && `status ${status[1]}`) || 'the receiving mail server returned it')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
  return { ours: ids.map(MT.parse).filter(Boolean), reason, to: recipient ? recipient[1].toLowerCase() : '' };
}

/* Who one of our emails went to, by the part of its Message-ID, for a
   report that does not say. */
function recipientOf(part, data, inboxes) {
  if (part === 'forward') return (inboxes || FORWARD.inboxes(data)).join(', ');
  if (/^relay\./.test(part)) return (inboxes || FORWARD.relayInboxes(data)).join(', ');
  return S.contactOf((data || {}).fields).email || '';
}

async function fileBounce(db, msg, o, inboxes, nowMs) {
  const b = bounceOf(msg);
  let target = null;
  for (const own of b.ours) {
    const snap = await db.collection('submissions').doc(own.reference).get();
    if (snap.exists && (snap.data() || {}).threadId === own.threadId) { target = own; break; }
  }
  if (!target) return { filed: false, reason: 'BOUNCE_UNMATCHED', bounce: true, messageId: msg.messageId };

  const reference = target.reference;
  const ref = db.collection('submissions').doc(reference);
  const id = messageDocId(msg);
  const msgRef = ref.collection('messages').doc(id);
  const recordedAt = new Date(nowMs).toISOString();
  const fv = o.fieldValue || require('./firebase').fieldValue;
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const mine = await tx.get(msgRef);
    if (mine.exists) return { duplicate: true };
    const d = snap.data() || {};
    if (d.threadId !== target.threadId) return { gone: true };
    const to = b.to || recipientOf(target.part, d, o.inboxes) || 'the recipient';
    const problem = { at: recordedAt, to, reason: b.reason, messageId: target.id, part: target.part, report: msg.messageId || '' };
    tx.create(msgRef, {
      id, seq: ORDER.nextSeq(), type: 'note', event: 'bounce', party: 'site', from: msg.from,
      text: `The email to ${to} was not delivered: ${b.reason}`, by: 'Mail system',
      at: recordedAt, recordedAt, sentAt: msg.date.toISOString(), messageId: msg.messageId, bounced: target.id, to
    });
    tx.update(ref, {
      mailProblems: fv().arrayUnion(problem),
      history: fv().arrayUnion({ status: FLOW.currentOf(d), event: 'bounce', to, messageId: target.id, at: recordedAt, by: msg.from }),
      updatedAt: recordedAt
    });
    return { problem };
  });
  if (out.duplicate) return { filed: false, reason: 'DUPLICATE', bounce: true, reference, messageId: msg.messageId };
  if (out.gone) return { filed: false, reason: 'NO_THREAD', bounce: true, messageId: msg.messageId };
  /* The outbound queue row, when lib/caregiver-store.js can mark one. */
  const queue = o.queue || null;
  if (queue && typeof queue.markBounced === 'function') {
    try { await queue.markBounced(Object.assign({ reference }, out.problem)); } catch (error) {
      console.warn('bounce not marked on the outbound queue', { reference, message: error && error.message });
    }
  }
  return { filed: true, bounce: true, reference, to: out.problem.to, reason: out.problem.reason, part: target.part, messageId: msg.messageId };
}

/* ---- filing ---------------------------------------------------------- */

/* The person's message, relayed to PFA's inbox in the same conversation. */
async function relay(ref, { reference, data, msg, id, kept, n, recordedAt }, o, inboxes) {
  const contact = S.contactOf(data.fields);
  const site = String(o.siteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const stored = kept.filter((f) => f.stored);
  const payload = {
    reference, threadId: data.threadId || '', kindLabel: data.kindLabel || S.KIND_LABELS[data.kind] || 'Submission',
    name: contact.name || msg.fromName, email: msg.from, text: msg.newText || msg.text, subject: msg.subject,
    receivedAt: recordedAt, n, inboundId: id, siteUrl: site, adminUrl: site ? `${site}/admin.html` : '',
    references: msg.references,
    /* only what was actually kept: the count the relay states, and the ids
       of the files that go with it (lib/caregiver-mail.js reads them) */
    attachments: stored.length, attachmentIds: stored.map((f) => f.id), notKept: kept.length - stored.length
  };
  const relayed = await Promise.all(inboxes.map((to) => CONFIRM.send({
    to, template: 'submission_followup', payload, dedupeKey: `submission_followup:${reference}:${id}:${to}`,
    mail: o.mail, queue: o.queue || null, timeoutMs: o.timeoutMs || 9000
  }).catch((error) => { console.warn('follow-up not relayed', { reference, message: error && error.message }); return { state: 'unsent', to }; })));
  const state = relayed.every((r) => r.state === 'sent') ? 'sent' : (relayed[0] && relayed[0].state) || 'unsent';
  const relayId = `${id}-relay`;
  try {
    await ref.collection('messages').doc(relayId).create({
      id: relayId, seq: ORDER.nextSeq(), type: 'email', direction: 'out', party: 'site', to: inboxes.join(', '), from: o.mail.sender ? o.mail.sender().address : '',
      subject: `Re: ${reference}: ${payload.kindLabel} from ${payload.name || msg.from}`,
      text: 'Their message relayed to PFA\'s inbox.', state,
      messageId: (o.mail.threadHeaders ? o.mail.threadHeaders(payload, `relay.${n}`, 'forward').messageId : ''), at: recordedAt
    });
  } catch (_) { /* the relay went or is queued; the note is a courtesy */ }
  try { await ref.collection('messages').doc(id).update({ relay: state }); } catch (_) { /* the queue has it either way */ }
  return relayed;
}

/* The mirror of relay(): PFA's reply, carried to the person who wrote in.
 *
 * relay() has always carried their message to PFA. Nothing carried PFA's
 * answer back, because PFA's answer went straight from their mailbox to the
 * person's: the forwarded submission named the person in Reply-To, so Reply
 * reached them directly and info@ rode along only as a second address that
 * anybody could drop. Owner, 13 Oct 2026: "if I reply to gandhim without reply
 * all.. things will go missing."
 *
 * Now the forwarded submission is answered to this site alone, so PFA's reply
 * lands here. It is filed above like any other message, and this sends it on
 * to the person from info@. Their next reply is addressed here too, and the
 * conversation has no way out of the record.
 *
 * It never throws: the reply is already filed and already in the panel by the
 * time this runs, so a mail failure here loses no correspondence, it only
 * delays a delivery, and the note written against the message says so. */
async function answer(ref, { reference, data, msg, id, n, recordedAt }, o) {
  const contact = S.contactOf(data.fields);
  const to = String(contact.email || '').trim();
  if (!to) return { state: 'unsent', to: '', why: 'no email address' };
  const site = String(o.siteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  const payload = {
    reference, threadId: data.threadId || '',
    kindLabel: data.kindLabel || S.KIND_LABELS[data.kind] || 'Submission',
    name: contact.name || '', text: msg.newText || msg.text,
    subject: msg.subject && /^re:/i.test(msg.subject) ? msg.subject : '',
    receivedAt: recordedAt, n, siteUrl: site, references: msg.references
  };
  const sent = await CONFIRM.send({
    to, template: 'submission_answer', payload,
    dedupeKey: `submission_answer:${reference}:${id}`,
    mail: o.mail, queue: o.queue || null, timeoutMs: o.timeoutMs || 9000
  }).catch((error) => {
    console.warn('PFA answer not carried to the sender', { reference, message: error && error.message });
    return { state: 'unsent', to };
  });
  const answerId = `${id}-answer`;
  try {
    await ref.collection('messages').doc(answerId).create({
      id: answerId, seq: ORDER.nextSeq(), type: 'email', direction: 'out', party: 'site', to,
      from: o.mail.sender ? o.mail.sender().address : '',
      subject: `Re: ${reference}: ${payload.kindLabel}`,
      text: "PFA's reply sent on to them.", state: sent.state,
      messageId: (o.mail.threadHeaders ? o.mail.threadHeaders(payload, `answer.${n}`, 'confirm').messageId : ''),
      at: recordedAt
    });
  } catch (_) { /* it went or is queued; the note is a courtesy */ }
  try { await ref.collection('messages').doc(id).update({ answer: sent.state }); } catch (_) { /* the queue has it either way */ }
  return sent;
}

/* Files one message. Returns what happened:
     { filed: true, reference, party, how, attachments, relayed, auto?, status }
     { filed: true, bounce: true, reference, to, reason }
     { filed: false, reason: 'NO_SENDER' | 'NO_THREAD' | 'DUPLICATE' | 'BOUNCE_UNMATCHED' } */
async function file(db, raw, options) {
  const o = options || {};
  /* Every mailbox that receives copies, to know a reply from staff; the
     record's own route, once it is found, for anything sent on (a record of
     money goes to the payments inboxes, never the forms inbox). */
  const inboxes = o.inboxes || FORWARD.allInboxes();
  const nowMs = o.now ? o.now() : Date.now();
  const msg = raw && raw.newText !== undefined && raw.date instanceof Date ? raw : normalise(raw);
  if (!msg.from) return { filed: false, reason: 'NO_SENDER' };
  if (msg.bounce) return fileBounce(db, msg, o, inboxes, nowMs);
  const found = await matchThread(db, msg, inboxes);
  if (!found) return { filed: false, reason: 'NO_THREAD', messageId: msg.messageId };

  const { reference, data } = found;
  const party = partyOf(msg, data, inboxes);
  /* where the person's own words are carried: a caregiver application's to
     the forms inbox, with the application; a record of money's to the
     payments inboxes */
  const route = o.inboxes || FORWARD.relayInboxes(data);
  const auto = msg.autoReply || '';
  const ref = db.collection('submissions').doc(reference);
  const id = messageDocId(msg);
  const msgRef = ref.collection('messages').doc(id);
  const recordedAt = new Date(nowMs).toISOString();
  const wantsRelay = party === 'sender' && !auto && Boolean(o.mail) && route.length > 0;
  /* PFA answering goes the other way: on to the person who wrote in. An
     automatic reply (out of office) is filed and carried no further. */
  const wantsAnswer = party === 'staff' && !auto && Boolean(o.mail);

  /* attachments first, so the message that names them is written complete;
     an automatic reply's (a signature logo, a banner) are listed, not kept */
  const files = Array.isArray(msg.attachments) ? msg.attachments : [];
  const kept = auto
    ? files.map((a, i) => ({ n: i + 1, filename: a.filename, contentType: a.contentType, size: a.bytes.length, stored: false, why: 'automatic reply' }))
    : await keepAttachments(ref, reference, id, files, recordedAt);

  const message = {
    id,
    type: 'reply',
    direction: 'in',
    party,
    from: msg.from,
    fromName: msg.fromName,
    to: msg.to,
    cc: msg.cc,
    subject: msg.subject,
    text: msg.newText || msg.text,
    fullText: msg.text,
    at: recordedAt,
    recordedAt,
    sentAt: msg.date.toISOString(),
    messageId: msg.messageId,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    matchedBy: found.how,
    attachments: kept.filter((f) => f.stored).length,
    files: kept,
    by: msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from
  };
  if (auto) message.auto = auto;

  /* The message and the record's move, in one transaction that re-reads
     the record. update(), never a merge, and never the fields. */
  const fv = o.fieldValue || require('./firebase').fieldValue;
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const mine = await tx.get(msgRef);
    if (mine.exists) return { duplicate: true, existing: mine.data() || {} };
    if (!snap.exists) return { gone: true };
    const d = snap.data() || {};
    if (found.how === 'headers' && d.threadId !== found.threadId) return { gone: true };
    const from = FLOW.currentOf(d);
    const by = msg.from;
    const rows = [];
    const update = { updatedAt: recordedAt };
    let next = from;
    let n = 0;
    if (auto) {
      rows.push({ status: from, event: 'auto-reply', direction: 'in', party, at: recordedAt, by });
    } else {
      update.replyCount = fv().increment(1);
      update.lastReplyAt = recordedAt;
      /* Who owes the next word, for the register's "Wrote back" marker: a
         record kept in the panel only (lib/submission-forward.js
         PANEL_ONLY_KINDS) reaches no inbox, so the panel is the only place
         a person's answer can be noticed (21 Oct 2026). */
      if (party === 'sender') { update.awaitingReply = true; update.lastInboundAt = recordedAt; } else if (party === 'staff') update.awaitingReply = false;
      const takeUp = party === 'staff' && from === 'new' ? FLOW.takeUpStatus(d.kind) : null;
      const reopen = party === 'sender' && !FLOW.flowOf(d.kind).staged && from === 'handled';
      if (takeUp) {
        next = takeUp;
        Object.assign(update, { status: next, handledBy: by, handledAt: recordedAt });
        rows.push({ status: next, at: recordedAt, by });
        rows.push({ status: next, event: 'reply', direction: 'in', party, at: recordedAt, by });
      } else if (reopen) {
        next = 'new';
        Object.assign(update, { status: next, handledBy: '', handledAt: null, handledNote: '', closes: fv().arrayUnion(FLOW.closeOf(d, from)) });
        rows.push({ status: from, event: 'reply', direction: 'in', party, at: recordedAt, by });
        rows.push({ status: next, event: 'reopen', reason: 'sender-replied', at: recordedAt, by });
      } else {
        rows.push({ status: from, event: 'reply', direction: 'in', party, at: recordedAt, by });
      }
      if (wantsRelay) {
        n = Math.max(Number(d.relayN) || 0, Number(d.replyCount) || 0) + 1;
        update.relayN = n;
      }
    }
    update.history = fv().arrayUnion(...rows);
    tx.create(msgRef, Object.assign({ seq: ORDER.nextSeq() }, message, wantsRelay ? { relay: 'pending', relayN: n } : {}));
    tx.update(ref, update);
    return { created: true, data: d, from, next, n };
  });

  if (out.gone) return { filed: false, reason: 'NO_THREAD', messageId: msg.messageId };
  if (out.duplicate) {
    /* Filed by an earlier reading that stopped before relaying it: the relay
       is sent now (the queue's key makes a second send impossible). */
    const e = out.existing;
    if (e.relay === 'pending' && wantsRelay) {
      const snap = await ref.get();
      await relay(ref, { reference, data: snap.data() || data, msg, id, kept: e.files || [], n: Number(e.relayN) || 1, recordedAt: e.recordedAt || recordedAt }, o, route);
    }
    return { filed: false, reason: 'DUPLICATE', reference, messageId: msg.messageId };
  }

  let relayed = [];
  if (wantsRelay) relayed = await relay(ref, { reference, data: out.data, msg, id, kept, n: out.n, recordedAt }, o, route);
  let answered = null;
  if (wantsAnswer) answered = await answer(ref, { reference, data: out.data, msg, id, n: out.n, recordedAt }, o);

  return Object.assign(
    { filed: true, reference, party, how: found.how, attachments: message.attachments, relayed: relayed.map((r) => r.state), status: out.next },
    answered ? { answered: answered.state, answeredTo: answered.to } : {},
    auto ? { auto } : {},
    out.next !== out.from ? { moved: { from: out.from, to: out.next } } : {}
  );
}

/* ---- the mailbox ----------------------------------------------------- */

/* Which server and which login: lib/imap-open.js, shared with the Sent
   folder copies. GoDaddy's imap.secureserver.net first (8 Oct 2026). */
function imapConfigured() { return IMAP.configured(); }
function imapHosts() { return IMAP.hosts(); }

let makeClient = (options) => {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow(options);
};
let parseSource = (source) => require('mailparser').simpleParser(source);

/* The Message-ID of a message that could not be parsed, so the problem line
   can name it. */
function idInSource(source) {
  const head = Buffer.isBuffer(source) ? source.slice(0, 64 * 1024).toString('utf8') : String(source || '').slice(0, 64 * 1024);
  const m = /^message-id:[ \t]*(<[^<>\s]+>)/im.exec(head);
  return m ? m[1] : '';
}

/* Reads what has arrived since the last run: new UIDs in INBOX, at most
   `limit` of them. The first run looks back `firstRunDays`. Each message is
   fetched and parsed on its own (8 Oct 2026): one that cannot be fetched or
   parsed is reported in `failed` and the others are still read; before,
   one bad message threw away the whole batch on every run, for ever.
   Returns the messages, parsed, the UIDs looked at, and the failures. */
async function readMailbox({ lastUid, uidValidity, limit, firstRunDays }) {
  /* tries each server; throws with what each said */
  const { client, host } = await IMAP.open(makeClient).catch((error) => {
    error.message = `Mailbox could not be read. ${error.message}`.slice(0, 400);
    throw error;
  });
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const box = client.mailbox || {};
      const validity = box.uidValidity != null ? String(box.uidValidity) : '';
      /* a mailbox rebuilt by the provider renumbers everything; start over,
         and the per-message ids keep anything already filed from doubling */
      const since = uidValidity && validity && uidValidity !== validity ? 0 : Number(lastUid) || 0;
      let uids;
      if (since > 0) {
        uids = (await client.search({ uid: `${since + 1}:*` }, { uid: true }) || []).filter((u) => u > since);
      } else {
        const from = new Date(Date.now() - (Number(firstRunDays) || 14) * 86400000);
        uids = await client.search({ since: from }, { uid: true }) || [];
      }
      uids = uids.sort((a, b) => a - b).slice(0, limit || 40);
      const messages = [];
      const failed = [];
      let highest = since;
      for (const uid of uids) {
        if (uid > highest) highest = uid;
        let fetched;
        try {
          fetched = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
        } catch (error) {
          failed.push({ uid, stage: 'fetch', error: `Could not be fetched: ${IMAP.said(error)}`.slice(0, 200) });
          continue;
        }
        if (!fetched || !fetched.source) continue;   // gone between the search and the fetch: nothing to file
        try {
          const parsed = await parseSource(fetched.source);
          messages.push(Object.assign(normalise(parsed), { uid }));
        } catch (error) {
          failed.push({ uid, stage: 'parse', messageId: idInSource(fetched.source), error: `Could not be read: ${String(error && error.message)}`.slice(0, 200) });
        }
      }
      return { messages, failed, uids, lastUid: highest, uidValidity: validity, host };
    } finally {
      lock.release();
    }
  } catch (error) {
    /* Opened, then refused: that is this mailbox's answer, reported as it is. */
    const wrapped = new Error(`Mailbox could not be read: ${host} answered ${IMAP.said(error)}`.slice(0, 400));
    wrapped.code = (error && error.code) || 'IMAP_FAILED';
    wrapped.authentication = false;
    throw wrapped;
  } finally {
    try { await client.logout(); } catch (_) { /* already gone */ }
  }
}

/* The line the panel shows while anything is set aside. */
function problemLine(parked, nowMs) {
  const recent = (parked || []).filter((p) => (nowMs - (Date.parse(p.parkedAt) || 0)) < PROBLEM_DAYS * 86400000);
  if (!recent.length) return '';
  const last = recent[recent.length - 1];
  return `${recent.length === 1 ? 'One email' : `${recent.length} emails`} could not be filed after ${PARK_AFTER} tries and ${recent.length === 1 ? 'was' : 'were'} set aside. The latest: ${last.messageId || `message ${last.uid}`}: ${last.error}. Look for it in the mailbox and add what it says to the case by hand.`;
}

/* One run: read the mailbox, file what belongs to a record, remember where
   the reading got to.

   Where the reading got to (8 Oct 2026): the position moves past a message
   only once it has been filed or deliberately left (not about a submission,
   a duplicate, a bounce or an automatic reply). A message whose fetching,
   parsing or filing failed holds the position, so the next run reads it
   again; its tries are counted in `failing`, and after PARK_AFTER it is set
   aside in `parked` with a problem line the panel shows, and the position
   moves on. Until then a Firestore hiccup while filing a reply skipped it
   for good. Never throws for a message; a mailbox that cannot be reached is
   reported, not hidden. */
async function check(db, options) {
  const o = options || {};
  const nowMs = o.now ? o.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const stateRef = db.collection('counters').doc(STATE_DOC);
  const snap = await stateRef.get();
  const state = snap.exists ? snap.data() || {} : {};
  const summary = { fetched: 0, filed: 0, duplicates: 0, unmatched: 0, relayed: 0, autoReplies: 0, bounces: 0, problems: [], parked: 0, lastUid: Number(state.lastUid) || 0 };
  const read = o.read || readMailbox;
  let box;
  try {
    box = await read({ lastUid: state.lastUid, uidValidity: state.uidValidity, limit: o.limit, firstRunDays: o.firstRunDays });
  } catch (error) {
    summary.error = String(error && error.message || error);
    summary.authentication = Boolean(error && error.authentication);
    await stateRef.set(Object.assign({}, state, { lastRunAt: nowIso, lastError: summary.error }));
    return summary;
  }

  const sameBox = !(state.uidValidity && box.uidValidity && String(state.uidValidity) !== String(box.uidValidity));
  const failing = sameBox && state.failing && typeof state.failing === 'object' ? Object.assign({}, state.failing) : {};
  const parked = sameBox && Array.isArray(state.parked) ? state.parked.slice() : [];
  const start = sameBox ? Number(state.lastUid) || 0 : 0;
  const settled = new Map();   // uid -> true (done with) | false (read it again)

  /* Counts a failure; resolves to true once the message is set aside. */
  const failed = (uid, messageId, stage, error) => {
    const key = String(uid);
    const prev = failing[key] || { count: 0, firstAt: nowIso };
    const entry = {
      uid, messageId: messageId || prev.messageId || '', stage,
      error: String((error && error.message) || error || 'failed').slice(0, 200),
      count: (Number(prev.count) || 0) + 1, firstAt: prev.firstAt || nowIso, lastAt: nowIso
    };
    if (entry.count >= PARK_AFTER) {
      delete failing[key];
      parked.push(Object.assign({}, entry, { parkedAt: nowIso }));
      summary.parked += 1;
      summary.problems.push({ uid, messageId: entry.messageId, message: `Set aside after ${entry.count} tries: ${entry.error}`, parked: true });
      return true;
    }
    failing[key] = entry;
    summary.problems.push({ uid, messageId: entry.messageId, message: entry.error, attempts: entry.count });
    return false;
  };

  for (const f of box.failed || []) settled.set(f.uid, failed(f.uid, f.messageId, f.stage || 'fetch', f.error));
  summary.fetched = (box.messages || []).length;
  for (const msg of box.messages || []) {
    try {
      const out = await file(db, msg, o);
      if (out.filed) {
        summary.filed += 1;
        if (out.bounce) summary.bounces += 1;
        if (out.auto) summary.autoReplies += 1;
        if ((out.relayed || []).length) summary.relayed += 1;
      } else if (out.reason === 'DUPLICATE') summary.duplicates += 1;
      else summary.unmatched += 1;
      if (msg.uid != null) { settled.set(msg.uid, true); delete failing[String(msg.uid)]; }
    } catch (error) {
      if (msg.uid != null) settled.set(msg.uid, failed(msg.uid, msg.messageId, 'file', error));
      else summary.problems.push({ messageId: msg.messageId, message: String(error && error.message).slice(0, 200) });
    }
  }

  /* The position: up to the first message that must be read again. A UID
     looked at with nothing to read (gone before it was fetched) is done. */
  const uids = (Array.isArray(box.uids) && box.uids.length ? box.uids : [...settled.keys()]).slice().sort((a, b) => a - b);
  let lastUid = start;
  if (uids.length) {
    for (const uid of uids) {
      if (settled.get(uid) === false) break;
      if (uid > lastUid) lastUid = uid;
    }
  } else if (!summary.problems.length) {
    lastUid = Math.max(start, Number(box.lastUid) || 0);
  }
  summary.lastUid = lastUid;
  summary.waiting = Object.keys(failing).length;
  summary.problem = problemLine(parked, nowMs);

  await stateRef.set(Object.assign({}, state, {
    lastUid, uidValidity: box.uidValidity || '', host: box.host || '',
    lastRunAt: nowIso, lastError: '',
    lastResult: { fetched: summary.fetched, filed: summary.filed, unmatched: summary.unmatched, duplicates: summary.duplicates, autoReplies: summary.autoReplies, bounces: summary.bounces, problems: summary.problems.length },
    failing, parked: parked.slice(-KEEP_PARKED)
  }));
  return summary;
}

async function status(db) {
  const snap = await db.collection('counters').doc(STATE_DOC).get();
  const s = snap.exists ? snap.data() || {} : {};
  return {
    configured: imapConfigured(),
    mailbox: String(process.env.PFA_IMAP_USER || process.env.PFA_SMTP_USER || '').trim().toLowerCase(),
    captureOff: /^off$/i.test(String(process.env.PFA_CAPTURE_REPLIES || '').trim()),
    lastRunAt: s.lastRunAt || null, lastError: s.lastError || '', lastResult: s.lastResult || null, lastUid: Number(s.lastUid) || 0,
    /* to be read again on the next run, and set aside for good */
    waiting: Object.values(s.failing || {}),
    parked: (Array.isArray(s.parked) ? s.parked : []).slice(-10),
    problem: problemLine(s.parked, Date.now())
  };
}

module.exports = {
  normalise, newText, matchThread, partyOf, file, check, status, readMailbox, imapConfigured, imapHosts, messageDocId,
  autoReplyOf: (headers) => autoReplyOf(headerReader({ headers })), bounceOf, PARK_AFTER,
  _setClient: (fn) => { makeClient = fn || ((options) => { const { ImapFlow } = require('imapflow'); return new ImapFlow(options); }); },
  _setParser: (fn) => { parseSource = fn || ((source) => require('mailparser').simpleParser(source)); }
};
