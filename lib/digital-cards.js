'use strict';

/* Digital cards (owner, 15 Nov 2026: "Add an option to issue digital
   caregiver and membership cards with front and back views and a flip
   feature premium style ... Each should have a unique peopleforanimals.org
   URL, like the internship certificate. All cards and certificates must be
   verifiable online").

   This changes the rule of 24 and 26 Oct 2026, that the printed card was
   the only copy: the panel can now also issue a card online. The printed
   card is unchanged.

   One public read model per digital card, digitalCards/{id}:
     id       the card's address: a colony caregiver card's own number
              (PFA-CCT- and eight characters at random), or for a
              membership card PFA-MBR- and eight at random, minted when it is
              first issued (a member's printed number is in order, so it is
              never the address that shows the photograph)
     kind     'caregiver' | 'member'
     what the card prints: name, number, district, state, tier, issued,
              valid until (or lifetime)
     photo    the photograph as the panel drew it on the card, kept in the
              file store (lib/file-store.js), shown only on the card
     status   'active' | 'withdrawn'
   Nothing else about the holder is in it: no address, mobile or email. The
   page at /card?id=<id> (card.html) shows the card, its front and its back,
   and says whether it is valid today; /api/verify-card answers the same
   for anyone checking a number. */

const crypto = require('crypto');

const COLLECTION = 'digitalCards';
/* a membership's card address, chosen before the card is issued, so its
   preview carries the QR code the card will have (17 Nov 2026: "why no QR!") */
const RESERVED = 'digitalCardIds';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAREGIVER_ID = /^PFA-CCT-[A-Z0-9]{8}$/;
const MEMBER_ID = /^PFA-MBR-[A-HJ-NP-Z2-9]{8}$/;
const ID = /^PFA-(CCT-[A-Z0-9]{8}|MBR-[A-HJ-NP-Z2-9]{8})$/;
const KINDS = {
  caregiver: { label: 'Colony Caregiver Card', module: 'caregivers' },
  member: { label: 'Membership Card', module: 'membership' }
};
const PHOTO_MAX = 600 * 1024;
/* the applicant's own photograph, as kept with the application */
const PHOTO_FILE_MAX = 4 * 1024 * 1024;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const dayOf = (v) => { const s = clean(v, 40); const m = /^(\d{4}-\d{2}-\d{2})/.exec(s); if (m) return m[1]; const ms = Date.parse(s); return Number.isFinite(ms) ? new Date(ms + 330 * 60000).toISOString().slice(0, 10) : ''; };

function newMemberId() {
  let out = '';
  while (out.length < 8) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return `PFA-MBR-${out}`;
}

function siteUrl() { return require('./public-site').publicSite(); }
function cardUrl(id) { return `${siteUrl()}/card?id=${encodeURIComponent(id)}`; }

/* Valid today: not withdrawn, and in date (a lifetime card always). */
function standing(d, nowMs) {
  if (!d || d.status === 'withdrawn') return 'withdrawn';
  if (d.revoked) return 'withdrawn';
  if (d.lifetime) return 'valid';
  const until = Date.parse(d.validUntil || '');
  if (!Number.isFinite(until)) return 'valid';
  return until + 24 * 3600 * 1000 > nowMs ? 'valid' : 'expired';
}

/* What the page and the check are told: what the card prints, and no more. */
function publicView(id, d, nowMs) {
  const s = standing(d, nowMs);
  return {
    found: true,
    id,
    kind: d.kind,
    kindLabel: (KINDS[d.kind] || KINDS.caregiver).label,
    name: clean(d.name, 80),
    number: clean(d.number, 40),
    district: clean(d.district, 60),
    state: clean(d.state, 40),
    tier: d.kind === 'member' ? clean(d.tier, 40) : '',
    issuedOn: clean(d.issuedOn, 10),
    validUntil: d.lifetime ? '' : clean(d.validUntil, 10),
    lifetime: Boolean(d.lifetime),
    standing: s,
    valid: s === 'valid',
    withdrawnOn: s === 'withdrawn' ? clean(d.withdrawnAt, 10) : '',
    photo: Boolean(d.photo) && s !== 'withdrawn',
    url: cardUrl(id)
  };
}

/* What the panel's card holds now, as the digital card will print it. */
async function sourceOf(db, kind, ref) {
  if (kind === 'caregiver') {
    const id = clean(ref, 40).toUpperCase();
    if (!CAREGIVER_ID.test(id)) return { error: 'That is not a colony caregiver card number.' };
    const snap = await db.collection('caretakerCards').doc(id).get();
    if (!snap.exists) return { error: 'No colony caregiver card carries that number.' };
    const c = snap.data() || {};
    if (c.status === 'revoked') return { error: 'This card has been revoked, so it is not issued online.' };
    return {
      id,
      card: { kind, ref: id, name: clean(c.printName || c.name, 80), number: id,
        district: clean(c.district, 60), state: clean(c.state, 40), issuedOn: dayOf(c.issuedAt), validUntil: dayOf(c.validUntil), lifetime: false },
      email: clean(c.email, 254).toLowerCase(),
      firstName: clean(c.name, 80)
    };
  }
  if (kind === 'member') {
    const reference = clean(ref, 40).toUpperCase();
    const snap = await db.collection('memberCards').doc(reference).get();
    if (!snap.exists) return { error: 'This membership has no card yet: approve the photograph first.' };
    const c = snap.data() || {};
    if (c.status && c.status !== 'active') return { error: 'This membership card is not active, so it is not issued online.' };
    const member = await db.collection('submissions').doc(reference).get();
    const f = member.exists ? ((member.data() || {}).fields || {}) : {};
    const id = MEMBER_ID.test(String(c.digitalId || '')) ? c.digitalId : '';
    return {
      id,
      card: { kind, ref: reference, name: clean(c.printName || c.name, 80), number: clean(c.cardId, 40), tier: clean(c.tierLabel, 40),
        district: clean(c.district, 60), state: clean(c.state, 40), issuedOn: dayOf(c.approvedAt || c.validFrom), validUntil: dayOf(c.validUntil), lifetime: Boolean(c.lifetime) },
      email: clean(f.email, 254).toLowerCase(),
      firstName: clean(f.name || c.name, 80)
    };
  }
  return { error: 'Say which card: a colony caregiver card or a membership card.' };
}

/* The photograph the panel sends: a JPEG or PNG, base64, not too large. */
function photoOf(base64) {
  if (!base64) return null;
  const bytes = Buffer.from(String(base64).replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
  if (!bytes.length || bytes.length > PHOTO_MAX) return { error: 'The photograph is too large to keep with the card.' };
  const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  const png = bytes.subarray(1, 4).toString() === 'PNG';
  if (!jpeg && !png) return { error: 'The photograph is not a JPEG or a PNG.' };
  return { bytes, type: jpeg ? 'image/jpeg' : 'image/png' };
}

/* Issues it, or issues it again with what the card holds now. */
async function issue(db, { kind, ref, photo, photoFile, who, nowMs, makeId }) {
  const src = await sourceOf(db, kind, ref);
  if (src.error) return { ok: false, status: 422, message: src.error };
  /* The colony caregiver card always shows the holder's photograph. The
     membership card shows the member's approved one when there is one
     (owner, 16 Nov 2026: "We can still have photo appended on membership
     card (right side)"), and is issued without it when there is none. */
  const wantsPhoto = kind !== 'member';
  /* the photograph the applicant sent, read on the server when the card is
     approved (lib/routes/admin/case.js), or the one the panel drew */
  const sent = photoFile && photoFile.bytes && /^image\/(jpeg|png)$/.test(photoFile.type) && photoFile.bytes.length <= PHOTO_FILE_MAX ? { bytes: photoFile.bytes, type: photoFile.type } : null;
  const pic = sent || (photo ? photoOf(photo) : null);
  if (pic && pic.error) return { ok: false, status: 422, message: pic.error };
  /* a card issued again (brought back after it was revoked, or corrected)
     keeps the photograph it already has online */
  const hadPhoto = wantsPhoto && !pic && src.id ? Boolean(((await db.collection(COLLECTION).doc(src.id).get()).data() || {}).photo) : false;
  if (wantsPhoto && !pic && !hadPhoto) return { ok: false, status: 422, message: 'The card has no photograph on screen yet, so it is not issued online. Open it with its photograph first.' };
  const at = new Date(nowMs).toISOString();
  const by = (who && (who.email || who.name)) || '';
  let id = src.id;
  /* the address its preview's QR code already showed (addressOf) */
  if (!id && kind === 'member') {
    const held = await db.collection(RESERVED).doc(src.card.ref).get();
    const rid = held.exists ? String((held.data() || {}).id || '') : '';
    if (MEMBER_ID.test(rid) && !(await db.collection(COLLECTION).doc(rid).get()).exists) id = rid;
  }
  if (!id) {
    for (let i = 0; i < 6 && !id; i += 1) {
      const candidate = (makeId || newMemberId)();
      if (!MEMBER_ID.test(candidate)) continue;
      const taken = await db.collection(COLLECTION).doc(candidate).get();
      if (!taken.exists) id = candidate;
    }
    if (!id) return { ok: false, status: 503, message: 'A card address could not be made just now. Try again.' };
    await db.collection('memberCards').doc(src.card.ref).update({ digitalId: id });
  }
  const kept = pic ? await require('./file-store').put(`digital-cards/${id}`, pic.bytes, pic.type) : null;
  const prior = await db.collection(COLLECTION).doc(id).get();
  /* issued again without a photograph: the one it has stays */
  const keepPhoto = !pic && prior.exists ? (prior.data().photo || null) : null;
  const doc = Object.assign({}, src.card, {
    id, photo: pic ? Object.assign({ contentType: pic.type, size: pic.bytes.length }, kept) : keepPhoto,
    status: 'active', withdrawnAt: '', issuedAt: (prior.exists && prior.data().issuedAt) || at, issuedBy: (prior.exists && prior.data().issuedBy) || by,
    updatedAt: at, updatedBy: by
  });
  await db.collection(COLLECTION).doc(id).set(doc);
  return { ok: true, id, url: cardUrl(id), again: prior.exists, card: publicView(id, doc, nowMs), email: src.email, firstName: src.firstName };
}

async function withdraw(db, id, { who, nowMs }) {
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, status: 404, message: 'No digital card has that address.' };
  const at = new Date(nowMs).toISOString();
  await ref.update({ status: 'withdrawn', withdrawnAt: at, updatedAt: at, updatedBy: (who && (who.email || who.name)) || '' });
  return { ok: true, id, card: publicView(id, Object.assign({}, snap.data(), { status: 'withdrawn', withdrawnAt: at }), nowMs) };
}

/* The digital card of one card on the panel's register, if it has one. */
async function statusOf(db, kind, ref) {
  let id = '';
  if (kind === 'caregiver') id = clean(ref, 40).toUpperCase();
  else {
    const snap = await db.collection('memberCards').doc(clean(ref, 40).toUpperCase()).get();
    id = snap.exists ? String((snap.data() || {}).digitalId || '') : '';
  }
  if (!ID.test(id)) return null;
  const d = await db.collection(COLLECTION).doc(id).get();
  return d.exists ? publicView(id, d.data(), Date.now()) : null;
}

/* The photograph kept on the server for a card (owner, 16 Nov 2026: "why
   no option preview and issue digital card?" from the registers): the
   colony caregiver's from their application (attachment 1), the member's
   approved one. Null when there is none, or it cannot be read. */
async function storedPhoto(db, kind, ref) {
  try {
    const S = require('./submissions');
    const files = require('./file-store');
    let doc = null;
    if (kind === 'caregiver') {
      const card = await db.collection('caretakerCards').doc(clean(ref, 40).toUpperCase()).get();
      const app = card.exists ? clean((card.data() || {}).applicationRef, 40) : '';
      if (app) doc = await db.collection('submissions').doc(app).collection('attachments').doc('1').get();
    } else {
      const reference = clean(ref, 40).toUpperCase();
      const card = await db.collection('memberCards').doc(reference).get();
      const pid = card.exists ? clean((card.data() || {}).photo, 80) : '';
      if (pid) doc = await db.collection('submissions').doc(reference).collection('attachments').doc(pid).get();
    }
    let bytes = doc && doc.exists ? await files.readStrict(doc.data() || {}) : null;
    /* or the one added in the panel, kept with the card online (17 Nov 2026:
       "why no option to add photo for both") */
    if (!bytes) {
      const on = await statusOf(db, kind, ref);
      const kept = on && on.id ? (((await db.collection(COLLECTION).doc(on.id).get()).data() || {}).photo || null) : null;
      bytes = kept ? await files.readStrict(kept) : null;
    }
    const type = bytes ? S.imageType(bytes) : '';
    return bytes && /^image\/(jpeg|png)$/.test(type) && bytes.length <= PHOTO_FILE_MAX ? { bytes, type } : null;
  } catch (error) {
    console.warn('card photograph not readable', { kind, message: error && error.message });
    return null;
  }
}

/* The address a card has, or will have once it is issued: a caregiver
   card's own number; a membership's address, chosen now when it has none
   yet and kept for when it is issued. '' when there is no card to speak of. */
async function addressOf(db, kind, ref) {
  if (kind === 'caregiver') { const id = clean(ref, 40).toUpperCase(); return CAREGIVER_ID.test(id) ? cardUrl(id) : ''; }
  const reference = clean(ref, 40).toUpperCase();
  if (!/^PFA-MEM-\d{4}-\d{5}$/.test(reference)) return '';
  const card = await db.collection('memberCards').doc(reference).get();
  const has = card.exists ? String((card.data() || {}).digitalId || '') : '';
  if (MEMBER_ID.test(has)) return cardUrl(has);
  const slot = db.collection(RESERVED).doc(reference);
  const held = await slot.get();
  const rid = held.exists ? String((held.data() || {}).id || '') : '';
  if (MEMBER_ID.test(rid)) return cardUrl(rid);
  for (let i = 0; i < 6; i += 1) {
    const candidate = newMemberId();
    if ((await db.collection(COLLECTION).doc(candidate).get()).exists) continue;
    await slot.set({ id: candidate, at: new Date().toISOString() });
    return cardUrl(candidate);
  }
  return '';
}

/* The card as it would be online, before it is issued (or as it is), with
   its photograph: what Preview in the registers draws. Nothing is saved. */
async function preview(db, kind, ref, nowMs) {
  const src = await sourceOf(db, kind, ref);
  if (src.error) return { ok: false, status: 422, message: src.error };
  const online = await statusOf(db, kind, ref);
  const pic = await storedPhoto(db, kind, ref);
  const view = publicView(src.id || '', Object.assign({}, src.card, { status: 'active', photo: pic ? {} : null }), nowMs);
  /* not online yet: the QR code of the address it will have, so the preview
     is the card as it will be (17 Nov 2026: "why no QR!") */
  if (!online || !view.url) view.url = await addressOf(db, kind, ref);
  return { ok: true, card: view, online, photo: pic ? `data:${pic.type};base64,${pic.bytes.toString('base64')}` : '', email: src.email || '' };
}

/* A card corrected from the panel (owner, 17 Nov 2026: "there should be an
   easy way to preview and correct both caregiver and membership cards"):
   the name as printed, the district and the state, on the card the
   register keeps, so the printed card and the card online read the same.
   A card already online is issued again at once, quietly (no email), so
   its page shows the correction; the photograph it has stays. */
async function correct(db, { kind, ref, name, district, state, who, nowMs = Date.now() }) {
  const MC = require('./membership-card');
  const n = clean(name, 80);
  const problem = MC.printNameProblem(n);
  if (problem) return { ok: false, status: 422, message: problem };
  const id = clean(ref, 40).toUpperCase();
  const col = kind === 'caregiver' ? 'caretakerCards' : kind === 'member' ? 'memberCards' : '';
  if (!col) return { ok: false, status: 400, message: 'Say which card: a colony caregiver card or a membership card.' };
  const doc = db.collection(col).doc(id);
  const snap = await doc.get();
  if (!snap.exists) {
    return { ok: false, status: 404, message: kind === 'member'
      ? 'This membership has no card yet. Press Issue card: it is issued with the name as you typed it.'
      : 'No colony caregiver card carries that number.' };
  }
  const was = snap.data() || {};
  const d = clean(district, 60);
  const st = clean(state, 40);
  const changes = {};
  if (n !== clean(was.printName || was.name, 80)) changes.printName = n;
  if (d && d !== clean(was.district, 60)) changes.district = d;
  if (st && st !== clean(was.state, 40)) changes.state = st;
  if (!Object.keys(changes).length) return { ok: true, changed: false, online: await statusOf(db, kind, id) };
  const at = new Date(nowMs).toISOString();
  const by = (who && (who.email || who.name)) || '';
  await doc.update(Object.assign({}, changes, { correctedAt: at, correctedBy: by }));
  /* the membership's copy of its card, which the printed card is drawn from */
  if (kind === 'member' && changes.printName) {
    try { await require('./routes/admin/case').memberCardName(db, id, n, { at }); } catch (error) { console.warn('membership card name not copied to the membership', error && error.message); }
  }
  let online = await statusOf(db, kind, id);
  let note = '';
  /* a revoked card stays revoked: corrected, not brought back */
  if (online && online.standing !== 'withdrawn') {
    /* the photograph it has online stays (issue keeps it) */
    const r = await issue(db, { kind, ref: id, who, nowMs });
    if (r.ok) online = r.card;
    else note = `The card online was not brought up to date: ${r.message}`;
  }
  return { ok: true, changed: true, changes, online, note };
}

async function read(db, id) {
  const snap = await db.collection(COLLECTION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

module.exports = { COLLECTION, RESERVED, addressOf, ID, CAREGIVER_ID, MEMBER_ID, KINDS, cardUrl, standing, publicView, sourceOf, photoOf, issue, withdraw, statusOf, storedPhoto, preview, correct, read, newMemberId };
