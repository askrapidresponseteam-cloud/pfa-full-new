/* GET  /api/admin/payments-pending
   POST /api/admin/payments-pending   { action: 'check' | 'refile', orderId }

   Reconciliation (8 Oct 2026, review D3). A payment is settled by CCAvenue's
   callback. When the callback never arrives (the shopper closed the tab on
   the bank's page), or arrives while Firestore cannot be written, the
   payment stays 'initiated' or 'pending' here while CCAvenue knows how it
   ended. Nothing ever asked CCAvenue again, so an 'Awaited' payment stayed
   unresolved for good.

   GET lists the payments still initiated or pending more than 30 minutes
   after they started (started in the last 14 days; ?days=N for up to 90),
   and the paid caregiver applications whose photograph is not beside the
   record yet (photoPending).

   POST check asks CCAvenue's Order Status API about one order
   (lib/ccavenue.js orderStatus) and applies a final answer through the very
   path the callback uses (lib/routes/payment/response.js settle, or
   lib/routes/shop/response.js settleAnswer for a shop order): the same
   amount, merchant and currency checks, the same record, number and letter,
   each still once. An answer that is not final (Initiated, Awaited) or not a
   simple outcome (Refunded and the like) changes nothing and is reported.
   Without the CCAvenue access code and working key on this server it answers
   NOT_CONFIGURED and changes nothing.

   POST refile runs the success steps again for a payment already paid,
   without asking CCAvenue: it finishes a record whose write failed or
   attaches a photograph that could not be copied, under the same number.

   Module 'payments'. Every POST is written to the admin log. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const firebase = require('../../../lib/firebase');
const audit = require('../../../lib/admin-audit');
const backend = require('../../../lib/shop-backend');
const { cleanText, getBaseUrl, orderStatus } = require('../../../lib/ccavenue');
const { getCredentials, getStatusUrl } = require('../../../lib/pfa-ccavenue-flow');

const PENDING_AFTER_MS = 30 * 60 * 1000;
const ORDER_ID = /^PFA-(?:DON|SND|CAR|CGA|MEM|SHP)-[A-Z0-9]{8}$/;

/* CCAvenue's order statuses (Order Status API) as the callback words them.
   Only these are applied; anything else is reported for a person to read. */
const FINAL = {
  successful: 'Success',
  shipped: 'Success',
  aborted: 'Aborted',
  cancelled: 'Aborted',
  'auto-cancelled': 'Aborted',
  unsuccessful: 'Failure',
  timeout: 'Failure',
  invalid: 'Failure',
  fraud: 'Failure'
};

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  if (typeof request.body === 'string') {
    try { return Promise.resolve(JSON.parse(request.body || '{}')); } catch (_) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; if (raw.length > 20000) raw = ''; });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  return Date.parse(value) || 0;
}

function configured(currency) {
  try { getCredentials(currency); getStatusUrl(); return true; } catch (_) { return false; }
}

function siteOf(request) {
  try { return getBaseUrl(request); } catch (_) { return 'https://peopleforanimalsindia.org'; }
}

/* The payments of the last `days` days, newest first, by their start time:
   a range and an order on the one field, which Firestore's single-field
   index answers, so no composite index has to be deployed. Asking for
   status 'initiated' instead would, in time, be mostly abandoned checkouts
   (they stay 'initiated' for good) and could crowd out this week's. */
async function listPending(db, nowMs, days) {
  const since = firebase.timestampFromMillis(nowMs - days * 24 * 60 * 60 * 1000);
  const snapshot = await db.collection('transactions').where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(2000).get();
  return snapshot.docs
    /* 'verification_failed' belongs here, and its absence until 13 Oct 2026
       hid the one case that most needs a person: CCAvenue says the money was
       taken, this site refused to file it, and the payer is looking at a page
       that says the payment did not complete. Such a transaction had no row,
       so it had no Check button, so the one action that settles it could not
       be reached from the panel at all. It is a final status, so unlike
       'initiated' it cannot pile up with abandoned checkouts: something really
       did go wrong with every one of them. */
    .filter((doc) => ['initiated', 'pending', 'verification_failed'].includes((doc.data() || {}).status))
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((t) => {
      const startedMs = millisOf(t.createdAt);
      const customer = t.customer || {};
      return {
        orderId: cleanText(t.orderId || t.id, 80),
        type: cleanText(t.type, 40),
        status: cleanText(t.status, 40),
        amount: Number(t.amount) || 0,
        currency: cleanText(t.currency || 'INR', 10).toUpperCase(),
        startedAt: startedMs ? new Date(startedMs).toISOString() : '',
        minutesWaiting: startedMs ? Math.floor((nowMs - startedMs) / 60000) : null,
        name: cleanText(customer.name, 120),
        email: cleanText(customer.email, 160),
        startedMs
      };
    })
    /* A payment started under half an hour ago may still be on the bank's
       page; one with no start time is old enough to look at. A payment already
       refused is not waiting for anything and shows at once. */
    .filter((row) => row.status === 'verification_failed' || !row.startedMs || nowMs - row.startedMs >= PENDING_AFTER_MS)
    .sort((a, b) => b.startedMs - a.startedMs)
    .map(({ startedMs, ...row }) => row);
}

async function listPhotoPending(db) {
  const snapshot = await db.collection('submissions').where('photoPending', '==', true).limit(100).get();
  return snapshot.docs.map((doc) => {
    const r = doc.data() || {};
    return { reference: doc.id, orderId: cleanText(r.payment && r.payment.orderId, 80), createdAt: cleanText(r.createdAt, 40) };
  });
}

/* Asks CCAvenue, then applies a final answer through the callback's path. */
async function check(orderId, transaction, request, fetchImpl) {
  const shop = transaction.type === 'shop' || orderId.startsWith('PFA-SHP-');
  const currency = shop ? 'inr' : String(transaction.currency || 'inr').toLowerCase();
  let creds;
  let url;
  try {
    creds = getCredentials(currency);
    url = getStatusUrl();
  } catch (error) {
    return { status: 503, body: { code: 'NOT_CONFIGURED', message: `The CCAvenue status check is not configured on this server (${cleanText(error && error.message, 200)}). Nothing was changed.` } };
  }

  let answer;
  try {
    answer = await orderStatus({
      orderId,
      trackingId: cleanText(transaction.ccaVenue && transaction.ccaVenue.trackingId, 100),
      accessCode: creds.accessCode,
      workingKey: creds.workingKey,
      url,
      fetchImpl
    });
  } catch (error) {
    console.error('PFA payment status check failed', { orderId, message: cleanText(error && error.message, 240) });
    return { status: 502, body: { code: 'STATUS_UNAVAILABLE', message: `${cleanText(error && error.message, 240)} Nothing was changed.` } };
  }

  const said = answer.orderStatus;
  const wording = FINAL[said.toLowerCase()];
  if (!wording) {
    return { status: 200, body: { ok: true, orderId, ccavenue: said, applied: false, status: transaction.status, message: `CCAvenue reports "${said || 'nothing'}" for this order. Nothing was changed.` } };
  }

  /* The answer, in the callback's own words. The merchant is this account's:
     the request went out with its access code and the answer was read with
     its working key, which only CCAvenue and this server hold. The amount and
     currency are CCAvenue's, and the settle path checks both. */
  const data = {
    order_id: orderId,
    order_status: wording,
    amount: answer.amount,
    currency: answer.currency || currency.toUpperCase(),
    merchant_id: creds.merchantId,
    tracking_id: answer.trackingId,
    bank_ref_no: answer.bankReference,
    payment_mode: answer.paymentMode,
    failure_message: wording === 'Success' ? '' : answer.message
  };
  const site = siteOf(request);
  if (shop) {
    const shopRoute = require('../shop/response');
    shopRoute.logAnswer('status-check', data);
    const result = await shopRoute.settleAnswer({ data, merchantId: creds.merchantId, base: site });
    if (result.kind === 'not-recorded' || result.kind === 'missing' || result.kind === 'unknown-id') {
      return { status: 502, body: { code: 'NOT_APPLIED', orderId, ccavenue: said, message: 'CCAvenue answered, but the order store could not be updated just now. Try again in a moment.' } };
    }
    return { status: 200, body: { ok: true, orderId, ccavenue: said, applied: true, status: result.order.status, reference: result.kind === 'paid' ? orderId : '', needsAttention: Boolean(result.order.needsAttention) } };
  }
  const paymentRoute = require('../payment/response');
  paymentRoute.logAnswer('status-check', data);
  const settled = await paymentRoute.settle({ data, currency: String(data.currency || currency).toLowerCase(), merchantId: creds.merchantId, baseUrl: site });
  return {
    status: 200,
    body: { ok: true, orderId, ccavenue: said, applied: true, status: settled.effective, reference: settled.applicationRef || settled.donationRef || '', receipt: settled.receipt.state }
  };
}

async function refile(orderId, transaction, request) {
  const site = siteOf(request);
  if (transaction.type === 'shop' || orderId.startsWith('PFA-SHP-')) {
    const doc = await backend.read('orders', orderId);
    const order = doc && doc.data;
    if (!order || order.status !== 'paid') return { status: 409, body: { code: 'NOT_PAID', message: 'Only a paid order can be filed again.' } };
    const shopRoute = require('../shop/response');
    await shopRoute.fileCase({ ...order, orderId }, site);
    return { status: 200, body: { ok: true, orderId, reference: orderId } };
  }
  const paymentRoute = require('../payment/response');
  const result = await paymentRoute.refile({ orderId, baseUrl: site });
  if (!result.ok) {
    return { status: result.code === 'NOT_FOUND' ? 404 : 409, body: { code: result.code, message: result.code === 'NOT_PAID' ? 'Only a paid payment can be filed again.' : 'No such payment.' } };
  }
  return { status: 200, body: { ok: true, orderId, reference: result.reference, receipt: result.receipt } };
}

function createHandler(deps) {
  const fetchImpl = (deps && deps.fetch) || ((...args) => fetch(...args));
  return async function handler(request, response) {
    const who = await requireAdmin(request, response, 'payments');
    if (!who) return;
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }

    if (request.method === 'GET') {
      const asked = Number((request.query || {}).days);
      const days = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), 90) : 14;
      try {
        const db = firebase.getDb();
        const [pending, photoPending] = await Promise.all([listPending(db, Date.now(), days), listPhotoPending(db)]);
        return sendJson(response, 200, {
          ok: true,
          days,
          olderThanMinutes: PENDING_AFTER_MS / 60000,
          statusCheck: { inr: configured('inr'), usd: configured('usd') },
          pending,
          photoPending
        });
      } catch (error) {
        console.error('PFA pending payments not listed', cleanText(error && error.message, 200));
        return sendJson(response, 503, { code: 'UNAVAILABLE', message: 'The payments could not be read just now.' });
      }
    }

    const body = await readBody(request);
    const action = cleanText(body.action, 20).toLowerCase();
    const orderId = cleanText(body.orderId, 80).toUpperCase();
    if (!['check', 'refile'].includes(action)) return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Ask to check or to refile.' });
    if (!ORDER_ID.test(orderId)) return sendJson(response, 400, { code: 'BAD_ORDER', message: 'That does not look like a PFA transaction ID.' });

    let outcome;
    try {
      const transaction = await firebase.getTransaction(orderId);
      if (!transaction) {
        outcome = { status: 404, body: { code: 'NOT_FOUND', message: 'No payment with that transaction ID.' } };
      } else {
        outcome = action === 'check'
          ? await check(orderId, transaction, request, fetchImpl)
          : await refile(orderId, transaction, request);
      }
    } catch (error) {
      console.error('PFA payment reconciliation failed', { orderId, action, message: cleanText(error && error.message, 240) });
      outcome = { status: 503, body: { code: 'UNAVAILABLE', message: 'The payment could not be updated just now. Nothing is lost; try again in a moment.' } };
    }
    audit.record(who, {
      module: 'payments',
      action: action === 'check' ? 'status-check' : 'refile',
      subject: orderId,
      detail: cleanText([outcome.body.ccavenue && `CCAvenue: ${outcome.body.ccavenue}`, outcome.body.applied !== undefined && `applied: ${outcome.body.applied}`, outcome.body.code].filter(Boolean).join('; '), 200),
      outcome: outcome.status < 400 ? 'done' : 'refused'
    }, request);
    return sendJson(response, outcome.status, outcome.body);
  };
}

module.exports = createHandler();
module.exports._private = { createHandler, FINAL, PENDING_AFTER_MS, listPending };
