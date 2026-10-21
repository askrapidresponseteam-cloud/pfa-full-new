'use strict';

/* One search box for the whole admin panel (owner, 8 Oct 2026: "there needs
   to be a univeral/global search bar to search anything and everything").

   What it finds: cases (every submission, by its number, the sender's name,
   email or mobile, anything they wrote, and anything said in its
   conversation: replies, notes, emails), payments (order, name, email,
   mobile, bank and tracking references), colony caregiver cards, emails the
   site sent or tried to send, and the audit log. Panel sections and the
   public site's pages are matched in the browser (admin.html); staff
   accounts are matched at search time (lib/routes/admin/search.js).

   Why an index (owner, same evening: costs must stay low). Firestore has no
   text search, and reading every case and payment for every search would
   cost thousands of reads per search. So each record gets one small
   document in `adminSearch` holding the words it can be found by (`terms`),
   and a search is one query on that array: a few dozen reads, however many
   records there are. The index is server-only (firestore.rules closes it).

   Words, two kinds:
     - names, numbers, emails, mobiles, references: every prefix too, so a
       result shows while the word is still being typed ("asha", "98765",
       "pfa-q-2026-000");
     - free text (what a report says, a reply, a note): whole words only,
       which keeps a long report to a few hundred entries.

   Newest first without a composite index: a document's id starts with its
   creation time counted backwards, and Firestore returns an unordered
   query by document id, so the first matches it returns are the newest.

   Kept current by sync(): each source is read from where the last run
   stopped, by a field every write moves (receivedAtMs and updatedAt on a
   case, updatedAt on a payment, a card and an email, atMs on the log). It
   runs every ten minutes on Firebase (functions/index.js) and before a
   search whenever the last run is more than a minute old, so a case changed
   a moment ago is found as it is now. Nothing is ever deleted: records are
   never deleted either. */

const crypto = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');
const S = require('./submissions');
const FLOW = require('./case-flow');

const INDEX = 'adminSearch';
const META = ['adminSearchMeta', 'state'];
/* Raise when the way terms are made changes: the next sync re-reads every
   source from the start and rewrites every entry. */
const VERSION = 2;
const PAGE = 100;
const MESSAGES_PER_CASE = 100;
const MAX_TEXT_WORDS = 400;
const MAX_TERMS = 3000;
const STALE_MS = 60 * 1000;

const EMAIL_WHAT = {
  submission_received: 'Confirmation to the sender',
  submission_forward: 'Copy to PFA\'s inbox',
  submission_followup: 'Their reply, relayed to PFA\'s inbox',
  submission_reply: 'Reply from staff',
  payment_received: 'Donation receipt',
  membership_welcome: 'Membership welcome letter',
  caregiver_application_received: 'Application confirmation',
  shop_order_confirmed: 'Shop order confirmation',
  shop_order_staff: 'Shop order, to staff',
  card_issued: 'Caregiver card',
  shipping_paid: 'Printed card paid',
  shipment_update: 'Delivery update',
  staff_invite: 'Panel access',
  inbox_test: 'Test email'
};
const PAYMENT_WHAT = {
  donate: 'Donation', caregiver: 'Colony card postage', 'caregiver-application': 'Caregiver application fee',
  membership: 'Membership', shop: 'Shop order'
};
const PAYMENT_STATUS = {
  success: 'Paid', failed: 'Failed', aborted: 'Abandoned', cancelled: 'Cancelled', pending: 'Awaited',
  initiated: 'Started', verification_failed: 'Unverified'
};

/* Words that would match nearly everything and say nothing. */
const STOP = new Set(('the and for with from that this was are were has have had not but you your our they them their '
  + 'his her she him its into onto out off over under about there here what when where which who whom why how '
  + 'all any can could would should will shall may might must been being also very just than then too').split(' '));

/* ---- words ------------------------------------------------------------ */

function fold(value) {
  return String(value == null ? '' : value).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* Letters, their marks and digits, in any script: a report in Hindi is
   searchable in Hindi (Devanagari vowel signs are marks, not letters, and
   without \p{M} "कुत्ता" fell apart into single letters). */
function wordsOf(value) {
  return fold(value).match(/[\p{L}\p{M}\p{N}]+/gu) || [];
}

function prefixes(word, min, max) {
  const out = [];
  for (let n = min; n <= Math.min(word.length, max); n += 1) out.push(word.slice(0, n));
  return out;
}

/* Spelling forgiven (owner, 21 Oct 2026: "there should be a google grade
   global search"). A name, a place, a label or the front of an email is
   also stored as "~" and each way of dropping one letter from it ("karthik"
   gives ~karthik, ~arthik, ~krthik ... ~karthi), and a search that finds
   nothing asks for the word typed and its own one-letter drops the same
   way. Two words share an entry exactly when one letter is missing, added,
   changed or swapped between them, so "karthk", "kartihk" and "karthek"
   all find Karthik, in one query, without reading anything more. Only
   words of 4 to 20 letters, and not free text, so a record gains a few
   dozen entries at most. */
const NEAR_MIN = 4;
const NEAR_MAX = 20;
function drops(word) {
  const out = new Set([word]);
  for (let i = 0; i < word.length; i += 1) out.add(word.slice(0, i) + word.slice(i + 1));
  return [...out];
}
function nearKeys(word) {
  if (word.length < NEAR_MIN || word.length > NEAR_MAX || /^\d+$/.test(word)) return [];
  return drops(word).map((d) => `~${d}`);
}
/* true when a and b are one letter apart (dropped, added, changed or two
   swapped), or equal */
function oneOff(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff = [];
    for (let i = 0; i < la; i += 1) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s1, s2] = la < lb ? [a, b] : [b, a];
  for (let i = 0; i < s2.length; i += 1) if (s2.slice(0, i) + s2.slice(i + 1) === s1) return true;
  return false;
}

function mobileOf(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return '';
  const ten = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(ten) ? ten : '';
}

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* A term set being built for one record. */
function bag() {
  const terms = new Set();
  let textWords = 0;
  const api = {
    add(term) { if (term && term.length >= 1 && terms.size < MAX_TERMS) terms.add(term); return api; },
    /* a name, a place, a label: each word and its beginnings */
    name(value) { wordsOf(value).forEach((w) => { prefixes(w, 1, 15).forEach(api.add); nearKeys(w).forEach(api.add); }); return api; },
    /* a number or reference: whole, its beginnings, its parts, and its
       number without the leading zeros (PFA-Q-2026-00042 is also "42") */
    id(value) {
      const v = fold(value).replace(/\s+/g, '');
      if (!v) return api;
      prefixes(v, 2, 40).forEach(api.add);
      v.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).forEach((part) => {
        prefixes(part, 1, 20).forEach(api.add);
        if (/^0+\d+$/.test(part)) api.add(part.replace(/^0+/, ''));
      });
      return api;
    },
    email(value) {
      const v = fold(value).trim();
      if (!EMAILISH.test(v)) return api.name(value);
      prefixes(v, 2, 60).forEach(api.add);
      const [local, domain] = v.split('@');
      wordsOf(local).forEach((w) => { prefixes(w, 1, 15).forEach(api.add); nearKeys(w).forEach(api.add); });
      api.add(domain);
      wordsOf(domain).forEach((w) => prefixes(w, 2, 15).forEach(api.add));
      return api;
    },
    mobile(value) {
      const m = mobileOf(value);
      if (!m) return api;
      prefixes(m, 3, 10).forEach(api.add);
      for (let n = 4; n <= 9; n += 1) api.add(m.slice(-n));   // the last digits, as said on the phone
      return api;
    },
    /* a contact field: an email, a mobile, or (an unusual value) its words */
    contact(value) {
      const v = String(value == null ? '' : value).trim();
      if (!v) return api;
      if (v.includes('@')) return api.email(v);
      if (mobileOf(v)) return api.mobile(v);
      return api.name(v);
    },
    /* free text: whole words, with a plural's singular */
    text(value) {
      for (const w of wordsOf(value)) {
        if (textWords >= MAX_TEXT_WORDS) break;
        if (w.length < 2 || STOP.has(w)) continue;
        if (!terms.has(w)) { api.add(w); textWords += 1; }
        if (w.length > 4 && w.endsWith('s')) api.add(w.slice(0, -1));
        const m = mobileOf(w);
        if (m) api.mobile(m);
      }
      return api;
    },
    list: () => [...terms]
  };
  return api;
}

/* ---- what each record is found by -------------------------------------- */

function millis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
}

const NAME_FIELD = /^(name|fullname|full ?name|your ?name|contact ?name|first ?name|last ?name|applicant|holder)$/i;
const PLACE_FIELD = /^(city|district|state|pin|pincode|location|area|colony|address|town|village)$/i;

function caseEntity(reference, data, messages) {
  const d = data || {};
  const kind = d.kind || '';
  const fields = d.fields || {};
  const t = bag().id(reference).id(kind).name(d.kindLabel || S.KIND_LABELS[kind] || '');
  let name = '';
  let email = '';
  Object.keys(fields).forEach((key) => {
    const value = fields[key];
    if (value == null || typeof value === 'object') return;
    const text = String(value);
    if (S.isContactField(key)) {
      t.contact(text);
      if (!email && text.includes('@')) email = text.trim();
    } else if (NAME_FIELD.test(key.replace(/[_-]+/g, ' ').trim())) {
      t.name(text);
      if (!name) name = text.trim();
    } else if (PLACE_FIELD.test(key.replace(/[_-]+/g, ' ').trim())) {
      t.name(text);
    } else if (/^(orderid|order|cardid|memberid|reference|bankreference)$/i.test(key.replace(/[\s_-]+/g, ''))) {
      t.id(text);
    } else {
      t.text(text);
    }
  });
  /* currentOf reads any status outside the flows as 'new', which would
     re-index a removed record as Waiting and hand it straight back to the
     search that is supposed to have let it go. */
  const status = d.status === 'removed' ? 'removed' : FLOW.currentOf(d);
  const statusLabel = FLOW.labelOf(kind, status);
  t.name(statusLabel).name(d.page || '');
  if (d.cardId) t.id(d.cardId);
  if (d.payment && d.payment.orderId) t.id(d.payment.orderId);
  [d.assignedTo && (d.assignedTo.email || d.assignedTo), d.handledBy].forEach((who) => { if (typeof who === 'string' && who) t.contact(who); });
  t.text(d.handledNote || '');
  (Array.isArray(d.closes) ? d.closes : []).forEach((c) => t.text(c && c.note));
  (messages || []).forEach((m) => {
    t.text(m.text || '').text(m.subject || '');
    [m.from, m.to, m.by].forEach((who) => { if (typeof who === 'string' && who.includes('@')) t.email(who.replace(/^.*<|>.*$/g, '')); });
    (Array.isArray(m.files) ? m.files : []).forEach((f) => t.text(f && (f.filename || f.name)));
  });
  const who = name || (S.contactOf ? (S.contactOf(fields).name || '') : '') || email;
  return {
    type: 'case',
    id: reference,
    module: 'submissions',
    title: reference,
    line: `${d.kindLabel || S.KIND_LABELS[kind] || 'Submission'}${who ? ` from ${who}` : ''}`,
    status: statusLabel,
    statusKey: status,
    kind,
    at: Number(d.receivedAtMs) || millis(d.createdAt),
    terms: t.list()
  };
}

function paymentEntity(orderId, data) {
  const d = data || {};
  const c = d.customer || {};
  const meta = d.metadata || {};
  const cca = d.ccaVenue || {};
  const what = PAYMENT_WHAT[d.type] || d.type || 'Payment';
  const t = bag().id(orderId).name(what).name(c.name).contact(c.email).contact(c.mobile)
    .name([c.city, c.district, c.state].filter(Boolean).join(' '))
    .id(cca.trackingId).id(cca.bankReference)
    .id(d.memberId || meta.memberId).id(d.cardId || meta.cardId)
    .id(d.recordReference).id(d.donationReference).id(d.membershipReference).id(d.applicationReference)
    .name(PAYMENT_STATUS[d.status] || d.status || '');
  ['giftName', 'giftEmail', 'giftMobile', 'pan', 'tierLabel', 'purpose', 'note', 'message', 'inMemoryOf', 'animal'].forEach((k) => {
    const v = meta[k];
    if (v == null || typeof v === 'object') return;
    if (/email|mobile/i.test(k)) t.contact(v);
    else if (k === 'pan') t.id(v);
    else t.text(v);
  });
  if (d.amount != null) t.add(String(Math.round(Number(d.amount) || 0)));
  const amount = Number(d.amount) || 0;
  const money = `${String(d.currency || 'INR').toUpperCase() === 'USD' ? '$' : '₹'}${amount.toLocaleString('en-IN')}`;
  return {
    type: 'payment',
    id: orderId,
    module: 'payments',
    title: orderId,
    line: `${what}, ${money}${c.name ? `, ${c.name}` : ''}`,
    status: PAYMENT_STATUS[d.status] || d.status || '',
    at: millis(d.createdAt),
    terms: t.list()
  };
}

function cardEntity(cardId, data) {
  const d = data || {};
  const t = bag().id(cardId).name(d.name).contact(d.mobile).contact(d.email)
    .name([d.district, d.state, d.city, d.pin].filter(Boolean).join(' ')).text(d.colony || d.address || '')
    .id(d.applicationRef || '').name(d.printed ? 'printed' : 'not printed');
  return {
    type: 'card',
    id: cardId,
    module: 'caregivers',
    title: cardId,
    line: `Colony caregiver card${d.name ? `, ${d.name}` : ''}${d.district ? `, ${d.district}` : ''}`,
    status: d.revoked ? 'Revoked' : d.printed ? 'Printed' : 'Issued',
    at: millis(d.createdAt) || millis(d.issuedAt),
    terms: t.list()
  };
}

function emailEntity(id, data) {
  const d = data || {};
  const p = d.payload || {};
  const what = EMAIL_WHAT[d.template] || d.template || 'Email';
  const reference = p.reference || p.applicationRef || p.memberId || p.orderId || p.cardId || '';
  const status = d.bounced ? 'Not delivered' : { sent: 'Sent', failed: 'Did not go', retry: 'Retrying', queued: 'Waiting', sending: 'Sending' }[d.status] || d.status || '';
  const t = bag().name(what).contact(d.to).id(reference).name(status).name('email').text(d.lastError || '');
  return {
    type: 'email',
    id,
    module: 'submissions',
    title: `${what} to ${d.to || 'nobody'}`,
    line: reference ? `About ${reference}` : '',
    status,
    at: millis(d.createdAt),
    terms: t.list()
  };
}

function auditEntity(id, data) {
  const d = data || {};
  const actor = (d.actor && (d.actor.email || d.actor.name)) || '';
  const t = bag().contact(actor).name(d.actor && d.actor.name).name(d.action).name(d.module).text(d.detail || '').name(d.outcome);
  if (d.subject) { if (/@/.test(d.subject)) t.email(d.subject); else t.id(d.subject); }
  return {
    type: 'audit',
    id,
    module: 'people',
    title: `${d.action || 'Action'}${d.subject ? ` ${d.subject}` : ''}`,
    line: `${actor}${d.detail ? `: ${String(d.detail).slice(0, 120)}` : ''}`,
    status: d.outcome === 'refused' ? 'Refused' : '',
    at: Number(d.atMs) || millis(d.at),
    terms: t.list()
  };
}

/* The index document's id: newest first by name, stable for the record. */
function docIdOf(entity) {
  const at = Math.max(0, Math.min(Number(entity.at) || 0, 9e15));
  const back = String(9e15 - at).padStart(16, '0');
  const tag = crypto.createHash('sha256').update(`${entity.type}:${entity.id}`, 'utf8').digest('hex').slice(0, 16);
  return `${back}-${entity.type}-${tag}`;
}

function stored(entity) {
  return Object.assign({}, entity, { v: VERSION, indexedAt: new Date().toISOString() });
}

/* ---- keeping it current ----------------------------------------------- */

const SOURCES = [
  { key: 'cases', collection: 'submissions', field: 'receivedAtMs', as: 'number' },
  { key: 'casesChanged', collection: 'submissions', field: 'updatedAt', as: 'iso' },
  { key: 'payments', collection: 'transactions', field: 'updatedAt', as: 'timestamp' },
  { key: 'cards', collection: 'caretakerCards', field: 'updatedAt', as: 'timestamp' },
  { key: 'emails', collection: 'caregiverEmails', field: 'updatedAt', as: 'timestamp' },
  { key: 'audit', collection: 'adminAudit', field: 'atMs', as: 'number' }
];

function markOf(source, value) {
  if (source.as === 'iso') return typeof value === 'string' ? value : null;
  if (source.as === 'number') return Number.isFinite(Number(value)) ? Number(value) : null;
  return value && typeof value.toMillis === 'function' ? value.toMillis() : null;
}

function queryFrom(source, mark) {
  if (source.as === 'iso') return mark == null ? '' : String(mark);
  if (source.as === 'number') return mark == null ? -1 : Number(mark);
  return Timestamp.fromMillis(mark == null ? 0 : Number(mark));
}

async function entityFor(db, source, doc) {
  const data = doc.data() || {};
  if (source.collection === 'submissions') {
    let messages = [];
    try {
      const snap = await doc.ref.collection('messages').orderBy('at', 'desc').limit(MESSAGES_PER_CASE).get();
      messages = snap.docs.map((m) => m.data() || {});
    } catch (_) { messages = []; }
    return caseEntity(doc.id, data, messages);
  }
  if (source.collection === 'transactions') return paymentEntity(data.orderId || doc.id, data);
  if (source.collection === 'caretakerCards') return cardEntity(doc.id, data);
  if (source.collection === 'caregiverEmails') return emailEntity(doc.id, data);
  return auditEntity(doc.id, data);
}

/* One page of one source, from its mark. Resolves to the new mark and
   whether more is waiting. A record already indexed at exactly the mark is
   not written again. */
async function syncPage(db, source, mark) {
  const from = mark || { value: null, ids: [] };
  const snap = await db.collection(source.collection)
    .where(source.field, '>=', queryFrom(source, from.value))
    .orderBy(source.field)
    .limit(PAGE)
    .get();
  const docs = snap.docs || [];
  const seen = new Set(from.ids || []);
  let value = from.value;
  let ids = (from.ids || []).slice();
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const doc of docs) {
    const v = markOf(source, doc.get(source.field));
    if (v === null) continue;
    if (v === from.value && seen.has(doc.id)) continue;
    const entity = await entityFor(db, source, doc);
    batch.set(db.collection(INDEX).doc(docIdOf(entity)), stored(entity));
    inBatch += 1;
    written += 1;
    if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    if (v !== value) { value = v; ids = []; }
    ids.push(doc.id);
  }
  if (inBatch) await batch.commit();
  return { mark: { value, ids: ids.slice(-PAGE) }, more: docs.length >= PAGE && written > 0, written };
}

function later(a, b) {
  if (!a || a.value == null) return b;
  if (!b || b.value == null) return a;
  if (a.value === b.value) return { value: a.value, ids: [...new Set([...(a.ids || []), ...(b.ids || [])])].slice(-PAGE) };
  return a.value > b.value ? a : b;
}

let running = null;

/* Brings the index up to date, within a time budget. Two runs at once (the
   schedule and a search) only do the same idempotent writes twice; the
   marks only ever move forward. */
async function sync(db, options) {
  if (running) return running;
  const o = options || {};
  const budgetMs = Number(o.budgetMs) || 20000;
  const started = Date.now();
  running = (async () => {
    const metaRef = db.collection(META[0]).doc(META[1]);
    const metaSnap = await metaRef.get();
    let meta = metaSnap.exists ? metaSnap.data() || {} : {};
    if (meta.v !== VERSION) meta = { v: VERSION, marks: {} };
    const marks = Object.assign({}, meta.marks || {});
    let written = 0;
    let complete = true;
    for (const source of SOURCES) {
      for (;;) {
        if (Date.now() - started > budgetMs) { complete = false; break; }
        let page;
        try {
          page = await syncPage(db, source, marks[source.key]);
        } catch (error) {
          console.warn('admin search: a source could not be read', { source: source.key, message: String(error && error.message).slice(0, 160) });
          complete = false;
          break;
        }
        marks[source.key] = page.mark;
        written += page.written;
        if (!page.more) break;
      }
    }
    await db.runTransaction(async (tx) => {
      const now = await tx.get(metaRef);
      const was = now.exists ? now.data() || {} : {};
      const merged = {};
      for (const source of SOURCES) {
        merged[source.key] = was.v === VERSION ? later((was.marks || {})[source.key], marks[source.key]) : marks[source.key];
      }
      tx.set(metaRef, { v: VERSION, marks: merged, syncedAt: Date.now(), complete });
    });
    return { written, complete };
  })();
  try { return await running; } finally { running = null; }
}

async function syncIfStale(db, options) {
  try {
    const snap = await db.collection(META[0]).doc(META[1]).get();
    const meta = snap.exists ? snap.data() || {} : {};
    if (meta.v === VERSION && Date.now() - Number(meta.syncedAt || 0) < STALE_MS) return { skipped: true };
    return await sync(db, options);
  } catch (error) {
    console.warn('admin search: index not brought up to date before a search', String(error && error.message).slice(0, 160));
    return { failed: true };
  }
}

/* ---- searching -------------------------------------------------------- */

/* What was typed, as the index's words. A mobile typed with spaces or +91 is
   one number; an email or a reference stays whole. */
function tokensOf(q) {
  const raw = fold(q).trim();
  if (!raw) return [];
  const squeezed = raw.replace(/[\s()+.-]/g, '');
  if (/^\d{7,13}$/.test(squeezed) && /^[\d\s()+.-]+$/.test(raw)) {
    return [mobileOf(squeezed) || squeezed.slice(-10)];
  }
  const out = [];
  for (const piece of raw.split(/\s+/)) {
    if (!piece) continue;
    if (piece.includes('@')) { out.push(piece.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '')); continue; }
    if (/^[\p{L}\p{M}\p{N}]+(-[\p{L}\p{M}\p{N}]+)+$/u.test(piece)) { out.push(piece); continue; }
    out.push(...wordsOf(piece));
  }
  return out.filter(Boolean).slice(0, 8);
}

function matches(entity, tokens) {
  const terms = entity.terms || [];
  const set = new Set(terms);
  return tokens.every((token, i) => set.has(token) || (i === tokens.length - 1 && token.length >= 2 && terms.some((x) => x[0] !== '~' && x.startsWith(token))));
}

/* the same, a word at a time forgiving one letter: a word matches exactly,
   as a beginning, or by sharing a "~" entry and being one letter off a
   whole word of the record's */
function nearMatches(entity, tokens) {
  const terms = entity.terms || [];
  const set = new Set(terms);
  const whole = terms.filter((x) => x[0] !== '~');
  return tokens.every((token, i) => {
    if (set.has(token)) return true;
    if (i === tokens.length - 1 && token.length >= 2 && whole.some((x) => x.startsWith(token))) return true;
    const keys = nearKeys(token);
    if (!keys.length || !keys.some((k) => set.has(k))) return false;
    return whole.some((x) => Math.abs(x.length - token.length) <= 1 && oneOff(x, token));
  });
}

function score(entity, tokens) {
  const id = fold(entity.id).replace(/\s+/g, '');
  let s = 0;
  if (tokens.length === 1 && id === tokens[0]) s += 100;
  if (tokens.some((t) => id.startsWith(t) && t.length >= 4)) s += 20;
  const title = fold(`${entity.title} ${entity.line}`);
  tokens.forEach((t) => { if (title.includes(t)) s += 5; });
  return s;
}

function publicOf(entity) {
  return { type: entity.type, id: entity.id, title: entity.title, line: entity.line || '', status: entity.status || '', statusKey: entity.statusKey || '', kind: entity.kind || '', at: entity.at || 0 };
}

/* A number typed in full is looked up directly too, so a record filed a
   moment ago is found even before the index has it. */
async function direct(db, q) {
  const v = String(q || '').trim().toUpperCase().replace(/\s+/g, '');
  const out = [];
  try {
    if (/^PFA-[A-Z0-9]{1,6}-\d{4}-\d{4,8}$/.test(v) || /^PFA-SHP-[A-Z0-9]{8}$/.test(v)) {
      const doc = await db.collection('submissions').doc(v).get();
      if (doc.exists) out.push(caseEntity(v, doc.data(), []));
    }
    if (/^PFA-[A-Z]{2,4}-[A-Z0-9]{8}$/.test(v) && !/^PFA-CCT-/.test(v)) {
      const doc = await db.collection('transactions').doc(v).get();
      if (doc.exists) out.push(paymentEntity(v, doc.data()));
    }
    if (/^PFA-CCT-[A-Z0-9]{8}$/.test(v)) {
      const doc = await db.collection('caretakerCards').doc(v).get();
      if (doc.exists) out.push(cardEntity(v, doc.data()));
    }
  } catch (_) { /* the index answers anyway */ }
  return out;
}

/* Searches the index for `q`, keeping only what `allowed(module)` lets this
   person open. Resolves to { results, more }. */
async function search(db, q, allowed, options) {
  const o = options || {};
  const limit = Math.min(Math.max(Number(o.limit) || 30, 1), 60);
  const tokens = tokensOf(q);
  if (!tokens.length || (tokens.length === 1 && tokens[0].length < 2)) return { results: [], more: false, tokens };
  /* The anchor: the longest whole word typed (every word but the last is
     complete); the last word itself only when it is the only one. */
  const complete = tokens.slice(0, -1).sort((a, b) => b.length - a.length);
  const anchors = complete.length ? [complete[0], tokens[tokens.length - 1]] : [tokens[0]];
  const found = new Map();
  for (const anchor of anchors) {
    const snap = await db.collection(INDEX).where('terms', 'array-contains', anchor).limit(300).get();
    for (const doc of snap.docs) {
      const e = doc.data() || {};
      if (!allowed(e.module) || !matches(e, tokens)) continue;
      /* A removed record (lib/routes/admin/case.js 'remove') left the
         registers, the counts and the public pages; search does not bring it
         back. It is reached by its reference in the register's removed view,
         or through the audit line that removed it. */
      if (e.statusKey === 'removed') continue;
      found.set(`${e.type}:${e.id}`, e);
    }
    if (found.size) break;
  }
  for (const e of await direct(db, q)) {
    if (allowed(e.module) && !found.has(`${e.type}:${e.id}`)) found.set(`${e.type}:${e.id}`, e);
  }
  /* Nothing as typed: forgive one letter in the longest word (it carries
     the most), one query of at most 21 entries. */
  let near = false;
  if (!found.size) {
    const pick = tokens.slice().sort((a, b) => b.length - a.length)[0] || '';
    const keys = nearKeys(pick).slice(0, 30);
    if (keys.length) {
      const snap = await db.collection(INDEX).where('terms', 'array-contains-any', keys).limit(300).get();
      for (const doc of snap.docs) {
        const e = doc.data() || {};
        if (!allowed(e.module) || e.statusKey === 'removed' || !nearMatches(e, tokens)) continue;
        found.set(`${e.type}:${e.id}`, e);
      }
      near = found.size > 0;
    }
  }
  const ranked = [...found.values()].sort((a, b) => (score(b, tokens) - score(a, tokens)) || ((b.at || 0) - (a.at || 0)));
  return { results: ranked.slice(0, limit).map(publicOf), more: ranked.length > limit, tokens, near };
}

module.exports = {
  INDEX, VERSION, SOURCES,
  sync, syncIfStale, search, tokensOf, oneOff, nearKeys,
  caseEntity, paymentEntity, cardEntity, emailEntity, auditEntity, docIdOf, matches,
  _reset: () => { running = null; }
};
