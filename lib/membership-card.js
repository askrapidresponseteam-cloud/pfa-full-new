'use strict';

/* The PFA membership card: from a paid membership to a printed card.

   Owner, 26 Oct 2026: "admin should have option to send email to the
   applicant to upload photo. once they upload the application should come
   to pfa for approval and card generation."

   The journey, one stage at a time (lib/submissions.js STAGES['PFA-MEM']):

     new              Member. Paid, on the register (lib/routes/payment/response.js).
     photo-requested  An administrator emailed the member a private link.
     photo-received   The member sent a photograph through it. It now waits
                      for PFA's approval, in the panel's Membership cards queue.
     card-approved    Approved: the card exists on the register (memberCards),
                      ready to print. Printed and posted with the kit.
     dispatched       Kit dispatched (as before).
     delivered        Kit delivered (as before).

   The three middle stages are reached only by their actions, never by a
   status change in the case drawer (lib/case-flow.js ACTION_ONLY), so the
   register can never say "Card approved" with no card behind it.

   The photograph link

     - 32 random bytes, base64url: 43 characters, 256 bits. Only its SHA-256
       is stored (memberPhotoLinks/{hash}), so a copy of the database cannot
       be used to send a photograph for anyone.
     - One live link per member. Sending a new one retires the old: the
       record carries the hash of the current link, and a link whose hash is
       not that one is refused as replaced.
     - It expires (LINK_DAYS) and is used once: the upload marks it used in
       the same transaction that files the photograph.
     - It opens only the photo step: it shows the member's first name and
       tier, never their email, mobile, address or payment.

   Nothing here deletes. A photograph replaced by a retake stays on file,
   superseded, so the record shows every photograph a member ever sent. */

const crypto = require('crypto');

const KIND = 'PFA-MEM';
const CARDS = 'memberCards';
const LINKS = 'memberPhotoLinks';
const LINK_DAYS = 14;
const LINK_MS = LINK_DAYS * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const PRINT_NAME_MAX = 40;
const REASON_MAX = 600;

/* The smallest photograph worth printing: the card's photo window is about
   25 x 34 mm, which at 300 dpi wants roughly 300 x 400 pixels. The upload
   page crops and exports 600 x 800, so a real photograph always clears it. */
const MIN_PHOTO = { w: 300, h: 400 };

/* How long each tier's card is valid, counted from the day the membership
   was paid. Owner to confirm; one place to change. A lifetime membership
   prints "Lifetime" where the others print a date. */
const VALIDITY_MONTHS = { student: 12, silver: 12, golden: 12, platinum: 12, lifetime: null };

/* The stage keys this module moves a membership through. */
const STAGE = {
  member: 'new',
  requested: 'photo-requested',
  received: 'photo-received',
  approved: 'card-approved',
  dispatched: 'dispatched',
  delivered: 'delivered'
};

/* The words an administrator ticks when a photograph will not do. Each one
   becomes a sentence in the email that sends the member a fresh link. */
const RETAKE_REASONS = {
  face: 'Your face is not clearly visible. Please send a photograph taken straight on, with your whole face showing.',
  light: 'The photograph is too dark or blurred. Please take it in good daylight and hold the phone steady.',
  covered: 'Please remove sunglasses, caps or anything covering your face.',
  background: 'The background is busy. Please stand in front of a plain, light wall.',
  person: 'The photograph does not appear to be of the member named on this membership.'
};

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

/* ---- tiers ---------------------------------------------------------------- */

/* The membership record keeps the tier's label ("Golden membership"), as the
   welcome letter printed it; the key is found from that. */
function tierOf(fields) {
  const TIERS = require('./payment').MEMBERSHIP_TIERS;
  const label = clean(fields && fields.tier, 60);
  const lower = label.toLowerCase();
  const key = Object.keys(TIERS).find((k) => TIERS[k].label.toLowerCase() === lower)
    || Object.keys(TIERS).find((k) => lower.startsWith(k)) || '';
  const months = Object.prototype.hasOwnProperty.call(VALIDITY_MONTHS, key) ? VALIDITY_MONTHS[key] : 12;
  return { key, label: key ? TIERS[key].label : (label || 'Membership'), months };
}

/* The short word the card prints for the tier: "Golden", "Lifetime". */
function tierWord(tier) {
  const word = clean(tier && tier.label, 60).replace(/\s*membership$/i, '');
  return word || 'Member';
}

function addMonths(iso, months) {
  const start = new Date(iso);
  if (!Number.isFinite(start.getTime())) return '';
  const end = new Date(start.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.toISOString();
}

/* Valid from the day the membership was paid, for the tier's months; '' for
   a lifetime membership. */
function validityOf(data, tier) {
  const from = String((data && data.createdAt) || '') || new Date(Number(data && data.receivedAtMs) || Date.now()).toISOString();
  if (tier.months === null) return { validFrom: from, validUntil: '', lifetime: true };
  return { validFrom: from, validUntil: addMonths(from, tier.months || 12), lifetime: false };
}

/* ---- the photograph link -------------------------------------------------- */

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function newToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

function isToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

/* What a link can do now. The link document is the authority on time and
   use; the record is the authority on which link is current. */
function linkState(link, record, nowMs) {
  if (!link) return 'unknown';
  const d = record || {};
  if (link.usedAt) return 'used';
  if (link.retiredAt) return 'replaced';
  const current = d.memberPhoto && d.memberPhoto.linkHash;
  if (current && current !== link.hash) return 'replaced';
  if (d.memberCard && d.memberCard.cardId) return 'closed';
  const status = String(d.status || '');
  if (status === 'removed' || status === 'spam') return 'closed';
  if (status !== STAGE.requested) return 'closed';
  const expires = Date.parse(link.expiresAt || '');
  if (!Number.isFinite(expires) || expires <= nowMs) return 'expired';
  return 'live';
}

/* ---- what may happen next ------------------------------------------------- */

function hasCard(data) {
  return Boolean(data && data.memberCard && data.memberCard.cardId);
}

/* A photograph may be asked for while the member has no card yet: first
   time, again after a retake, or again when a link lapsed unused. */
function requestable(data) {
  const d = data || {};
  if (d.kind !== KIND) return { ok: false, code: 'NOT_A_MEMBERSHIP', message: 'Only a membership is sent a photo link.' };
  if (d.status === 'removed' || d.status === 'spam') return { ok: false, code: 'CLOSED', message: 'This membership is removed or marked spam.' };
  if (hasCard(d)) return { ok: false, code: 'ALREADY_ISSUED', message: `The card is already approved (${d.memberCard.cardId}).` };
  const status = String(d.status || 'new');
  if (![STAGE.member, STAGE.requested, STAGE.received].includes(status)) {
    return { ok: false, code: 'BAD_STAGE', message: 'A photo link is sent before the card is approved.' };
  }
  const email = clean(d.fields && d.fields.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, code: 'NO_EMAIL', message: 'There is no email on this membership to send the link to.' };
  return { ok: true, email };
}

function approvable(data) {
  const d = data || {};
  if (d.kind !== KIND) return { ok: false, code: 'NOT_A_MEMBERSHIP', message: 'Only a membership is approved into a membership card.' };
  if (hasCard(d)) return { ok: false, code: 'ALREADY_ISSUED', message: `The card is already approved (${d.memberCard.cardId}).` };
  if (d.status !== STAGE.received) return { ok: false, code: 'BAD_STAGE', message: 'There is no photograph waiting for approval on this membership.' };
  if (!(d.memberPhoto && d.memberPhoto.current)) return { ok: false, code: 'NO_PHOTO', message: 'The photograph is not on file.' };
  if (!clean(d.fields && d.fields.name, 80)) return { ok: false, code: 'NO_NAME', message: 'The membership has no name to print.' };
  return { ok: true };
}

/* The name the card prints: what the reviewer confirmed, else the name as
   given, in name case. Letters, spaces, dots, hyphens and apostrophes. */
function printNameOf(value, fallback) {
  const RULES = require('../assets/field-rules.js');
  const raw = clean(value, PRINT_NAME_MAX * 2) || RULES.nameCase(clean(fallback, 80));
  return raw;
}

function printNameProblem(name) {
  const n = String(name || '');
  if (!n) return 'Type the name to print on the card.';
  if (n.length > PRINT_NAME_MAX) return `Keep the printed name to ${PRINT_NAME_MAX} characters. Use initials for the middle names.`;
  if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(n)) return 'The printed name can use letters, spaces, dots, hyphens and apostrophes only.';
  return '';
}

/* The card, as the register keeps it. Its number is the member number: one
   number for the member, on the welcome letter, the record and the card. */
function cardOf(reference, data, { printName, at, by }) {
  const f = (data && data.fields) || {};
  const tier = tierOf(f);
  const valid = validityOf(data, tier);
  return {
    cardId: reference,
    reference,
    name: clean(f.name, 80),
    printName,
    tierKey: tier.key,
    tierLabel: tier.label,
    tierWord: tierWord(tier),
    /* the card's short forms of the few place names too long to print
       (assets/card-print.js, as on the caregiver card) */
    district: require('../assets/card-print.js').placeName(clean(f.district, 60)),
    state: require('../assets/card-print.js').placeName(clean(f.state, 40)),
    validFrom: valid.validFrom,
    validUntil: valid.validUntil,
    lifetime: valid.lifetime,
    photo: (data.memberPhoto && data.memberPhoto.current) || '',
    approvedAt: at,
    approvedBy: by,
    status: 'active',
    printed: false,
    cardPrintedAt: '',
    cardPostedAt: ''
  };
}

/* ---- the photograph itself ------------------------------------------------ */

/* Width and height read from the file's own header, whatever it claims to
   be. JPEG (any SOF marker), PNG (IHDR) and WebP (VP8, VP8L, VP8X). null
   when the header cannot be read. */
function imageSize(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = b.readUInt16BE(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (sof) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

/* The one photograph a member sends: a data URL in, checked bytes out, or a
   reason the member can act on. */
function checkPhoto(dataUrl) {
  const S = require('./submissions');
  const parsed = S.parsePhotos([dataUrl], 1);
  if (parsed.rejected.length || !parsed.accepted.length) {
    return { ok: false, message: parsed.rejected[0] ? parsed.rejected[0].replace(/^Photo 1 /, 'The photograph ') : 'Add a photograph: a JPEG, PNG or WebP.' };
  }
  const photo = parsed.accepted[0];
  const size = imageSize(photo.bytes);
  if (!size) return { ok: false, message: 'The photograph could not be read. Try another one.' };
  if (size.w < MIN_PHOTO.w || size.h < MIN_PHOTO.h) {
    return { ok: false, message: 'The photograph is too small to print clearly. Use a larger or sharper one.' };
  }
  if (size.h < size.w) return { ok: false, message: 'Use an upright (portrait) photograph.' };
  return { ok: true, bytes: photo.bytes, contentType: photo.contentType, width: size.w, height: size.h };
}

/* ---- for the panel -------------------------------------------------------- */

function msOf(data) {
  const n = Number(data && data.receivedAtMs);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse((data && data.createdAt) || '');
  return Number.isFinite(t) ? t : 0;
}

/* Which queue a membership sits in, in the words the panel shows. */
function queueOf(data, nowMs) {
  const d = data || {};
  const status = String(d.status || 'new');
  if (hasCard(d)) {
    if (status === STAGE.delivered) return 'delivered';
    if (status === STAGE.dispatched) return 'dispatched';
    return d.memberCard.printedAt ? 'printed' : 'approved';
  }
  if (status === STAGE.received) return 'review';
  if (status === STAGE.requested) {
    const expires = Date.parse((d.memberPhoto && d.memberPhoto.linkExpiresAt) || '');
    return Number.isFinite(expires) && expires <= nowMs ? 'lapsed' : 'waiting';
  }
  if (status === STAGE.dispatched || status === STAGE.delivered) return 'legacy';
  return 'request';
}

const QUEUE_LABELS = {
  request: 'Ask for photo',
  waiting: 'Waiting for photo',
  lapsed: 'Link expired',
  review: 'To approve',
  approved: 'Approved, to print',
  printed: 'Printed',
  dispatched: 'Kit dispatched',
  delivered: 'Kit delivered',
  legacy: 'Kit sent, no card'
};

function rowOf(reference, data, nowMs) {
  const d = data || {};
  const f = d.fields || {};
  const p = d.memberPhoto || {};
  const card = d.memberCard || {};
  const tier = tierOf(f);
  const queue = queueOf(d, nowMs);
  return {
    reference,
    receivedAtMs: msOf(d),
    name: require('../assets/field-rules.js').nameCase(clean(f.name, 80)),
    email: clean(f.email, 254).toLowerCase(),
    mobile: clean(f.mobile, 20),
    tier: tier.label,
    district: clean(f.district, 60),
    state: clean(f.state, 40),
    status: String(d.status || 'new'),
    queue,
    queueLabel: QUEUE_LABELS[queue],
    requests: Number(p.requests) || 0,
    requestedAt: p.requestedAt || '',
    linkExpiresAt: p.linkExpiresAt || '',
    receivedAt: p.receivedAt || '',
    photo: Boolean(p.current),
    retakeReason: clean(p.retakeReason, REASON_MAX),
    cardId: card.cardId || '',
    printName: card.printName || '',
    approvedAt: card.approvedAt || '',
    printedAt: card.printedAt || ''
  };
}

module.exports = {
  KIND, CARDS, LINKS, LINK_DAYS, LINK_MS, STAGE, VALIDITY_MONTHS, RETAKE_REASONS, QUEUE_LABELS, MIN_PHOTO, PRINT_NAME_MAX, REASON_MAX,
  clean, tierOf, tierWord, addMonths, validityOf,
  hashToken, newToken, isToken, linkState,
  hasCard, requestable, approvable, printNameOf, printNameProblem, cardOf,
  imageSize, checkPhoto, queueOf, rowOf, msOf
};
