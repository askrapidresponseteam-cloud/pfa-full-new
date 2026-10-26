/* Submissions: what the public forms send, and what the public may see back.

   A reference is issued here, by the server, from a counter - PFA-C-2026-00042
   is the forty-second case of 2026. The browser used to invent one from five
   random digits and post it as the document id, which meant two people could
   get the same number, a failed send still showed a number that existed
   nowhere, and anyone could overwrite anyone else's report by guessing.

   A sequential number is easy to read out over the phone, and easy to guess;
   so looking one up also needs the email or mobile that was given with it.
   What comes back is the status and when it changed - never the report. */

'use strict';

const crypto = require('crypto');
const RULES = require('../assets/field-rules.js');

const KIND_LABELS = {
  'PFA-A': 'Adoption application',
  'PFA-S': 'Story submission',
  'PFA-F': 'General form',
  'PFA-CR': 'Cruelty report',
  'PFA-C': 'Case follow request',
  'PFA-Q': 'Help desk query',
  'PFA-V': 'Volunteer application',
  'PFA-J': 'Job application',
  'PFA-W': 'Wire report',
  'PFA-CSR': 'Corporate partnership',
  'PFA-CAC': 'CineKind entry',
  'PFA-CK': 'CineKind nomination',
  'PFA-EV': 'Event request',
  'PFA-CG': 'Colony caregiver application',
  'PFA-MEM': 'Membership',
  'PFA-MEET': 'Meet request',
  'PFA-POD': 'Podcast/media request',
  'PFA-DON': 'Donation',
  'PFA-SHP': 'Shop order',
  /* The microsites (9 Oct 2026): campus.html, legacy.html, campaign.html,
     sgacc.html, privacy.html. csr.html sends PFA-CSR, above. */
  'PFA-CAM': 'Campus society registration',
  'PFA-LEG': 'Legacy enquiry',
  'PFA-CMP': 'Campaign plan',
  'PFA-SG': 'Animal Care Centre offer',
  'PFA-PRV': 'Privacy request',
  /* units.html (22 Oct 2026): the paper form for a new PFA unit, online */
  'PFA-U': 'New PFA unit application'
};

/* Kinds that only a settled payment may file (lib/routes/payment/response.js,
   lib/routes/shop/response.js). The public intake refuses them: a caregiver
   application or a membership posted straight to the API would otherwise be
   on record with no fee behind it. */
const PAID_KINDS = new Set(['PFA-CG', 'PFA-MEM', 'PFA-DON', 'PFA-SHP']);

/* Kinds kept off the admin Submissions register and its counts (owner,
   26 Oct 2026: "donations dont need to appear here in submissions as they
   dont have a status or action"). A donation has nothing to move along;
   it lives under Payments & donations, with the transaction behind it.
   The record is still kept, still emailed, and still opens by reference. */
const OFF_REGISTER = new Set(['PFA-DON']);

/* Stages, per kind. An application is not a query: "Being handled" tells a
   volunteer nothing, where "Shortlisted" tells them exactly where they stand.
   A kind with no entry here keeps the generic flow below.

   Every stage is a state a record can be *moved to*. None of them removes it:
   rejected, withdrawn and cancelled are stages, not deletions. */
const STAGES = {
  /* The card needs the member's photograph and PFA's approval before it is
     printed (owner, 26 Oct 2026). The three middle stages are reached only
     by their actions (lib/membership-card.js, lib/case-flow.js ACTION_ONLY). */
  'PFA-MEM': [
    { key: 'new',             label: 'Member',          next: 'Your membership is active. PFA will email you a link to send your photograph for the membership card.' },
    { key: 'photo-requested', label: 'Photo requested', next: 'PFA has emailed you a private link. Send your photograph through it so your card can be printed.' },
    { key: 'photo-received',  label: 'Photo received',  next: 'Your photograph is with PFA for approval.' },
    { key: 'card-approved',   label: 'Card approved',   next: 'Your membership card is approved and being printed. It will be posted to you.' },
    { key: 'dispatched', label: 'Kit dispatched', next: 'Your card and kit are on their way. They usually take 20 to 25 days.' },
    { key: 'delivered',  label: 'Kit delivered',  next: 'Your card and kit have reached you.' }
  ],
  'PFA-V': [
    { key: 'new',         label: 'Submitted',    next: 'It is in the queue. Someone at PFA reads every application.' },
    { key: 'under-review',label: 'Under review', next: 'Being read against the areas you chose.' },
    { key: 'shortlisted', label: 'Shortlisted',  next: 'PFA will be in touch to talk about where you would fit.' },
    { key: 'approved',    label: 'Approved',     next: 'You are on the volunteer register. PFA will tell you what happens next.' },
    { key: 'rejected',    label: 'Not taken forward', next: 'Not this time. The application stays on record, and you can apply again.' },
    { key: 'withdrawn',   label: 'Withdrawn',    next: 'Withdrawn at your request. The record stays on file.' }
  ],
  /* A campus society is an application to be recognised, so it says where
     it stands in those words (campus.html, 9 Oct 2026). */
  'PFA-CAM': [
    { key: 'new',          label: 'Submitted',          next: 'It is in the queue. Someone at PFA Campus reads every registration.' },
    { key: 'under-review', label: 'Under review',       next: 'PFA Campus is reading your registration and may call the lead you named.' },
    { key: 'approved',     label: 'Recognised',         next: 'Your society is recognised as a PFA Campus society. PFA will tell you what happens next.' },
    { key: 'rejected',     label: 'Not taken forward',  next: 'Not this time. The registration stays on record, and you can register again.' },
    { key: 'withdrawn',    label: 'Withdrawn',          next: 'Withdrawn at your request. The record stays on file.' }
  ],
  'PFA-CG': [
    { key: 'new',          label: 'Submitted',     next: 'It is in the queue.' },
    { key: 'under-review', label: 'Under review',  next: 'PFA is checking the details you gave.' },
    { key: 'verified',     label: 'Verified',      next: 'Your details check out. The card is being prepared.' },
    { key: 'approved',     label: 'Card issued',   next: 'Approved. Your card is being printed, and the printed card will be posted to the address you gave.' },
    { key: 'rejected',     label: 'Not issued',    next: 'The card was not issued this time. The application stays on record.' },
    { key: 'revoked',      label: 'Revoked',       next: 'The card has been revoked. The record and its history remain.' }
  ]
};

function stagesFor(kind) {
  return STAGES[kind] || null;
}

/* A stage a record can move to. Nothing here removes a record: the terminal
   stages are refusals and revocations, and both keep the file. */
function isStage(kind, status) {
  const list = stagesFor(kind);
  if (!list) return ['new', 'in-progress', 'handled', 'spam'].includes(status);
  return list.some((s) => s.key === status);
}

function stageLabel(kind, status) {
  const list = stagesFor(kind);
  const hit = list && list.find((s) => s.key === status);
  return hit ? hit.label : null;
}

/* What each status means to the person who sent it. Staff vocabulary stays
   inside the panel: "spam" is simply closed from the outside. */
const PUBLIC_STATUS = {
  new: { label: 'Received', next: 'It is in the queue. A named person at PFA picks it up from here.' },
  'in-progress': { label: 'Being handled', next: 'Someone at PFA has taken this up. If they need more from you they will use the contact you gave.' },
  handled: { label: 'Closed', next: 'PFA has finished with this. If it is not resolved for you, raise it again and mention this number.' },
  spam: { label: 'Closed', next: 'PFA has finished with this. If it is not resolved for you, raise it again and mention this number.' }
};

const REFERENCE = /^PFA-[A-Z]{1,4}-\d{4}-\d{4,8}$/;
/* A shop order is filed under its order number, which the shop minted. */
const ORDER_REFERENCE = /^PFA-SHP-[A-Z0-9]{8}$/;
/* The old browser-made numbers, still on record, had five digits too; this
   also accepts any earlier shape so nothing already issued becomes untrackable. */
const ANY_REFERENCE = /^PFA-[A-Z0-9-]{4,40}$/;

function formatReference(kind, year, number) {
  return `${kind}-${year}-${String(number).padStart(5, '0')}`;
}

function isReference(value) {
  const text = String(value || '').trim().toUpperCase();
  return REFERENCE.test(text) || ORDER_REFERENCE.test(text) || ANY_REFERENCE.test(text);
}

/* The year a number belongs to is the year in India (8 Oct 2026). It was the
   UTC year, so a report filed at 00:30 IST on 1 January was numbered in the
   year that had just ended. India keeps one offset all year (UTC+5:30, no
   daylight saving), so plain arithmetic is exact and needs no time zone data
   in the runtime. */
const IST_OFFSET_MS = 330 * 60 * 1000;

function referenceYear(nowMs = Date.now()) {
  return new Date(Number(nowMs) + IST_OFFSET_MS).getUTCFullYear();
}

/* Reads the counter for this kind and year inside the caller's transaction
   and offers the next number. Nothing is written until the caller calls
   take(), because Firestore wants every read of a transaction before its
   first write: the caller reads what else it needs (the record's slot, an
   idempotency key) and then takes the number together with its own writes,
   so the number, the record and the key are committed as one, or not at all.
   bump() offers the number after, for a slot that turns out to be taken. */
async function reserveReference(tx, db, kind, nowMs = Date.now()) {
  const year = referenceYear(nowMs);
  const key = `${kind}-${year}`;
  const counter = db.collection('counters').doc('submissions');
  const snapshot = await tx.get(counter);
  const current = snapshot.exists ? Number((snapshot.data() || {})[key]) || 0 : 0;
  const offer = (number) => ({
    reference: formatReference(kind, year, number),
    number,
    bump: () => offer(number + 1),
    take: () => { tx.set(counter, { [key]: number }, { merge: true }); },
    /* moves the counter to `to` without taking a number: for a counter found
       behind the records, so the next attempt starts past them */
    advanceTo: (to) => { tx.set(counter, { [key]: to }, { merge: true }); }
  });
  return offer(current + 1);
}

/* Issues the next free number for this kind and year, atomically, stepping
   past any number already on file: lib/reference-slots.js (kept apart
   because it reads the submissions themselves, and this file writes the
   counter with a merge, which no file that reads submissions may hold:
   test/submissions.test.js). Required when called, as it requires this. */
function allocateReference(db, kind, nowMs = Date.now()) {
  return require('./reference-slots').allocateReference(db, kind, nowMs);
}
function reserveFreeReference(...args) { return require('./reference-slots').reserveFreeReference(...args); }
function withFreeReference(...args) { return require('./reference-slots').withFreeReference(...args); }

/* ---- ownership -------------------------------------------------------- */

const CONTACT_FIELD = /^(contact|email|e-?mail|mobile|phone|whatsapp|telephone)(number|no)?$/i;

function normaliseContact(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.includes('@')) return text.toLowerCase().replace(/\s+/g, '');
  const mobile = RULES.normaliseField('mobile', text);
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : '';
}

function contactKey(value) {
  const normalised = normaliseContact(value);
  if (!normalised) return '';
  const pepper = String(process.env.PFA_AUTH_PEPPER || '');
  return crypto.createHash('sha256').update(`${pepper}:${normalised}`, 'utf8').digest('hex');
}

function isContactField(name) {
  return CONTACT_FIELD.test(String(name || '').replace(/\s+/g, ''));
}

/* The fingerprints of the sender's own email and mobile: only the fields the
   form names as the sender's contact (email, mobile, phone...).

   Until 8 Oct 2026 any field holding an @ or ten digits counted too, so on a
   cruelty report the mobile typed under "Who is doing it" became a key, and
   the person accused could follow the report against them. A contact in a
   description, a gift's recipient or the accused is not the sender's. */
function contactKeysFor(fields) {
  const keys = new Set();
  Object.keys(fields || {}).forEach((name) => {
    if (!isContactField(name)) return;
    const key = contactKey(fields[name]);
    if (key) keys.add(key);
  });
  return [...keys];
}

/* The old rule, by shape as well as by name. Kept only for records saved
   before keys were stored at all, so a number issued then and followed with
   the email it was given still opens; nothing new is keyed this way. */
function legacyContactKeysFor(fields) {
  const keys = new Set();
  Object.keys(fields || {}).forEach((name) => {
    const value = String(fields[name] == null ? '' : fields[name]);
    if (!isContactField(name) && !/@/.test(value) && !/\d{10}/.test(value.replace(/\D/g, ''))) return;
    const key = contactKey(value);
    if (key) keys.add(key);
  });
  return [...keys];
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* The sender's email: the value of a field the form names as the sender's
   contact, an email field first. Never the first thing shaped like an email:
   on report.html "Who is doing it" comes before "Email", and the
   confirmation, with the reporter's name and the tracking link, went to the
   person accused when an address was typed there (8 Oct 2026). */
function senderEmail(fields) {
  const named = Object.keys(fields || {}).filter(isContactField);
  const emailFirst = named.filter((k) => /^e-?mail/i.test(k.replace(/\s+/g, '')))
    .concat(named.filter((k) => !/^e-?mail/i.test(k.replace(/\s+/g, ''))));
  for (const key of emailFirst) {
    const value = String(fields[key] == null ? '' : fields[key]).trim().toLowerCase();
    if (EMAIL_SHAPE.test(value)) return value;
  }
  return '';
}

/* The fingerprints saved with the record, and the same fingerprints made
   again on this server from the record's own email and mobile fields.

   Saved ones alone failed across servers: the site runs on Vercel and the
   panel on Firebase, a fingerprint is mixed with PFA_AUTH_PEPPER, and a
   record written by one and looked up on the other, with a different or
   missing pepper, told its own sender "the email or mobile does not match"
   (owner, 8 Oct 2026, PFA-Q-2026-00002). Remaking them here only reads the
   fields named as contact fields (email, mobile, phone...), so it accepts
   nothing the record was not already given by its sender: a gift's
   recipient (giftEmail) or a number inside a description does not count. */
function contactMatches(record, contact) {
  const fields = record.fields || {};
  const saved = Array.isArray(record.contactKeys) ? record.contactKeys : [];
  /* Saved keys are honoured, so every number already issued keeps opening
     for the contact it was issued with (8 Oct 2026), except a key this
     server can see was made from a field that is NOT the sender's contact:
     records saved before that day were keyed by the old any-field rule, and
     the number typed under "Who is doing it" would still have opened the
     report for the person accused. (A key made on the other server, with
     another pepper, cannot be told apart, and cannot be matched here
     either.) */
  const others = {};
  Object.keys(fields).forEach((name) => { if (!isContactField(name)) others[name] = fields[name]; });
  const own = new Set(contactKeysFor(fields));
  const notTheirs = new Set(legacyContactKeysFor(others).filter((k) => !own.has(k)));
  /* the old shape rule only for a record that names no contact field at all */
  const stored = new Set(saved.filter((k) => !notTheirs.has(k)).concat([...own], saved.length || own.size ? [] : legacyContactKeysFor(fields)));
  if (!stored.size) return { required: false, ok: true };
  const key = contactKey(contact);
  return { required: true, ok: Boolean(key) && stored.has(key) };
}

/* ---- the public view -------------------------------------------------- */

/* What a status is called outside PFA: the kind's own stage when it has
   stages (a volunteer whose application is approved sees "Approved", not
   "Received"), the generic words otherwise. The raw status "spam" never
   leaves the server: it is "closed" (CONTRACT.md section 1). null for a status
   that has no public name, which is then not shown at all. */
function publicStatus(kind, status) {
  const stage = (stagesFor(kind) || []).find((s) => s.key === status);
  if (stage) return { status, label: stage.label, next: stage.next };
  if (status === 'spam') return { status: 'closed', label: PUBLIC_STATUS.spam.label, next: PUBLIC_STATUS.spam.next };
  if (Object.prototype.hasOwnProperty.call(PUBLIC_STATUS, status)) {
    return { status, label: PUBLIC_STATUS[status].label, next: PUBLIC_STATUS[status].next };
  }
  return null;
}

/* One history row as the sender may see it, or null to hide it.
   CONTRACT.md section 1 (8 Oct 2026): status changes and reopens; a reply PFA
   sent, or one staff sent from the inbox; and the sender's own email. Every
   internal event (assign, the wall, notes, bounces, a third party writing in,
   anything not named here) stays inside: before this, each of them showed
   the sender another "Received". */
function publicRow(kind, h) {
  if (!h || typeof h !== 'object') return null;
  const at = h.at || null;
  if (!h.event) {
    const shown = publicStatus(kind, h.status);
    return shown ? { status: shown.status, label: shown.label, at } : null;
  }
  if (h.event === 'reopen') {
    const shown = publicStatus(kind, h.status || 'new');
    return { status: shown ? shown.status : 'new', event: 'reopen', label: 'Reopened', at };
  }
  if (h.event === 'reply') {
    /* a reply row from before directions were recorded is PFA's own reply */
    const direction = h.direction || 'out';
    let label = '';
    if (direction === 'out' || (direction === 'in' && h.party === 'staff')) label = 'PFA replied by email';
    else if (direction === 'in' && h.party === 'sender') label = 'You wrote to PFA';
    if (!label) return null;
    const shown = publicStatus(kind, h.status || 'in-progress');
    return { status: shown ? shown.status : 'in-progress', event: 'reply', label, at };
  }
  /* the printed card, from Print and post in the panel (lib/routes/admin/cards.js) */
  if (h.event === 'card-printed' || h.event === 'card-posted') {
    return { status: 'approved', event: h.event, label: h.event === 'card-printed' ? 'Card printed' : 'Card posted', at };
  }
  return null;
}

/* What happens next, said from where the printed card is: an approved
   application's card is printed, then posted. */
const CARD_NEXT = {
  'card-printed': 'Your card is printed and will be posted to the address you gave.',
  'card-posted': 'Your card is in the post to the address you gave. Post within India usually takes a few working days.'
};
function nextOf(record, current) {
  if (record.kind !== 'PFA-CG' || current.status !== 'approved') return current.next;
  const history = Array.isArray(record.history) ? record.history : [];
  const step = history.some((h) => h && h.event === 'card-posted') ? 'card-posted'
    : history.some((h) => h && h.event === 'card-printed') ? 'card-printed' : '';
  return step ? CARD_NEXT[step] : current.next;
}

function timelineOf(record) {
  const history = Array.isArray(record.history) && record.history.length
    ? record.history
    : [{ status: 'new', at: record.createdAt }].concat(
      record.status && record.status !== 'new' && record.handledAt ? [{ status: record.status, at: record.handledAt }] : []
    );
  const out = [];
  history.forEach((h) => {
    const row = publicRow(record.kind, h);
    if (!row) return;
    /* the same words twice in a row say nothing new: the first one stands */
    if (out.length && out[out.length - 1].label === row.label) return;
    out.push(row);
  });
  return out;
}

/* The sender's name and how to reach them. The fields the form names as the
   sender's (email, mobile, contact...) come first; the first email or mobile
   anywhere is looked for only when no such field holds one, which is a record
   from before the forms named them. Otherwise a reply from the panel to a
   cruelty report went to whatever address was typed under "Who is doing it"
   (8 Oct 2026). */
function contactOf(fields) {
  const all = Object.keys(fields || {});
  const valueOf = (key) => String(fields[key] == null ? '' : fields[key]).trim();
  const firstEmail = (keys) => {
    for (const key of keys) { const v = valueOf(key).toLowerCase(); if (EMAIL_SHAPE.test(v)) return v; }
    return '';
  };
  const firstMobile = (keys) => {
    for (const key of keys) { const m = normaliseContact(valueOf(key)); if (m && !m.includes('@')) return m; }
    return '';
  };
  const nameKey = all.find((key) => valueOf(key) && /^(name|fullname|full name|your name|contact name)$/i.test(key));
  const out = {
    name: nameKey ? RULES.nameCase(valueOf(nameKey)) : '',
    email: senderEmail(fields),
    mobile: firstMobile(all.filter(isContactField))
  };
  if (!out.email && !out.mobile) {
    out.email = firstEmail(all);
    out.mobile = firstMobile(all);
  }
  return out;
}

function publicView(record) {
  const current = publicStatus(record.kind, record.status) || publicStatus(record.kind, 'new');
  const timeline = timelineOf(record);
  return {
    found: true,
    reference: record.reference,
    kind: record.kind,
    kindLabel: record.kindLabel || KIND_LABELS[record.kind] || 'Submission',
    status: current.status,
    statusLabel: current.label,
    next: nextOf(record, current),
    receivedAt: record.createdAt || null,
    updatedAt: timeline.length ? timeline[timeline.length - 1].at : record.createdAt || null,
    timeline
  };
}

/* ---- photographs --------------------------------------------------------- */

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 950 * 1024;   // under Firestore's 1 MiB document limit
const MAX_TOTAL_BYTES = 2600 * 1024;

/* An application for a new PFA unit carries more papers than any other form
   (units.html, 22 Oct 2026): an address proof for each of the seven board
   members, photocopies of the cases, photographs of the rescues. It may send
   six photographs, shrunk harder in the browser so that six still fit under
   MAX_TOTAL_BYTES and the request under the 4 MB body cap. Anything more, or
   a PDF, comes as a reply to the confirmation email, which lib/inbound-mail.js
   files on the same record and carries on to the inbox with its files.
   MAX_PHOTOS_ANY is the most any kind may send, for the routes that read a
   photograph back by its number. */
const PHOTO_LIMITS = { 'PFA-U': 6 };
const MAX_PHOTOS_ANY = 6;

function maxPhotosFor(kind) {
  const key = String(kind || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PHOTO_LIMITS, key) ? PHOTO_LIMITS[key] : MAX_PHOTOS;
}

/* What the bytes say they are, whatever the label claims. */
function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

/* Data URLs in, checked bytes out. A bad picture is named by its position so
   the sender knows which one to replace. */
function parsePhotos(value, max) {
  const limit = Math.min(MAX_PHOTOS_ANY, Math.max(1, Number(max) || MAX_PHOTOS));
  const accepted = [];
  const rejected = [];
  const list = Array.isArray(value) ? value : [];
  if (list.length > limit) rejected.push(`Up to ${limit} photos can be attached.`);
  let total = 0;
  list.slice(0, limit).forEach((item, i) => {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(item || ''));
    if (!match) { rejected.push(`Photo ${i + 1} is not an image the site can read.`); return; }
    const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    const contentType = imageType(bytes);
    if (!contentType) { rejected.push(`Photo ${i + 1} is not a JPEG, PNG or WebP.`); return; }
    if (bytes.length > MAX_PHOTO_BYTES) { rejected.push(`Photo ${i + 1} is too large even after shrinking. Try a smaller picture.`); return; }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) { rejected.push('The photos together are too large. Send fewer or smaller pictures.'); return; }
    accepted.push({ contentType, bytes });
  });
  return { accepted: rejected.length ? [] : accepted, rejected };
}

/* ---- a small brake on guessing, and on flooding -------------------------- */

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 40;
/* Sending is braked separately from looking up, and more gently. They must not
   share a bucket: someone who has just filed a report and is refreshing its
   status should never find that the refreshing has used up their ability to
   file a second one.

   Thirty in a quarter of an hour is far beyond anything a person filling in
   forms will do, and far below what makes a flood worth the trouble. */
const WRITE_LIMIT = 30;
/* Confirmations to any one address, whoever asks for them (8 Oct 2026). The
   per-connection brake alone let one sender have the site email a stranger
   thirty PFA-branded letters every quarter of an hour, from one connection,
   and without limit from many. Five an hour covers a person filing several
   reports in a bad week. The submission itself is still filed; only the
   letter is held back, and the page says no email could be sent. */
const CONFIRM_LIMIT = 5;
const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

const BRAKES = {
  lookup: { limit: LIMIT, windowMs: WINDOW_MS },
  write: { limit: WRITE_LIMIT, windowMs: WINDOW_MS },
  confirm: { limit: CONFIRM_LIMIT, windowMs: CONFIRM_WINDOW_MS }
};

/* This instance's own counts. They are the brake when the shared count in
   Firestore cannot be reached, and the first brake on a flood of junk that
   never gets as far as Firestore. */
const hits = new Map();
const writes = new Map();
const confirms = new Map();
/* The counting itself is lib/memory-brake.js (kept apart because it evicts
   keys from a Map, and no file that touches submissions may hold a
   delete call: test/submissions.test.js). */
const { brake, MAX_KEYS } = require('./memory-brake');

function rateLimited(ip, nowMs = Date.now()) {
  return brake(hits, ip, LIMIT, nowMs);
}

function writeLimited(ip, nowMs = Date.now()) {
  return brake(writes, ip, WRITE_LIMIT, nowMs);
}

/* How long a request waits for the shared count before braking on this
   instance's own. A database that is down must not hold up every form. */
const SHARED_WAIT_MS = 1500;

function waitAtMost(work, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(work).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('rate limit count timed out')), ms); })
  ]);
}

/* The count both servers share (8 Oct 2026). Vercel and Firebase each ran
   their own counters, in every warm instance separately, so the brake was as
   many brakes as there were instances. Now one Firestore document per
   connection (or address) and window holds the count, raised in a
   transaction. The id is a hash, so no address is stored as written. Nothing
   deletes the documents: an old window is simply never read again, and
   expiresAt is there should a Firestore TTL policy ever be wanted.

   true: over the limit; false: not; null: the shared count could not be
   reached, and the caller brakes on this instance's own. */
async function sharedLimited(db, bucket, key, nowMs = Date.now()) {
  const spec = BRAKES[bucket];
  if (!spec || !db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function') return null;
  const windowIndex = Math.floor(Number(nowMs) / spec.windowMs);
  const id = crypto.createHash('sha256').update(`${bucket}:${String(key || 'unknown')}:${windowIndex}`, 'utf8').digest('hex');
  try {
    const ref = db.collection('rateLimits').doc(id);
    const count = await waitAtMost(db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const next = (snapshot.exists ? Number((snapshot.data() || {}).count) || 0 : 0) + 1;
      tx.set(ref, {
        bucket,
        count: next,
        windowStart: new Date(windowIndex * spec.windowMs).toISOString(),
        expiresAt: new Date((windowIndex + 1) * spec.windowMs),
        updatedAt: new Date(Number(nowMs)).toISOString()
      });
      return next;
    }), SHARED_WAIT_MS);
    return count > spec.limit;
  } catch (error) {
    console.warn('rate limit: the shared count could not be reached; braking on this instance alone', { bucket, message: error && error.message });
    return null;
  }
}

/* Looking a reference up. This instance's own count is a part of the shared
   one, so once it alone is over the limit the answer is already known, and a
   flood from one address costs no Firestore write per request. */
async function lookupLimited(db, ip, nowMs = Date.now()) {
  if (rateLimited(ip, nowMs)) return true;
  const shared = await sharedLimited(db, 'lookup', ip, nowMs);
  return shared === true;
}

/* Filing a submission that passed validation. The door brake (writeLimited,
   on every POST, before the body is even read) has already counted this
   request on this instance, so with no shared count there is nothing more to
   add here. */
async function sendLimited(db, ip, nowMs = Date.now()) {
  return (await sharedLimited(db, 'write', ip, nowMs)) === true;
}

/* One more confirmation to this address. The shared count decides whenever
   it can be reached; this instance's own is only the fallback. Only valid
   submissions get this far, already braked per connection, so there is no
   flood here to save writes on. */
async function confirmLimited(db, address, nowMs = Date.now()) {
  const key = String(address || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!key) return false;
  const local = brake(confirms, key, CONFIRM_LIMIT, nowMs, CONFIRM_WINDOW_MS);
  const shared = await sharedLimited(db, 'confirm', key, nowMs);
  return shared === null ? local : shared;
}

/* The address of the person at the other end, as far as it can be trusted:
   lib/client-ip.js (8 Oct 2026, review B item 7). */
const { clientIp } = require('./client-ip');

module.exports = {
  KIND_LABELS,
  PAID_KINDS,
  OFF_REGISTER,
  STAGES,
  stagesFor,
  isStage,
  stageLabel,
  MAX_PHOTOS,
  MAX_PHOTOS_ANY,
  maxPhotosFor,
  PUBLIC_STATUS,
  allocateReference,
  reserveReference,
  reserveFreeReference,
  withFreeReference,
  referenceYear,
  clientIp,
  contactKey,
  contactKeysFor,
  contactMatches,
  contactOf,
  senderEmail,
  isContactField,
  formatReference,
  imageType,
  parsePhotos,
  isReference,
  normaliseContact,
  publicView,
  publicStatus,
  timelineOf,
  rateLimited,
  writeLimited,
  sharedLimited,
  lookupLimited,
  sendLimited,
  confirmLimited,
  WRITE_LIMIT,
  CONFIRM_LIMIT,
  MAX_KEYS,
  resetForTests() { hits.clear(); writes.clear(); confirms.clear(); },
  _memoryCounts: () => ({ hits: hits.size, writes: writes.size, confirms: confirms.size })
};
