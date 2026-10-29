'use strict';

/* Firestore records for the Colony Caregiver Card.

   Collections
     caretakerApplicants/{applicantId}  the person: name, mobile, email
     caretakerCards/{cardId}            the credential, one per applicant
     caretakerAddresses/{addressId}     card address and delivery addresses,
                                        stored separately and never overwritten
     caretakerOrders/{orderId}          a paid shipping order
     caretakerShipments/{shipmentId}    the parcel and its status history
     caretakerPublic/{cardId}           denormalised read model (see below)
     caregiverMobileIndex/{mobile}      one active card per person
     caregiverEmails/{emailId}          outbound queue with attempts and errors
     caretakerAudit/{eventId}           who changed what, when

   Read-cost note: the public card page is the only page that will ever see
   real volume, and it is a share link, so it gets hit by people who are not
   the holder. It therefore reads exactly ONE document - caretakerPublic - which
   is written whenever anything it displays changes. No joins, no queries, no
   fan-out reads. At the CDN it is cached for five minutes with a long
   stale-while-revalidate, so the steady-state cost of a viral card is close to
   zero Firestore reads rather than one read per view. */

const { getDb, serverTimestamp } = require('./firebase');
const CAREGIVER = require('./caregiver');

const applicantRef = (db, id) => db.collection('caretakerApplicants').doc(id);
const cardRef = (db, id) => db.collection('caretakerCards').doc(id);
const addressRef = (db, id) => db.collection('caretakerAddresses').doc(id);
const orderRef = (db, id) => db.collection('caretakerOrders').doc(id);
const shipmentRef = (db, id) => db.collection('caretakerShipments').doc(id);
const publicRef = (db, id) => db.collection('caretakerPublic').doc(id);
const mobileRef = (db, mobile) => db.collection('caregiverMobileIndex').doc(CAREGIVER.normaliseMobile(mobile));
const identityRef = (db, key) => db.collection('caregiverIdentityIndex').doc(key);
const emailRef = (db, id) => db.collection('caregiverEmails').doc(id);
const auditRef = (db, id) => db.collection('caretakerAudit').doc(id);

async function audit(entry) {
  const db = getDb();
  const id = CAREGIVER.createEventId();
  await auditRef(db, id).set({
    eventId: id,
    actor: CAREGIVER.clean(entry.actor, 80) || 'system',
    action: CAREGIVER.clean(entry.action, 60),
    entity: CAREGIVER.clean(entry.entity, 80),
    detail: entry.detail || {},
    at: new Date().toISOString(),
    createdAt: serverTimestamp()
  });
  return id;
}

/* The read model. Written on issuance and on every shipment change; nothing
   else ever needs to be read to render the public page. */
function buildPublic(card, shipment) {
  return {
    ...CAREGIVER.publicProjection({ card, shipment }),
    revision: (card.revision || 0) + 1,
    updatedAt: new Date().toISOString()
  };
}

async function writePublic(db, transactionOrDb, card, shipment) {
  const doc = buildPublic(card, shipment);
  const ref = publicRef(db, card.cardId);
  if (transactionOrDb && typeof transactionOrDb.set === 'function' && transactionOrDb.get) {
    transactionOrDb.set(ref, doc, { merge: true });
  } else {
    await ref.set(doc, { merge: true });
  }
  return doc;
}

async function getPublicCard(cardId) {
  const db = getDb();
  const snapshot = await publicRef(db, cardId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function getCard(cardId) {
  const db = getDb();
  const snapshot = await cardRef(db, cardId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getShipment(shipmentId) {
  const db = getDb();
  const snapshot = await shipmentRef(db, shipmentId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

/* Issue a card on the register: the back office's Approve, and nothing
   else (lib/routes/admin/case.js). The card itself is printed and posted.

   Duplicate prevention has two layers. The mobile index is the hard one: it is
   created inside the transaction, so two submissions racing from a double-tap
   or a flaky connection cannot both mint a card. The idempotency key is the
   soft one: an identical retry returns the identical card instead of an error,
   which is what a browser that never saw the first response actually needs. */
async function issueCard({ application, idempotencyKey, requestMeta }) {
  const db = getDb();
  const now = new Date().toISOString();
  const mobile = CAREGIVER.normaliseMobile(application.mobile);
  const rawToken = CAREGIVER.createCardToken();

  const identityKey = CAREGIVER.identityKey(application.name, application.pin);

  const result = await db.runTransaction(async (transaction) => {
    const indexRef = mobileRef(db, mobile);
    const idRef = identityRef(db, identityKey);
    const indexSnapshot = await transaction.get(indexRef);
    const identitySnapshot = await transaction.get(idRef);

    if (indexSnapshot.exists) {
      const heldCardId = CAREGIVER.clean(indexSnapshot.data().cardId, 60);
      const heldSnapshot = await transaction.get(cardRef(db, heldCardId));
      if (heldSnapshot.exists) {
        const held = { id: heldSnapshot.id, ...heldSnapshot.data() };
        const sameRequest = idempotencyKey
          && CAREGIVER.clean(held.idempotencyKey, 200) === CAREGIVER.clean(idempotencyKey, 200);
        return { card: held, reissued: true, sameRequest, token: null, duplicate: 'mobile' };
      }
    }

    /* A soft match: same name, same PIN, different mobile. Two people in one
       household can legitimately both hold a card, so this does not block. It
       is recorded on the new card and returned so the journey can say so. */
    let softDuplicateOf = null;
    if (identitySnapshot.exists) {
      softDuplicateOf = CAREGIVER.clean(identitySnapshot.data().cardId, 60) || null;
    }

    const applicantId = CAREGIVER.createApplicantId();
    /* The number chosen for this application before it was issued, shown on
       the reviewer's preview (lib/routes/admin/case.js reserveCardNumber),
       when no card carries it yet; otherwise a fresh random one. */
    let cardId = CAREGIVER.createCardId();
    const reserved = CAREGIVER.clean(application.cardId, 20).toUpperCase();
    if (/^PFA-CCT-[A-Z0-9]{8}$/.test(reserved)) {
      const taken = await transaction.get(cardRef(db, reserved));
      if (!taken.exists) cardId = reserved;
    }
    const addressId = CAREGIVER.createAddressId();
    const { issuedAt, validUntil } = CAREGIVER.computeValidity(now);

    transaction.set(applicantRef(db, applicantId), {
      applicantId,
      name: application.name,
      mobile,
      email: application.email,
      cardId,
      source: 'pfa-website',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.set(addressRef(db, addressId), {
      addressId,
      cardId,
      type: 'card',
      address: application.address,
      district: application.district || '',
      state: application.state || '',
      pin: application.pin,
      fingerprint: CAREGIVER.addressFingerprint(application.address, application.pin),
      createdAt: serverTimestamp()
    });

    const card = {
      cardId,
      applicantId,
      name: application.name,
      /* the name as printed, confirmed by the reviewer when it was shortened
         to fit the card at its fixed size (assets/card-print.js) */
      printName: application.printName || '',
      mobile,
      email: application.email,
      addressId,
      address: application.address,
      district: application.district || '',
      state: application.state || '',
      pin: application.pin,
      status: 'active',
      printed: false,
      issuedAt,
      validUntil,
      channel: 'digital-free',
      tokenHash: CAREGIVER.hashToken(rawToken),
      idempotencyKey: CAREGIVER.clean(idempotencyKey, 200) || null,
      identityKey,
      householdKey: CAREGIVER.householdKey(application.address, application.pin),
      softDuplicateOf,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    transaction.set(cardRef(db, cardId), card);
    transaction.set(indexRef, {
      mobile,
      cardId,
      applicantId,
      createdAt: serverTimestamp()
    });

    /* First writer wins the identity slot; later matches read it and warn. */
    if (!identitySnapshot.exists) {
      transaction.set(idRef, { identityKey, cardId, createdAt: serverTimestamp() });
    }

    transaction.set(publicRef(db, cardId), buildPublic(card, null));

    return {
      card,
      reissued: false,
      sameRequest: false,
      token: rawToken,
      duplicate: softDuplicateOf ? 'identity' : null,
      softDuplicateOf
    };
  });

  await audit({
    actor: 'applicant',
    action: result.reissued ? 'card.reissue_attempt' : 'card.issued',
    entity: `card:${result.card.cardId}`,
    detail: {
      mobileMasked: `••••••${mobile.slice(-4)}`,
      ip: requestMeta && requestMeta.ip,
      duplicate: result.duplicate || null,
      softDuplicateOf: result.softDuplicateOf || null
    }
  });

  return result;
}

/* Verify a caller holds the card. Used before anything that spends money or
   changes an address. */
async function authoriseCard(cardId, rawToken) {
  const card = await getCard(cardId);
  if (!card) return null;
  if (!rawToken) return null;
  return CAREGIVER.safeEqual(card.tokenHash, CAREGIVER.hashToken(rawToken)) ? card : null;
}

/* Record a shipping order before the applicant is sent to CCAvenue. The
   delivery address is resolved and stored here, server-side, so the payment
   form never carries an address the browser could tamper with. */
async function createShippingOrder({ card, delivery, orderId, amount }) {
  const db = getDb();
  const now = new Date().toISOString();
  let deliveryAddressId = card.addressId;

  if (!delivery.sameAsCardAddress) {
    deliveryAddressId = CAREGIVER.createAddressId();
    await addressRef(db, deliveryAddressId).set({
      addressId: deliveryAddressId,
      cardId: card.cardId,
      type: 'delivery',
      recipient: delivery.recipient || card.name,
      address: delivery.address,
      pin: delivery.pin,
      fingerprint: CAREGIVER.addressFingerprint(delivery.address, delivery.pin),
      createdAt: serverTimestamp()
    });
  }

  const order = {
    orderId,
    cardId: card.cardId,
    applicantId: card.applicantId,
    type: 'physical-card',
    amount: Number(amount),
    currency: 'INR',
    status: 'pending_payment',
    deliveryAddressId,
    sameAsCardAddress: Boolean(delivery.sameAsCardAddress),
    recipient: delivery.sameAsCardAddress ? card.name : (delivery.recipient || card.name),
    deliveryPin: delivery.sameAsCardAddress ? card.pin : delivery.pin,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAtIso: now
  };

  await orderRef(db, orderId).set(order);
  await audit({
    actor: 'applicant',
    action: 'order.created',
    entity: `order:${orderId}`,
    detail: { cardId: card.cardId, sameAsCardAddress: order.sameAsCardAddress }
  });

  return order;
}

/* Called from the verified CCAvenue callback. Marks the order paid, opens the
   shipment with its own tracking id, and refreshes the public read model - all
   in one transaction so a card can never show "paid" without a shipment or a
   shipment without a payment. Re-entrant: CCAvenue can and does call back more
   than once, and the second call must not create a second parcel. */
async function recordPaidShipping({ orderId, payment }) {
  const db = getDb();
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const oRef = orderRef(db, orderId);
    const orderSnapshot = await transaction.get(oRef);
    if (!orderSnapshot.exists) throw new Error('The shipping order could not be found.');
    const order = { id: orderSnapshot.id, ...orderSnapshot.data() };

    const cRef = cardRef(db, order.cardId);
    const cardSnapshot = await transaction.get(cRef);
    if (!cardSnapshot.exists) throw new Error('The card for this order could not be found.');
    const card = { id: cardSnapshot.id, ...cardSnapshot.data() };

    /* Re-entrancy is per ORDER, not per card: a replacement order is a second
       parcel on the same card and must be allowed to open. */
    if (order.status === 'paid' && order.shipmentId) {
      const existing = await transaction.get(shipmentRef(db, order.shipmentId));
      return {
        order,
        card,
        shipment: existing.exists ? { id: existing.id, ...existing.data() } : null,
        alreadyRecorded: true
      };
    }

    const shipmentId = CAREGIVER.createShipmentId();
    const shipment = {
      shipmentId,
      trackingId: shipmentId,
      orderId,
      cardId: card.cardId,
      status: 'order_confirmed',
      carrier: null,
      carrierTrackingNumber: null,
      deliveryAddressId: order.deliveryAddressId,
      recipient: order.recipient,
      dispatchedAt: null,
      deliveredAt: null,
      kind: order.kind === 'replacement' ? 'replacement' : 'original',
      history: [{
        status: 'order_confirmed',
        at: now,
        note: order.kind === 'replacement' ? 'Replacement card paid for' : 'Shipping payment received',
        actor: 'system'
      }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtIso: now
    };

    transaction.set(shipmentRef(db, shipmentId), shipment);

    transaction.update(oRef, {
      status: 'paid',
      shipmentId,
      paidAt: now,
      payment: {
        gateway: 'ccavenue',
        transactionId: payment.orderId || orderId,
        trackingId: payment.trackingId || null,
        bankReference: payment.bankReference || null,
        paymentMode: payment.paymentMode || null,
        responseStatus: payment.rawStatus || null,
        amount: Number(payment.amount || order.amount),
        currency: 'INR',
        verifiedAt: now
      },
      updatedAt: serverTimestamp()
    });

    const updatedCard = { ...card, printed: true, revision: (card.revision || 0) + 1 };
    transaction.update(cRef, { printed: true, shipmentId, revision: updatedCard.revision, updatedAt: serverTimestamp() });
    transaction.set(publicRef(db, card.cardId), buildPublic(card, shipment), { merge: true });

    return { order: { ...order, status: 'paid', shipmentId }, card: updatedCard, shipment, alreadyRecorded: false };
  });
}

/* Replacing a lost printed card.

   The rule that matters: a replacement is a new PARCEL, never a new card. The
   card number, its issue date and its validity are untouched, so a card that
   has been shown to a police officer or written into a colony register does not
   change under them. Only a fresh shipment and a fresh payment are created. */
async function createReplacementOrder({ card, delivery, orderId, amount, reason }) {
  const db = getDb();
  const order = await createShippingOrder({ card, delivery, orderId, amount });
  await orderRef(db, orderId).set({
    kind: 'replacement',
    replacesShipmentId: card.shipmentId || null,
    reason: CAREGIVER.clean(reason, 120) || 'lost',
    updatedAt: serverTimestamp()
  }, { merge: true });

  await audit({
    actor: 'applicant',
    action: 'card.replacement_ordered',
    entity: `card:${card.cardId}`,
    detail: { orderId, replaces: card.shipmentId || null, reason: CAREGIVER.clean(reason, 120) }
  });

  return { ...order, kind: 'replacement' };
}

/* Verifying a lost-card claim without an OTP: the card number is public (it is
   printed on the card, which is exactly what has been lost), so it is never
   enough on its own. The mobile number on the record must match too. */
async function verifyCardClaim({ cardId, mobile }) {
  const card = await getCard(cardId);
  if (!card) return { ok: false, reason: 'not_found' };
  if (card.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (CAREGIVER.normaliseMobile(mobile) !== card.mobile) return { ok: false, reason: 'mismatch' };
  return { ok: true, card };
}

/* Admin-controlled status update. The state machine is enforced here rather
   than in the panel, so the same rules hold for a courier webhook or a script. */
async function updateShipmentStatus({ shipmentId, status, carrier, carrierTrackingNumber, note, actor }) {
  const db = getDb();
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const sRef = shipmentRef(db, shipmentId);
    const snapshot = await transaction.get(sRef);
    if (!snapshot.exists) throw new Error('That shipment could not be found.');
    const shipment = { id: snapshot.id, ...snapshot.data() };

    if (!CAREGIVER.canTransition(shipment.status, status)) {
      const error = new Error(`A shipment cannot move from ${CAREGIVER.shipmentLabel(shipment.status)} to ${CAREGIVER.shipmentLabel(status)}.`);
      error.code = 'INVALID_TRANSITION';
      throw error;
    }

    const cardSnapshot = await transaction.get(cardRef(db, shipment.cardId));
    const card = cardSnapshot.exists ? { id: cardSnapshot.id, ...cardSnapshot.data() } : null;

    const history = Array.isArray(shipment.history) ? shipment.history.slice(-60) : [];
    history.push({
      status,
      at: now,
      note: CAREGIVER.clean(note, 160) || null,
      actor: CAREGIVER.clean(actor, 80) || 'admin'
    });

    const patch = {
      status,
      history,
      updatedAt: serverTimestamp(),
      updatedAtIso: now
    };
    if (carrier !== undefined) patch.carrier = CAREGIVER.clean(carrier, 60) || null;
    if (carrierTrackingNumber !== undefined) patch.carrierTrackingNumber = CAREGIVER.clean(carrierTrackingNumber, 60) || null;
    if (status === 'dispatched' && !shipment.dispatchedAt) patch.dispatchedAt = now;
    if (status === 'delivered') patch.deliveredAt = now;

    transaction.update(sRef, patch);

    const nextShipment = { ...shipment, ...patch, updatedAt: now };
    if (card) transaction.set(publicRef(db, card.cardId), buildPublic(card, nextShipment), { merge: true });

    return { shipment: nextShipment, card };
  });
}

/* ---- the outbound email queue (caregiverEmails) ---------------------------

   Writing the row is part of the same request that caused it, but sending is
   a separate step: a slow or down mail provider must never fail an
   application or a payment callback.

   A row's status, and who may send it (8 Oct 2026, review C items 2, 4, 5):

     queued    written, not tried yet. A row written without a claim (the
               callers that send it themselves straight after) is not due
               until HEAD_START_MS has passed, so a worker or the panel's
               Resend never sends it while that request still is.
     sending   claimed: one sender holds it until leaseUntil. Claiming is a
               transaction, so two workers, a worker and Resend, or Resend
               pressed twice cannot both send the same row. A lease that has
               run out (the sender's function was frozen or died) is
               anyone's again. A row whose last attempt ended with no answer
               after the message was handed over (outcome not known) stays
               here, marked uncertain, until its lease runs out: sending it
               again at once would make a duplicate certain, waiting makes
               one only possible.
     retry     tried and refused for now; due again at nextAttemptAt.
     sent      the provider took it. Never sent again.
     failed    parked: six counted attempts, or an address the receiving
               server refused for good (a 5xx about the recipient). The
               worker leaves it; the panel lists it and Resend can send it.

   Failures are counted by kind (failureKind below). A wrong password or a
   missing setting is the site's fault, not the email's: it is not counted
   toward the six, and the row stays retryable, so mending the password
   sends everything that waited (until 8 Oct 2026 a bad password parked
   every email after six tries and nothing sent them). */

const LEASE_MS = 3 * 60 * 1000;          // two servers x (10 s connect + 10 s greeting + 20 s per step), and the upload, with room
const HEAD_START_MS = LEASE_MS;          // the request that wrote an unclaimed row sends it first
const MAX_ATTEMPTS = 6;
const CONFIG_RETRY_MS = 15 * 60 * 1000;  // a login failure is tried again soon, uncounted
/* The mailbox's login, one gate for every server and every row (8 Oct 2026).
   The worker now runs every ten minutes, and a mailbox asked again and again
   with a wrong password can be locked by GoDaddy; a wait per row did not
   stop that, since each run would simply try the next row. So after a
   refused login the worker leaves the mailbox alone for 15 minutes, then
   30, then an hour at most, until a login works again. The panel's Send
   again, and a form being sent, still try at once, and a success opens the
   gate for the rest. */
const LOGIN_GATE_MAX_MS = 60 * 60 * 1000;
function configRetryMs(failures) {
  return Math.min(CONFIG_RETRY_MS * (2 ** Math.max(0, Number(failures) || 0)), LOGIN_GATE_MAX_MS);
}
const gateRef = (db) => db.collection('mailHealth').doc('login');

async function loginGate() {
  const snap = await gateRef(getDb()).get();
  const d = snap.exists ? snap.data() || {} : {};
  const next = Date.parse(String(d.nextTryAt || ''));
  return { failures: Number(d.failures) || 0, nextTryAt: d.nextTryAt || null, closed: Number.isFinite(next) && next > Date.now(), lastError: d.lastError || '' };
}

async function noteLoginFailure(message) {
  const db = getDb();
  const ref = gateRef(db);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() || {} : {};
    const failures = Number(d.failures) || 0;
    const nowMs = Date.now();
    const next = new Date(nowMs + configRetryMs(failures)).toISOString();
    tx.set(ref, { failures: failures + 1, lastFailedAt: new Date(nowMs).toISOString(), nextTryAt: next, lastError: CAREGIVER.clean(message, 300), on: serverName() });
    return next;
  });
}

async function noteLoginWorks() {
  const db = getDb();
  const ref = gateRef(db);
  const snap = await ref.get();
  if (!snap.exists || !(Number((snap.data() || {}).failures) > 0)) return false;
  await ref.set({ failures: 0, nextTryAt: null, lastError: '', recoveredAt: new Date().toISOString() });
  return true;
}
/* Which server the attempt was made from, for the panel's explanation: a
   wrong password on the site (Vercel) is mended in Vercel, one on the panel
   (Firebase) in Firebase. */
function serverName() {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FIREBASE_CONFIG) return 'firebase';
  return 'local';
}

const emailIdFor = (template, dedupeKey) => `${template}_${CAREGIVER.hashToken(dedupeKey).slice(0, 32)}`;
const newClaimToken = () => require('crypto').randomBytes(12).toString('hex');
const msOf = (iso) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? t : 0; };

/* What a failure means for the row. The mailer marks its own errors with
   `kind`; callers that pass only the message text (older routes) are read
   from the words, and only ever as a login or setup problem, never as a bad
   address, so a guess can only make a row wait longer, not park it. */
const CONFIG_WORDS = /MAIL_NOT_CONFIGURED|No mail is configured|EAUTH|ENOAUTH|Invalid login|Missing credentials|\b53[0458]\b|authenticat|ENOTFOUND/i;
function failureKind(error, hint) {
  const e = error && typeof error === 'object' ? error : {};
  const given = hint || e.kind;
  if (['config', 'recipient', 'unknown', 'transient'].includes(given)) return given;
  if (e.uncertain) return 'unknown';
  if (e.config) return 'config';
  if (e.permanent || e.code === 'INVALID_RECIPIENT') return 'recipient';
  const text = typeof error === 'string' ? error : `${e.code || ''} ${e.message || ''}`;
  return CONFIG_WORDS.test(text) ? 'config' : 'transient';
}

/* Whether a row may be claimed now. `o.includeFailed` and `o.ignoreSchedule`
   are for Resend, which is pressed by a person to send now: it takes parked
   rows and rows waiting out a backoff, but never a live lease and never an
   unclaimed row inside its writer's head start. */
function claimable(row, nowMs, o) {
  const opts = o || {};
  switch (row && row.status) {
    case 'sending': return msOf(row.leaseUntil) <= nowMs;
    case 'queued': return msOf(row.nextAttemptAt) <= nowMs;
    case 'retry': return Boolean(opts.ignoreSchedule) || msOf(row.nextAttemptAt) <= nowMs;
    case 'failed': return Boolean(opts.includeFailed);
    default: return false;   // sent, or a status this code does not know: left alone
  }
}

/* `claim` (a short name for who sends it, e.g. 'immediate') writes the row
   already claimed by the caller, so nothing else sends it while the caller
   does; the answer then carries the claimToken to record the result with.
   Without it the row is written 'queued' with a head start (see above). An
   existing row is never touched; the answer says its status. */
async function queueEmail({ template, to, payload, dedupeKey, claim }) {
  const db = getDb();
  const id = dedupeKey ? emailIdFor(template, dedupeKey) : CAREGIVER.createEventId();
  const token = claim ? newClaimToken() : null;

  const ref = emailRef(db, id);
  const outcome = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return { created: false, status: String((snapshot.data() || {}).status || '') };
    const nowMs = Date.now();
    const row = {
      emailId: id,
      template,
      to: CAREGIVER.clean(to, 254).toLowerCase(),
      payload: payload || {},
      status: claim ? 'sending' : 'queued',
      attempts: 0,
      lastError: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      nextAttemptAt: new Date(claim ? nowMs : nowMs + HEAD_START_MS).toISOString()
    };
    if (claim) {
      Object.assign(row, {
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString(),
        claimedBy: CAREGIVER.clean(claim, 80) || 'immediate',
        claimedAt: new Date(nowMs).toISOString(),
        claimToken: token
      });
    }
    transaction.set(ref, row);
    return { created: true, status: row.status };
  });

  return Object.assign({ emailId: id, created: outcome.created, status: outcome.status }, outcome.created && token ? { claimToken: token } : {});
}

/* Filtering on status and ordering on nextAttemptAt in one query needs a
   composite index that nothing deploys; without it the worker failed on
   every run and nothing queued was ever retried. So the query asks only for
   the statuses that can be due, which a single-field index answers, and the
   due-time check and the ordering are done here. This only LISTS what is
   due: each row is claimed with claimEmail just before it is sent, so a
   long batch never outlives the leases of its last rows. */
async function dueEmails(limit) {
  const db = getDb();
  const nowMs = Date.now();
  const snapshot = await db.collection('caregiverEmails')
    .where('status', 'in', ['queued', 'retry', 'sending'])
    .limit(Math.max(100, (limit || 20) * 5))
    .get();
  const dueAt = (item) => (item.status === 'sending' ? String(item.leaseUntil || '') : String(item.nextAttemptAt || ''));
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data(), emailId: (doc.data() || {}).emailId || doc.id }))
    .filter((item) => claimable(item, nowMs))
    .sort((a, b) => dueAt(a).localeCompare(dueAt(b)))
    .slice(0, limit || 20);
}

/* Takes one row for sending, in a transaction: answers the row with a
   claimToken, or null when it is not there, already sent, parked (unless
   o.includeFailed), not due, or held by someone else's live lease. */
async function claimEmail(emailId, o) {
  const opts = o || {};
  const db = getDb();
  const ref = emailRef(db, String(emailId || ''));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const row = snapshot.data() || {};
    const nowMs = Date.now();
    if (!claimable(row, nowMs, opts)) return null;
    const lease = {
      status: 'sending',
      leaseUntil: new Date(nowMs + (Number(opts.leaseMs) || LEASE_MS)).toISOString(),
      claimedBy: CAREGIVER.clean(opts.by, 80) || 'worker',
      claimedAt: new Date(nowMs).toISOString(),
      claimToken: newClaimToken()
    };
    transaction.update(ref, Object.assign({ updatedAt: serverTimestamp() }, lease));
    return Object.assign({ id: snapshot.id }, row, { emailId: row.emailId || snapshot.id, previousStatus: row.status }, lease);
  });
}

/* Records what happened to one attempt, in a transaction.

   - `claimToken`: the claim this attempt was made under. A failure from a
     sender whose claim has since been taken over (its lease ran out and
     another sender has the row) changes nothing; a success is always
     written, because the email went.
   - Each claim counts once toward the attempts, even when its result is
     written twice (an "outcome not known" note, then the late answer).
   - `kind` (or the error itself, see failureKind): 'config' is not
     counted and stays retryable; 'recipient' parks the row at once;
     'unknown' keeps the row claimed until its lease runs out, marked
     uncertain for the panel; 'transient' backs off, and parks after six.
     `permanent: true` and `uncertain: true` are accepted for 'recipient'
     and 'unknown'. */
async function recordEmailResult({ emailId, ok, error, providerId, claimToken, kind, permanent, uncertain }) {
  const db = getDb();
  const ref = emailRef(db, emailId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const current = snapshot.data() || {};
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    /* A sender with a claim speaks only while the claim is still its own
       (every release clears the token). A caller with none (the older
       routes that send their own row at once) is heard unless a live claim
       is held by someone else. */
    const heldByOther = claimToken
      ? current.claimToken !== claimToken
      : current.status === 'sending' && msOf(current.leaseUntil) > nowMs && Boolean(current.claimToken);
    const already = claimToken && current.countedToken === claimToken;
    const attempts = (Number(current.attempts) || 0) + (already ? 0 : 1);
    const release = { leaseUntil: null, claimToken: null };

    if (ok) {
      if (current.status === 'sent') return { status: 'sent', attempts: Number(current.attempts) || 0 };
      transaction.update(ref, Object.assign({
        status: 'sent',
        attempts,
        countedToken: claimToken || null,
        providerId: providerId || null,
        sentAt: nowIso,
        lastError: null,
        lastErrorKind: null,
        updatedAt: serverTimestamp()
      }, release));
      return { status: 'sent', attempts };
    }

    /* a late failure never undoes a send, and never overrides the sender
       that holds the row now */
    if (current.status === 'sent' || heldByOther) {
      return { status: current.status, attempts: Number(current.attempts) || 0, ignored: true };
    }

    const what = failureKind(error, uncertain ? 'unknown' : permanent ? 'recipient' : kind);
    const text = CAREGIVER.clean(typeof error === 'string' ? error : (error && error.message) || String(error || ''), 300);
    const common = { lastError: text, lastErrorKind: what, lastErrorAt: nowIso, lastErrorOn: serverName(), updatedAt: serverTimestamp() };

    if (what === 'config') {
      transaction.update(ref, Object.assign({
        status: 'retry',
        configFailures: (Number(current.configFailures) || 0) + 1,
        nextAttemptAt: new Date(nowMs + CONFIG_RETRY_MS).toISOString()
      }, common, release));
      return { status: 'retry', attempts: Number(current.attempts) || 0, kind: what };
    }

    const giveUp = what === 'recipient' || attempts >= MAX_ATTEMPTS;
    if (what === 'unknown' && !giveUp) {
      transaction.update(ref, Object.assign({
        status: 'sending',
        attempts,
        countedToken: claimToken || null,
        uncertain: true,
        uncertainAt: nowIso,
        leaseUntil: new Date(nowMs + LEASE_MS).toISOString(),
        nextAttemptAt: new Date(nowMs + LEASE_MS).toISOString()
      }, common));
      return { status: 'sending', attempts, kind: what, uncertain: true };
    }

    const backoffMinutes = Math.min(2 ** attempts, 240);
    const status = giveUp ? 'failed' : 'retry';
    transaction.update(ref, Object.assign({
      status,
      attempts,
      countedToken: claimToken || null,
      nextAttemptAt: new Date(nowMs + backoffMinutes * 60000).toISOString()
    }, what === 'unknown' ? { uncertain: true, uncertainAt: nowIso } : {}, common, release));
    return { status, attempts, kind: what };
  });
}

async function getAddress(addressId) {
  const db = getDb();
  const snapshot = await addressRef(db, addressId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function getOrder(orderId) {
  const db = getDb();
  const snapshot = await orderRef(db, orderId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

/* A bounce that came back for an email the site sent (lib/inbound-mail.js
   reads it from the mailbox and names our Message-ID). The queue row that
   sent it said "sent"; it now says it was not delivered, so the panel's mail
   check lists it with the receiving server's reason and Resend can try it
   again once the cause is put right (a full mailbox, say). Marked as failed
   for the recipient, never deleted; a row already marked keeps its first
   bounce. 8 Oct 2026, review C item 9. */
async function markBounced({ reference, messageId, to, reason, at, part }) {
  const bare = String(messageId || '').trim().replace(/^<|>$/g, '');
  if (!bare) return { marked: 0 };
  const db = getDb();
  const snap = await db.collection('caregiverEmails').where('providerId', 'in', [`<${bare}>`, bare]).limit(10).get();
  const nowIso = new Date().toISOString();
  const said = CAREGIVER.clean(reason || 'The receiving server returned it.', 300);
  let marked = 0;
  for (const doc of snap.docs) {
    const row = doc.data() || {};
    if (row.bounced) continue;
    if (to && row.to && String(row.to).toLowerCase() !== String(to).toLowerCase()) continue;
    if (reference && row.payload && row.payload.reference && row.payload.reference !== reference) continue;
    await doc.ref.update({
      status: 'failed',
      bounced: true,
      bounceReason: said,
      bouncedAt: at || nowIso,
      bounceReport: CAREGIVER.clean(part || '', 200) || null,
      lastError: `Not delivered: ${said}`,
      lastErrorKind: 'recipient',
      lastErrorAt: at || nowIso,
      updatedAt: serverTimestamp()
    });
    marked += 1;
  }
  return { marked };
}

module.exports = {
  audit,
  markBounced,
  createReplacementOrder,
  verifyCardClaim,
  authoriseCard,
  buildPublic,
  /* kept under its old name for any caller outside this file; it lists, and
     claimEmail claims (8 Oct 2026) */
  claimQueuedEmails: dueEmails,
  claimEmail,
  claimable,
  dueEmails,
  emailIdFor,
  failureKind,
  LEASE_MS,
  HEAD_START_MS,
  MAX_ATTEMPTS,
  configRetryMs,
  loginGate,
  noteLoginFailure,
  noteLoginWorks,
  createShippingOrder,
  getAddress,
  getCard,
  getOrder,
  getPublicCard,
  getShipment,
  issueCard,
  queueEmail,
  recordEmailResult,
  recordPaidShipping,
  updateShipmentStatus,
  writePublic
};
