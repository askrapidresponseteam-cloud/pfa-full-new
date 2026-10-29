/* GET /api/admin/applications

   The colony caregiver applications waiting for a decision, oldest first,
   each with what a reviewer needs to Issue or Reject it from one screen
   (owner, 24 Oct 2026: "update. in admin panel. so that issuance is easy.
   there should be issue or reject").

   Waiting means: paid and filed, no card yet, not closed (Card issued, Not
   issued, Revoked), not spam, not removed. For each, the checks are made
   here, on the server, from the register itself rather than from what the
   browser has:

     photo     the face for the card is attached (the fee clears first and
               the photograph is copied on after, so it can lag)
     fee       the payment it was filed from
     place     a district and a state from the list, the PIN in that state
     post      a street and a six-digit PIN: the printed card is the only
               copy, and it is posted (owner, 24 Oct 2026)
     email     where the approval and posting notices go; without one the
               card is still posted, and nobody is told
     mobile    the mobile already holds a card: issuing would be refused
     identity  the same name and PIN already hold a card (a household may
               legitimately have two, so this warns and does not block)

   A check is 'ok', 'warn' (look before issuing) or 'stop' (issuing will be
   refused, or would print a card without a face). Issue and Reject are
   actions on the case (lib/routes/admin/case.js), which re-checks all of
   this in its own transaction: this list is advice, the action is the rule.

   Each waiting application is given its card number here, at random
   (lib/routes/admin/case.js reserveCardNumber), so the preview shows the
   number the card will carry; that is the only thing this route writes.

   Needs the Caregivers section; deciding also needs Submissions,
   which the case route enforces. */

'use strict';

const { requireAdmin } = require('../../admin-auth');
const firebase = require('../../firebase');
const FLOW = require('../../case-flow');
const PLACE = require('../../caregiver-place');
const CAREGIVER = require('../../caregiver');
const INDIA = require('../../../assets/india-districts.js');
const RULES = require('../../../assets/field-rules.js');
const PRINT = require('../../../assets/card-print.js');

const KIND = 'PFA-CG';
const MAX_SCAN = 500;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function msOf(data) {
  const n = Number(data.receivedAtMs);
  if (Number.isFinite(n) && n > 0) return n;
  const c = data.createdAt;
  const t = c && typeof c.toMillis === 'function' ? c.toMillis() : Date.parse(c);
  return Number.isFinite(t) ? t : 0;
}

/* Whether the application is still waiting for someone to decide it. */
function waiting(data) {
  if (!data || data.kind !== KIND) return false;
  if (data.cardId) return false;
  if (data.status === 'removed' || data.status === 'spam') return false;
  return !FLOW.isClosed(KIND, FLOW.currentOf(data));
}

/* The name as the card would print it (assets/card-print.js): whole when
   it fits at the card's one size, otherwise the fixed rule's short form,
   which a reviewer confirms before issuing. */
function printOf(f) {
  return PRINT.suggestName(RULES.nameCase(clean(f.name, 80)));
}

/* The checks, in the order a reviewer reads them. */
function checksOf(f, data, held) {
  const out = [];
  const printed = printOf(f);
  if (!clean(f.name, 80)) out.push({ key: 'name', level: 'stop', text: 'No name on the application' });
  else if (!printed.fits) out.push({ key: 'name', level: 'stop', text: 'The name is too long for the card: type the name to print' });
  else if (printed.shortened) out.push({ key: 'name', level: 'warn', text: `Too long to print whole: printed as ${printed.text}. Check it reads right` });
  else out.push({ key: 'name', level: 'ok', text: 'Name fits the card' });
  const photoPending = data.photoPending === true;
  const hasPhoto = (Number(data.attachments) || 0) >= 1 && !photoPending;
  out.push(hasPhoto
    ? { key: 'photo', level: 'ok', text: 'Photograph attached' }
    : { key: 'photo', level: 'stop', text: photoPending ? 'Photograph not attached yet' : 'No photograph: the card needs a face' });

  const pay = data.payment || {};
  out.push(pay.orderId
    ? { key: 'fee', level: 'ok', text: `Fee paid${Number(pay.amount) ? `: ₹${Number(pay.amount).toLocaleString('en-IN')}` : ''}` }
    : { key: 'fee', level: 'warn', text: 'No payment on the record' });

  const district = clean(f.district, 60);
  const state = clean(f.state, 40);
  const pin = clean(f.pin || f.pincode, 10).replace(/\D/g, '');
  let place = { key: 'place', level: 'ok', text: [district, state].filter(Boolean).join(', ') };
  const printedPlace = [PRINT.placeName(district), PRINT.placeName(state)];
  if (!district || !state) place = { key: 'place', level: 'stop', text: 'District or state missing: the card prints both' };
  else if (!PRINT.fits(printedPlace[0]) || !PRINT.fits(printedPlace[1])) place = { key: 'place', level: 'stop', text: 'The district or state is too long for the card' };
  else if (!INDIA.isState(state)) place = { key: 'place', level: 'warn', text: `${state} is not a state on the list` };
  else if (!INDIA.pairOk(state, district)) place = { key: 'place', level: 'warn', text: `${district} is not a district of ${state}` };
  else if (pin && !INDIA.pinOk(state, pin)) place = { key: 'place', level: 'warn', text: `PIN ${pin} is not in ${state}` };
  out.push(place);

  /* the printed card is the only copy, and it is posted */
  const street = [clean(f.address, 200), clean(f.city, 80)].filter(Boolean).join(', ');
  out.push(CAREGIVER.postable({ address: street, pin: CAREGIVER.extractPin(street) || pin })
    ? { key: 'post', level: 'ok', text: 'Postal address with PIN' }
    : { key: 'post', level: 'stop', text: 'No full postal address: the card is posted' });

  out.push(clean(f.email, 254)
    ? { key: 'email', level: 'ok', text: 'Email given' }
    : { key: 'email', level: 'warn', text: 'No email: the card is still posted, but nobody is told' });

  if (held.mobile) out.push({ key: 'mobile', level: 'stop', text: `This mobile already holds ${held.mobile}` });
  if (held.identity) out.push({ key: 'identity', level: 'warn', text: `Same name and PIN as ${held.identity}` });
  return out;
}

/* What the register already holds for this mobile, and for this name and
   PIN: the same two indexes issuing reads (lib/caregiver-store.js). */
async function heldBy(db, f) {
  const out = { mobile: '', identity: '' };
  const mobile = CAREGIVER.normaliseMobile(clean(f.mobile, 20));
  if (mobile) {
    try {
      const snap = await db.collection('caregiverMobileIndex').doc(mobile).get();
      if (snap.exists) out.mobile = clean((snap.data() || {}).cardId, 40);
    } catch (_) { /* the action re-checks */ }
  }
  const name = clean(f.name, 60);
  const pin = clean(f.pin || f.pincode, 10).replace(/\D/g, '');
  if (name && pin) {
    try {
      const snap = await db.collection('caregiverIdentityIndex').doc(CAREGIVER.identityKey(name, pin)).get();
      if (snap.exists) out.identity = clean((snap.data() || {}).cardId, 40);
    } catch (_) { /* advice only */ }
  }
  return out;
}

function rowOf(reference, data, held) {
  const f = data.fields || {};
  const checks = checksOf(f, data, held);
  const printed = printOf(f);
  const stops = checks.filter((c) => c.level === 'stop' && c.key !== 'name').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  return {
    reference,
    receivedAtMs: msOf(data),
    status: FLOW.currentOf(data),
    statusLabel: FLOW.labelOf(KIND, FLOW.currentOf(data)),
    name: RULES.nameCase(clean(f.name, 80)),
    /* the name the card would print, and whether the reviewer must confirm
       it (shortened) or type one (too long for any rule) */
    printName: printed.fits ? printed.text : '',
    printShortened: printed.shortened,
    printNeeded: !printed.fits,
    mobile: clean(f.mobile, 20),
    email: clean(f.email, 254).toLowerCase(),
    address: clean(f.address, 240),
    city: clean(f.city, 80),
    district: clean(f.district, 60),
    state: clean(f.state, 40),
    pin: clean(f.pin || f.pincode, 10),
    animals: clean(f.animals, 20),
    notes: clean(f.notes, 600),
    attachments: Number(data.attachments) || 0,
    photoPending: data.photoPending === true,
    assignedTo: (data.assignedTo && data.assignedTo.email) || '',
    checks,
    ready: stops === 0,
    verdict: stops ? 'stop' : warns ? 'warn' : 'ok'
  };
}

async function listWaiting(db) {
  const snap = await db.collection('submissions').where('kind', '==', KIND).limit(MAX_SCAN).get();
  const pending = [];
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (waiting(data)) pending.push({ reference: doc.id, data });
  });
  const rows = await Promise.all(pending.map(async ({ reference, data }) => {
    /* an application filed before v1.450 is shown with the district and
       state its payment kept, as the drawer and the card do */
    const placed = await PLACE.withPlace(db, data);
    const held = await heldBy(db, placed.fields || {});
    const row = rowOf(reference, placed, held);
    /* the card's own number, random and chosen now, so the preview shows
       the number the card will carry (29 Oct 2026) */
    try { row.cardNumber = await require('./case').reserveCardNumber(db, reference, CAREGIVER.createCardId); } catch (_) { row.cardNumber = ''; }
    return row;
  }));
  rows.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  return { rows, capped: snap.size >= MAX_SCAN };
}

module.exports = async function handler(request, response) {
  const who = await requireAdmin(request, response, 'caregivers');
  if (!who) return undefined;
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const db = firebase.getDb();
    const { rows, capped } = await listWaiting(db);
    return sendJson(response, 200, {
      ok: true,
      rows,
      total: rows.length,
      ready: rows.filter((r) => r.ready).length,
      capped
    });
  } catch (error) {
    console.error('admin applications failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The applications could not be read right now.' });
  }
};

module.exports._private = { waiting, checksOf, rowOf, listWaiting, heldBy, printOf };
