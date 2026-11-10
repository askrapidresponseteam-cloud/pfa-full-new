'use strict';

/* POST /api/payment/tax-receipt { action: 'open', o, k }      -> { ok, ... }
   POST /api/payment/tax-receipt { o, k, idType, pan|aadhaar, taxIdDoc }

   The PAN or Aadhaar for an 80G receipt, given after paying (owner, 10 Nov
   2026: "make donating any amount easier. dont ask for uploading whatever
   before the payment. after payment send a link over email which asks to
   upload those in the page if one needs tax exempt receipt").

   The receipt email (payment_received) and the welcome letter
   (membership_welcome) link to tax-receipt.html#o=<order>&k=<key>, the key
   the donor's PDF receipt is reached with (lib/donation-receipt.js). Both
   ride in the fragment, which the browser never sends to a server, and the
   page posts them here, never in a URL (as member-photo.html does). That
   page sends the card's photo to /api/payment/tax-id, as the forms used to
   before paying, and then the number and the photo's token here.

   Here: the key is checked against the paid transaction; the number by the
   site's own rules (assets/field-rules.js) and, for an Aadhaar card whose QR
   code was read, against the card (./tax-id.js confirm); the photo is moved
   beside the donation or membership record as its "tax-id" file, which the
   panel opens; the record says what was given; the transaction carries the
   number, so the PDF receipt prints it (an Aadhaar number by its last four
   digits only); the donor is sent the receipt again; and the payments
   inboxes, and only they, are told (CONTRIBUTING: every record of money goes
   to pfadcmho@gmail.com and ozairhusain@gmail.com, never gandhim).

   Given once. A second try is answered with what is on record and how to
   correct it, so a link forwarded on cannot change a donor's tax number. */

const firebase = require('../../firebase');
const { cleanText, getBaseUrl } = require('../../ccavenue');
const S = require('../../submissions');
const TAXID = require('../../tax-id');
const RECEIPT = require('../../donation-receipt');
const CONFIRM = require('../../confirmations');
const FORWARD = require('../../submission-forward');
const caregiverMail = require('../../caregiver-mail');
const caregiverStore = require('../../caregiver-store');
const taxIdDoc = require('./tax-id');

const ORDER = /^PFA-(DON|MEM)-[A-Z0-9]{8}$/;
const MAX_BODY = 16 * 1024;
const NOPE = 'This link is not valid. Use the link in your receipt email, or write to PFA quoting your PFA transaction ID.';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    const raw0 = typeof request.body === 'string' ? request.body : '';
    if (raw0) { try { return resolve(JSON.parse(raw0)); } catch (_) { return reject(new Error('Invalid body.')); } }
    if (request.body === null || request.readableEnded) return resolve({});
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; if (raw.length > MAX_BODY) { raw = ''; reject(new Error('Too large.')); } });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); } });
    request.on('error', reject);
  });
}

const clean = (value, max) => cleanText(value, max);

function rupees(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateOf(t) {
  const at = t.receiptIssuedAt || t.updatedAt || t.createdAt;
  const ms = typeof at === 'string' ? Date.parse(at) : at && typeof at.toMillis === 'function' ? at.toMillis() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function kindOf(t) { return t.type === 'membership' ? 'membership' : 'donation'; }
function referenceOf(t) { return clean(t.type === 'membership' ? t.membershipReference : t.donationReference, 40); }

/* The paid rupee transaction the link is for, or null. Every refusal reads
   the same, so the answer says nothing about which orders exist. */
async function paidFor(load, order, key) {
  if (!ORDER.test(order) || !RECEIPT.KEY.test(key)) return null;
  const t = await load(order);
  if (!t || t.status !== 'success' || !['donate', 'membership'].includes(t.type)) return null;
  if (String(t.currency || 'INR').toUpperCase() !== 'INR') return null;
  if (!RECEIPT.keyMatches(t.receiptKey, key)) return null;
  return { orderId: order, ...t };
}

/* A PAN or Aadhaar already on the payment: given here, or with the form
   before 10 Nov 2026, when it was asked for before paying. */
function givenOf(t) {
  const c = t.customer || {};
  if (t.taxIdGiven && TAXID.TYPES[t.taxIdGiven.type]) return t.taxIdGiven;
  if (c.pan) return { type: 'pan', shown: TAXID.masked('pan', clean(c.pan, 12)) };
  if (c.aadhaar) return { type: 'aadhaar', shown: TAXID.masked('aadhaar', clean(c.aadhaar, 14)) };
  return null;
}

/* What the page shows: the payment, and what is already on record. */
function summaryOf(t, key, siteUrl) {
  const customer = t.customer || {};
  const given = givenOf(t);
  return {
    ok: true,
    kind: kindOf(t),
    orderId: t.orderId,
    first: clean(customer.name, 120).split(/\s+/)[0] || '',
    name: clean(customer.name, 120),
    amount: rupees(t.amount),
    paidOn: dateOf(t),
    tier: t.type === 'membership' ? clean((t.metadata || {}).tierLabel, 60) : '',
    given: given ? { type: given.type, label: TAXID.TYPES[given.type] || '', shown: clean(given.shown, 20) } : null,
    receiptUrl: t.type === 'donate' ? RECEIPT.urlFor(siteUrl, t.orderId, key) : ''
  };
}

function siteOf(request) {
  try { return getBaseUrl(request); } catch (_) { return ''; }
}

/* The record's own words for what was given, as the forms used to file it
   before paying (response.js taxIdOf), with what the card's QR code said. */
function taxIdFor(type, number, name, got, at) {
  const RULES = require('../../../assets/field-rules.js');
  const checks = [];
  if (type === 'pan' && !RULES.panNameOk(number, name)) checks.push(`The 5th letter of this PAN is ${number.charAt(4)}, the first letter of the holder's surname, and no word of "${name}" starts with it. Check that the card is the donor's own.`);
  const out = {
    type, label: TAXID.TYPES[type], number, shown: TAXID.masked(type, number),
    photo: got ? 'attached' : 'missing', photoAt: at, holder: type === 'pan' ? RULES.panHolder(number) : '',
    givenAfterPayment: true, givenAt: at, checks
  };
  const read = got && got.read;
  if (read) {
    const same = read.uid ? read.uid === number : read.last4 === number.slice(-4);
    out.read = { kind: read.kind, last4: read.last4, name: read.name || '', full: Boolean(read.uid) };
    out.cardMatch = same ? 'matches' : 'differs';
    if (read.name && !RULES.namesAgree(read.name, name)) out.checks.push(`The name on the card's QR code is "${read.name}", and the payment is in the name of "${name}". The 80G receipt goes in the donor's own name, so check that the card is theirs.`);
  } else if (got) {
    out.cardMatch = type === 'aadhaar' ? 'unread' : 'by-eye';
  }
  return out;
}

async function tell({ t, card, reference, siteUrl, key }) {
  const customer = t.customer || {};
  const base = {
    kind: kindOf(t), orderId: t.orderId, reference, threadId: clean(t.threadId, 12),
    name: clean(customer.name, 120), email: clean(customer.email, 160).toLowerCase(), mobile: clean(customer.mobile, 20),
    amount: t.amount, tier: t.type === 'membership' ? clean((t.metadata || {}).tierLabel, 60) : '',
    idLabel: card.type === 'pan' ? 'PAN' : 'Aadhaar', shown: card.shown, photo: card.photo,
    cardMatch: card.cardMatch || '', checks: card.checks || [], siteUrl
  };
  const jobs = [];
  if (base.email) {
    jobs.push(CONFIRM.send({
      to: base.email, template: 'tax_id_received',
      payload: { ...base, receiptUrl: t.type === 'donate' ? RECEIPT.urlFor(siteUrl, t.orderId, key) : '' },
      dedupeKey: `tax_id_received:${t.orderId}`, mail: caregiverMail, queue: caregiverStore
    }).catch(() => null));
  }
  for (const to of FORWARD.paymentInboxes()) {
    jobs.push(CONFIRM.send({
      to, template: 'tax_id_staff', payload: base,
      dedupeKey: `tax_id_staff:${t.orderId}:${to}`, mail: caregiverMail, queue: caregiverStore
    }).catch(() => null));
  }
  return Promise.all(jobs);
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || (() => firebase.getDb());
  const load = d.getTransaction || firebase.getTransaction;
  const notify = d.tell || tell;
  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { ok: false, error: 'Use POST.' });
    }
    const siteUrl = d.siteUrl || siteOf(request);
    if (S.rateLimited(S.clientIp(request))) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes.' });
    let body;
    try { body = await readBody(request); } catch (error) { return sendJson(response, 400, { ok: false, error: error.message }); }
    const order = clean(body.o, 20).toUpperCase();
    const key = clean(body.k, 40);
    let t;
    try { t = await paidFor(load, order, key); } catch (error) {
      console.error('PFA tax receipt link not read', { order, message: clean(error && error.message, 200) });
      return sendJson(response, 500, { ok: false, error: 'This could not be opened just now. Try again in a minute.' });
    }
    if (!t) return sendJson(response, 404, { ok: false, error: NOPE });
    /* the page opening: what the payment was, and what is on record */
    if (body.action === 'open') return sendJson(response, 200, summaryOf(t, key, siteUrl));
    const already = givenOf(t);
    if (already) {
      const said = `PFA already has your ${already.type === 'aadhaar' ? 'Aadhaar' : 'PAN'} for this ${kindOf(t)}. To correct it, write to PFA quoting ${t.orderId}.`;
      return sendJson(response, 409, Object.assign(summaryOf(t, key, siteUrl), { ok: false, error: said }));
    }

    let card;
    try { card = TAXID.read(body); } catch (error) {
      return sendJson(response, 422, { ok: false, error: error.message.replace(TAXID.WHY + ' ', ''), field: error.field });
    }
    const db = getDb();
    try {
      await taxIdDoc.confirm(db, { type: card.type, token: card.token }, card.number);
    } catch (error) {
      return sendJson(response, 422, { ok: false, error: error.message, field: 'taxIdDoc' });
    }

    const at = new Date().toISOString();
    const customer = t.customer || {};
    const reference = referenceOf(t);
    let filed = null;
    let got = null;
    if (reference) {
      const recordRef = db.collection('submissions').doc(reference);
      try {
        got = await taxIdDoc.attachTo(db, card.token, recordRef, at);
        filed = taxIdFor(card.type, card.number, clean(customer.name, 120), got, at);
        const snap = await recordRef.get();
        const record = snap.exists ? snap.data() || {} : {};
        const history = Array.isArray(record.history) ? record.history : [];
        await recordRef.update({
          taxId: filed,
          [`fields.${card.type}`]: filed.shown,
          history: history.concat([{ status: record.status || 'new', at, note: `${card.type === 'pan' ? 'PAN' : 'Aadhaar'} given for the 80G receipt, after paying.` }]),
          updatedAt: at
        });
      } catch (error) {
        console.error('PFA 80G card not filed on the record', { order, reference, message: clean(error && error.message, 200) });
        return sendJson(response, 500, { ok: false, error: 'Your card could not be saved just now. Try again in a minute.' });
      }
    } else {
      filed = taxIdFor(card.type, card.number, clean(customer.name, 120), null, at);
    }

    try {
      await db.collection('transactions').doc(order).update({
        [`customer.${card.type}`]: card.number,
        taxIdGiven: { type: card.type, shown: filed.shown, at },
        updatedAt: at
      });
    } catch (error) {
      console.error('PFA 80G card not kept on the payment', { order, message: clean(error && error.message, 200) });
      return sendJson(response, 500, { ok: false, error: 'Your card could not be saved just now. Try again in a minute.' });
    }

    const fresh = { ...t, customer: { ...customer, [card.type]: card.number }, taxIdGiven: { type: card.type, shown: filed.shown, at } };
    try { await notify({ t: fresh, card: filed, reference, siteUrl, key }); } catch (error) {
      console.warn('PFA 80G card emails not sent', { order, message: clean(error && error.message, 200) });
    }
    return sendJson(response, 200, summaryOf(fresh, key, siteUrl));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { paidFor, givenOf, summaryOf, taxIdFor, tell, ORDER };
