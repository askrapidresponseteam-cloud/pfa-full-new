'use strict';

/* POST /api/assistant/receipt { email, mobile }

   A receipt asked for again, from the site's assistant (owner, 15 Nov 2026:
   "get receipt etc if one provides the valid credentials").

   The receipt itself opens only with the private key that is in the email
   (lib/routes/payment/receipt.js), and it carries a PAN and an address. So
   nothing is shown here: the receipt letter is sent again, exactly as it
   was first sent (lib/routes/payment/response.js receiptPayload), to the
   email on the payment, for the paid donations and memberships whose email
   AND mobile are the ones given. The newest three, once an hour each at
   most.

   The answer is the same whether anything matched or not, so this cannot be
   used to learn who has paid PFA. Lookups are braked per connection, as on
   the track page (lib/submissions.js lookupLimited). */

const firebase = require('../../firebase');
const S = require('../../submissions');
const RULES = require('../../../assets/field-rules.js');
const CONFIRM = require('../../confirmations');
const caregiverMail = require('../../caregiver-mail');
const caregiverStore = require('../../caregiver-store');
const { getBaseUrl, cleanText } = require('../../ccavenue');

const TYPES = new Set(['donate', 'membership']);
const MOST = 3;
const SAME = { ok: true, message: 'If those details match a payment, its receipt has been emailed to the address on it.' };

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') { try { return JSON.parse(request.body); } catch (_) { return {}; } }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('Too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return {}; }
}

const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const now = d.now || (() => Date.now());
  const mail = d.mail || caregiverMail;
  const queue = d.queue || caregiverStore;
  const payloadOf = d.receiptPayload || ((...a) => require('../payment/response.js').receiptPayload(...a));
  const templates = d.templates || require('../payment/response.js').RECEIPT_TEMPLATES;

  return async function handler(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { ok: false, message: 'Use POST.' });
    }
    let body;
    try { body = await readBody(request); } catch (_) { return sendJson(response, 413, { ok: false, message: 'Too large.' }); }
    const parsed = RULES.parseFields({ email: body.email, mobile: body.mobile }, [
      ['email', { required: true, emptyMessage: 'Add the email you paid with.' }],
      ['mobile', { required: true, emptyMessage: 'Add the mobile you paid with.' }]
    ]);
    if (!parsed.ok) return sendJson(response, 400, { ok: false, field: parsed.field, message: parsed.message });
    const email = parsed.values.email.toLowerCase();
    const mobile = digits(parsed.values.mobile);
    const nowMs = now();
    const db = getDb();
    if (await S.lookupLimited(db, S.clientIp(request), nowMs)) {
      return sendJson(response, 429, { ok: false, message: 'Too many tries from this connection. Try again in a few minutes.' });
    }

    let paid = [];
    try {
      const snap = await db.collection('transactions').where('customer.email', '==', email).get();
      paid = (snap.docs || []).map((doc) => Object.assign({ orderId: doc.id }, doc.data() || {}))
        .filter((t) => t.status === 'success' && TYPES.has(t.type) && digits((t.customer || {}).mobile) === mobile)
        .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')))
        .slice(0, MOST);
    } catch (error) {
      console.warn('receipt lookup failed', error && error.message);
      return sendJson(response, 503, { ok: false, message: 'The receipt could not be looked up just now. Try again in a minute.' });
    }

    let site = '';
    try { site = getBaseUrl(request); } catch (_) { site = require('../../public-site').publicSite(); }
    const hour = new Date(nowMs).toISOString().slice(0, 13);
    for (const t of paid) {
      const to = cleanText((t.customer || {}).email, 160).toLowerCase();
      const template = templates[t.type] || 'payment_received';
      const callback = { bankReference: (t.ccaVenue || {}).bankReference || '', paidAt: t.paidAt || '' };
      try {
        await CONFIRM.send({
          to, template, payload: payloadOf(t.orderId, t, callback, site),
          dedupeKey: `${template}:${t.orderId}:again:${hour}`, mail, queue, timeoutMs: 4000
        });
      } catch (error) {
        console.warn('receipt not sent again', { order: t.orderId, message: error && error.message });
      }
    }
    return sendJson(response, 200, SAME);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
