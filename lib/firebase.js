'use strict';

const crypto = require('crypto');
const RULES = require('../assets/field-rules.js');

let cachedDb = null;

function clean(value, maxLength = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function firebaseConfig() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.project_id && parsed.client_email && parsed.private_key) return parsed;
    } catch (_) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
  }

  const projectId = clean(process.env.FIREBASE_PROJECT_ID, 200);
  const clientEmail = clean(process.env.FIREBASE_CLIENT_EMAIL, 300);
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.');
  }
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

/* Whether a service account is in the environment (Vercel) ... */
function hasExplicitConfig() {
  try { firebaseConfig(); return true; } catch (_) { return false; }
}

/* ... or whether this is running inside the project itself, as a Cloud
   Function, where Google hands the process the project's own credentials
   and no key is needed or wanted (DEPLOY-FIREBASE.md always said so; until
   7 Oct 2026 the code still demanded one, so every route on the Firebase
   deployment failed on its first database call). */
function onGoogleCloud() {
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
}

function isConfigured() {
  return hasExplicitConfig() || onGoogleCloud();
}

/* Tests hand in a stand-in Firestore, so the payment and submission routes
   can be driven end to end without a project. Never called in production. */
function _setDbForTests(db) { cachedDb = db || null; }

function getDb() {
  if (cachedDb) return cachedDb;

  let adminApp;
  let firestore;
  let getApps;
  let initializeApp;
  let cert;
  let applicationDefault;
  let getFirestore;
  try {
    ({ getApps, initializeApp, cert, applicationDefault } = require('firebase-admin/app'));
    ({ getFirestore } = require('firebase-admin/firestore'));
    const apps = getApps();
    if (apps.length) adminApp = apps[0];
    else if (hasExplicitConfig()) adminApp = initializeApp({ credential: cert(firebaseConfig()) });
    else if (onGoogleCloud()) {
      const projectId = clean(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID, 200);
      adminApp = initializeApp(Object.assign({ credential: applicationDefault() }, projectId ? { projectId } : {}));
    } else {
      firebaseConfig();   /* throws, naming what is missing */
    }
    firestore = getFirestore(adminApp);
  } catch (error) {
    if (error && /Cannot find module 'firebase-admin'/.test(error.message)) {
      throw new Error('firebase-admin is not installed. Run npm install before deploying to Vercel.');
    }
    throw error;
  }

  cachedDb = firestore;
  return cachedDb;
}

function fieldValue() {
  const { FieldValue } = require('firebase-admin/firestore');
  return FieldValue;
}

/* A Firestore Timestamp from millis, for range queries and cursors on
   createdAt. Lazy for the same reason fieldValue() is. */
function timestampFromMillis(ms) {
  const millis = Number(ms) || 0;
  try {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(millis);
  } catch (error) {
    /* Without the SDK (tests), a stand-in that compares the same way. */
    return { seconds: Math.floor(millis / 1000), nanoseconds: (millis % 1000) * 1e6, toMillis: () => millis };
  }
}

function serverTimestamp() {
  return fieldValue().serverTimestamp();
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function transactionRef(db, orderId) {
  return db.collection('transactions').doc(orderId);
}

async function getTransaction(orderId) {
  const db = getDb();
  const snapshot = await transactionRef(db, orderId).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function createTransaction({ orderId, type, amount, currency, data, idempotencyKey }) {
  const db = getDb();
  const record = {
    orderId,
    type,
    amount: Number(amount),
    currency: String(currency || 'inr').toUpperCase(),
    status: 'initiated',
    source: 'pfa-website',
    customer: data.customer || {},
    metadata: data.metadata || {},
    ccaVenue: {
      trackingId: null,
      bankReference: null,
      paymentMode: null,
      responseStatus: null
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const normalizedKey = clean(idempotencyKey, 200);
  if (!normalizedKey) {
    await db.runTransaction(async (transaction) => {
      const ref = transactionRef(db, orderId);
      const existing = await transaction.get(ref);
      if (!existing.exists) transaction.create(ref, record);
    });
    return { ...record, orderId };
  }

  const idempotencyRef = db.collection('paymentIdempotency').doc(hashKey(`${type}:${normalizedKey}`));
  return db.runTransaction(async (transaction) => {
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    let replaces = '';
    if (idempotencySnapshot.exists) {
      const existingOrderId = clean(idempotencySnapshot.data().orderId, 80);
      const existingTransaction = await transaction.get(transactionRef(db, existingOrderId));
      if (existingTransaction.exists) {
        const held = existingTransaction.data() || {};
        /* The same key is the same request only when it asks for the same
           thing. A donor who comes back from CCAvenue and corrects their
           email, PAN or the gift address, or switches currency, under the
           same page key, used to be handed the old transaction: the receipt,
           the 80G PAN and the certificate went to the old details, and a
           currency switch was refused with a 409. A request that differs in
           anything that matters now starts a fresh transaction and the key
           points at it; the old one stays on record, untouched
           (8 Oct 2026, review D7). */
        if (sameRequest(held, record)) return { id: existingTransaction.id, ...held };
        replaces = existingOrderId;
      }
    }

    const ref = transactionRef(db, orderId);
    const existing = await transaction.get(ref);
    if (!existing.exists) transaction.create(ref, record);
    transaction.set(idempotencyRef, Object.assign({
      keyHash: idempotencyRef.id,
      orderId,
      type,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, replaces ? { replacedOrderId: replaces } : {}), { merge: true });
    return { ...record, orderId };
  });
}

/* A value written the same way whatever order its keys arrived in, so two
   requests can be compared field by field. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((out, key) => {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
      return out;
    }, {});
  }
  return value;
}

/* Whether a stored transaction asks for exactly what a new request asks for:
   the same kind, amount to the paisa, currency, payer and details. */
function sameRequest(held, wanted) {
  const paise = (n) => Math.round(Number(n) * 100);
  return String(held.type || '') === String(wanted.type || '')
    && paise(held.amount) === paise(wanted.amount)
    && String(held.currency || 'INR').toUpperCase() === String(wanted.currency || 'INR').toUpperCase()
    && JSON.stringify(canonical(held.customer || {})) === JSON.stringify(canonical(wanted.customer || {}))
    && JSON.stringify(canonical(held.metadata || {})) === JSON.stringify(canonical(wanted.metadata || {}));
}

/* A handle that looks like the database to code written for one (as
   lib/submissions.js allocateReference is), but runs that code's
   transaction inside this one, so its writes and the caller's commit
   together or not at all. */
function transactionScope(db, transaction) {
  return {
    /* lib/submissions.js withFreeReference reads this: inside one
       transaction it cannot commit a counter step and start again, so it
       looks further ahead in the one it has. */
    scoped: true,
    collection: (name) => db.collection(name),
    doc: (path) => db.doc(path),
    runTransaction: (fn) => fn(transaction)
  };
}

/* The number a paid payment's record is filed under, issued once.

   Two copies of one callback (a refresh, a redelivery, or the Vercel and
   Firebase servers both answering) used to read the transaction before
   either had written its number, and each minted one: two records, two
   numbers, for one payment (8 Oct 2026, review D2 / B3). Now the number is
   taken inside one transaction that reads the payment, issues a number only
   if the payment holds none, and writes it onto the payment in the same
   commit. Firestore re-runs whichever of two racing transactions loses, and
   the re-run finds the number the winner wrote.

   `field` is the kind's own field (donationReference and so on), honoured
   when a payment from before this change already holds one. `allocate`
   receives a handle scoped to this transaction and resolves to the number.
   Resolves to { reference, threadId, minted }. */
async function claimRecordReference({ orderId, field, allocate, threadId }) {
  const db = getDb();
  const ref = transactionRef(db, orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('The stored PFA transaction could not be found.');
    const held = snapshot.data() || {};
    const thread = clean(held.threadId, 40) || clean(threadId, 40);
    const known = clean(held.recordReference || held[field], 60);
    if (known) {
      if (!held.threadId && thread) transaction.update(ref, { threadId: thread });
      return { reference: known, threadId: thread, minted: false };
    }
    const reference = clean(await allocate(transactionScope(db, transaction)), 60);
    if (!reference) throw new Error('No reference number could be issued.');
    transaction.update(ref, { recordReference: reference, threadId: thread, recordClaimedAt: new Date().toISOString() });
    return { reference, threadId: thread, minted: true };
  });
}

function callbackEventId(orderId, callback) {
  return hashKey([
    orderId,
    callback.status,
    callback.trackingId,
    callback.bankReference,
    callback.rawStatus
  ].join('|')).slice(0, 48);
}


async function applyPaymentResult({ orderId, callback, verified }) {
  const db = getDb();
  const ref = transactionRef(db, orderId);
  const eventRef = db.collection('paymentEvents').doc(callbackEventId(orderId, callback));

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('The stored PFA transaction could not be found.');
    const existing = { id: snapshot.id, ...snapshot.data() };

    const alreadyFinal = ['success', 'failed', 'aborted', 'cancelled', 'verification_failed'].includes(existing.status);
    const shouldApply = !(existing.status === 'success' && verified) && !(alreadyFinal && !verified);
    const nextStatus = verified
      ? 'success'
      : callback.status === 'aborted'
        ? 'aborted'
        : callback.status === 'initiated' || callback.status === 'awaited'
          ? 'pending'
          : callback.status === 'verification_failed'
            ? 'verification_failed'
          : 'failed';

    transaction.set(eventRef, {
      orderId,
      type: existing.type,
      status: callback.status,
      rawStatus: callback.rawStatus,
      trackingId: callback.trackingId || null,
      bankReference: callback.bankReference || null,
      receivedAt: serverTimestamp(),
      verified: Boolean(verified)
    }, { merge: true });

    if (!shouldApply) return { ...existing, id: snapshot.id, applied: false, firstSuccess: false };

    const updated = {
      status: nextStatus,
      updatedAt: serverTimestamp(),
      ccaVenue: {
        trackingId: callback.trackingId || null,
        bankReference: callback.bankReference || null,
        paymentMode: callback.paymentMode || null,
        responseStatus: callback.rawStatus || null,
        failureMessage: callback.failureMessage || null
      }
    };

    if (!verified) {
      transaction.update(ref, updated);
      return { ...existing, ...updated, id: snapshot.id, applied: true, firstSuccess: false };
    }

    /* firstSuccess: this callback is the one that turned the transaction
       green. CCAvenue redelivers callbacks, and the things that must happen
       exactly once on success - the receipt email above all - key off this
       rather than off the status, which is success on every redelivery. */
    /* The moment it was paid, once: the monthly payments report
       (lib/finance-report.js) files a payment under the month it was paid
       in, and updatedAt moves with every later change (a shipment, a note). */
    if (existing.status !== 'success' && !existing.paidAt) updated.paidAt = new Date().toISOString();
    transaction.update(ref, updated);
    return { ...existing, ...updated, id: snapshot.id, applied: true, firstSuccess: existing.status !== 'success' };
  });
}

// Matches the format lib/payment.js already stores on every member record's
// `mobile` field (bare 10 digits, no +91). Other flows have normalised phones
// differently (+91 prefix); those must not be used here or dedup lookups would
// silently never match.
/* Delegates to the shared rule file so a number written "09876543210" or
   "0091-98765-43210" resolves the same way here as it does in the browser.
   This function used to return an empty string for both, which meant a
   member typing their number with a leading zero at checkout was not found
   and was quietly treated as somebody new. Output is unchanged for every
   form the old version already accepted. */
function normalizedMobile(value) {
  const digits = RULES.normaliseMobile(value);
  return /^[6-9]\d{9}$/.test(digits) ? digits : '';
}

async function findMemberByMobile(mobile) {
  const db = getDb();
  const snapshot = await db.collection('members').where('mobile', '==', mobile).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Issues cards to existing (pre-migration) members without a new payment.
// Every record is checked against every other record in the same batch and
// against Firestore before anything is written, so re-running an import (or
// a name appearing on the list twice) never creates a second member.


function resetForTests() {
  cachedDb = null;
}

module.exports = {
  isConfigured,
  applyPaymentResult,
  claimRecordReference,
  createTransaction,
  sameRequest,
  transactionScope,
  fieldValue,
  timestampFromMillis,
  findMemberByMobile,
  firebaseConfig,
  getDb,
  getTransaction,
  hashKey,
  normalizedMobile,
  resetForTests,
  _setDbForTests,
  serverTimestamp
};
