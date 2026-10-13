'use strict';

const crypto = require('crypto');

const CCA_VENUE_IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03,
  0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b,
  0x0c, 0x0d, 0x0e, 0x0f
]);

function deriveKey(workingKey) {
  if (!workingKey) throw new Error('CCAvenue Working Key is missing.');
  return crypto.createHash('md5').update(String(workingKey), 'utf8').digest();
}

function encrypt(plainText, workingKey) {
  const cipher = crypto.createCipheriv('aes-128-cbc', deriveKey(workingKey), CCA_VENUE_IV);
  cipher.setAutoPadding(true);
  return Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final()
  ]).toString('hex');
}

function decrypt(encryptedHex, workingKey) {
  const value = String(encryptedHex || '').trim();
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error('CCAvenue returned an invalid encrypted response.');
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', deriveKey(workingKey), CCA_VENUE_IV);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(value, 'hex')),
    decipher.final()
  ]).toString('utf8');
}

function encodeMerchantData(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.append(key, String(value));
  });
  return params.toString();
}

function decodeMerchantData(value) {
  const params = new URLSearchParams(String(value || '').replace(/&+$/, ''));
  return Object.fromEntries(params.entries());
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength || 200);
}

function parseUrlEncoded(raw) {
  return Object.fromEntries(new URLSearchParams(String(raw || '')).entries());
}

async function readRequestBody(request, limitBytes) {
  const limit = limitBytes || 64 * 1024;

  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (Buffer.isBuffer(request.body)) {
    const raw = request.body.toString('utf8');
    const type = String(request.headers['content-type'] || '').toLowerCase();
    if (type.includes('application/json')) return JSON.parse(raw || '{}');
    return parseUrlEncoded(raw);
  }

  if (typeof request.body === 'string') {
    const type = String(request.headers['content-type'] || '').toLowerCase();
    if (type.includes('application/json')) return JSON.parse(request.body || '{}');
    return parseUrlEncoded(request.body);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(request.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) return JSON.parse(raw || '{}');
  return parseUrlEncoded(raw);
}

function getBaseUrl(request) {
  const configured = cleanText(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '', 300);
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      throw new Error('PUBLIC_SITE_URL must use HTTPS in production.');
    }
    return url.origin;
  }

  const protocol = cleanText(
    String(request.headers['x-forwarded-proto'] || 'https').split(',')[0],
    10
  ) || 'https';
  const host = cleanText(
    String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0],
    255
  );

  if (!host) throw new Error('The public site URL could not be determined.');
  return `${protocol}://${host}`;
}

function setSecurityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/* CCAvenue's Order Status API (command orderStatusTracker), for one order.

   Used by the panel's reconciliation (lib/routes/admin/payments-pending.js,
   8 Oct 2026, review D3): a payment whose callback never arrived, or arrived
   while Firestore was down, stays 'initiated' or 'pending' here while
   CCAvenue knows how it ended. The request is the callback's crypto run the
   other way: a JSON body naming the order, encrypted with the working key,
   posted with the access code. The answer is form-encoded, status=0 and an
   enc_response encrypted the same way, holding JSON. Resolves to what the
   settle path needs, or throws with a reason a person can act on.

   Field names are CCAvenue's own, including their spelling of
   "order_currncy". Some accounts wrap the result in Order_Status_Result. */
async function orderStatus({ orderId, trackingId, accessCode, workingKey, url, fetchImpl, timeoutMs }) {
  const request = JSON.stringify(Object.assign({ order_no: orderId }, trackingId ? { reference_no: trackingId } : {}));
  const form = new URLSearchParams({
    enc_request: encrypt(request, workingKey),
    access_code: accessCode,
    command: 'orderStatusTracker',
    request_type: 'JSON',
    response_type: 'JSON',
    version: '1.2'
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
  let text;
  try {
    const res = await (fetchImpl || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json, text/plain' },
      body: form.toString(),
      signal: controller.signal
    });
    if (!res || !res.ok) throw new Error(`CCAvenue's status service answered ${res ? res.status : 'nothing'}.`);
    text = String(await res.text()).trim();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('CCAvenue\'s status service did not answer in time.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const reply = parseUrlEncoded(text);
  if (String(reply.status) !== '0' || !reply.enc_response) {
    throw new Error(`CCAvenue refused the status request: ${cleanText(reply.enc_response || reply.enc_error_code || text, 200) || 'no reason given'}.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(decrypt(reply.enc_response, workingKey).replace(/[\u0000-\u001f]+$/g, '').trim());
  } catch (_) {
    throw new Error('CCAvenue\'s status answer could not be read with this working key.');
  }
  const result = (parsed && parsed.Order_Status_Result) || parsed || {};
  if (String(result.status) === '1' || cleanText(result.error_code, 20)) {
    throw new Error(`CCAvenue could not report on ${orderId}: ${cleanText(result.error_desc || result.error_code, 200) || 'no reason given'}.`);
  }
  const named = cleanText(result.order_no, 80);
  if (named && named !== orderId) throw new Error(`CCAvenue answered about ${named}, not ${orderId}.`);
  return {
    orderStatus: cleanText(result.order_status, 40),
    amount: cleanText(result.order_amt, 20),
    currency: cleanText(result.order_currncy || result.order_currency, 10).toUpperCase(),
    trackingId: cleanText(result.reference_no, 100),
    bankReference: cleanText(result.order_bank_ref_no, 100),
    paymentMode: cleanText(result.order_option_type || result.order_card_name, 80),
    message: cleanText(result.order_bank_response || result.order_status_date_time || '', 240)
  };
}

/* Does the answer name a merchant other than this account's?
 *
 * Until 13 Oct 2026 both callbacks demanded that CCAvenue return merchant_id,
 * and refused the payment when it did not. CCAvenue's own API guide lists the
 * field in no response table and identifies the merchant by access_code: it is
 * sent with the request, not reliably returned. So a real payment was taken by
 * the bank, refused here as 'verification_failed', and left unfiled with no
 * record, no number and no receipt, while the page printed CCAvenue's own word
 * "Success" in its status row. The suite passed throughout, because every
 * payment fixture invents a merchant_id the gateway does not send.
 *
 * What proves the answer is this account's is the working key: the response is
 * encrypted with it, only CCAvenue and this server hold it, and the order id
 * must name a transaction this site started for the amount it started it for.
 * The panel's status check has always relied on that reasoning, filling
 * merchant_id in from config before calling settle(), which is why the repair
 * path settled payments the live callback had just refused.
 *
 * An answer naming a DIFFERENT merchant is still refused outright: that is a
 * real signal and nothing legitimate produces it. An answer naming no merchant
 * is accepted, because the working key has already done the work and demanding
 * the field only loses money. Both sides are cleaned to the same length; they
 * were 40 and 30, so a long id could never have matched itself. */
function merchantAccepted(returnedMerchantId, merchantId) {
  const returned = cleanText(returnedMerchantId, 40);
  if (!returned) return true;
  return returned === cleanText(merchantId, 40);
}

module.exports = {
  cleanText,
  decodeMerchantData,
  decrypt,
  encodeMerchantData,
  encrypt,
  escapeHtml,
  getBaseUrl,
  merchantAccepted,
  orderStatus,
  readRequestBody,
  setSecurityHeaders
};
