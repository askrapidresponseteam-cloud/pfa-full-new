'use strict';

const crypto = require('crypto');
const {
  cleanText,
  encodeMerchantData,
  encrypt,
  escapeHtml
} = require('./ccavenue');

const PRODUCTION_PAYMENT_URL = 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';
const TEST_PAYMENT_URL = 'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

function getCredentials(currency) {
  if (String(currency || '').toLowerCase() === 'usd') {
    // A separate USD Merchant ID is optional: CCAvenue sometimes issues one shared
    // Merchant ID with a distinct Access Code/Working Key per currency, sometimes a
    // fully separate sub-account. Both shapes work without code changes.
    const merchantId = cleanText(process.env.CCAVENUE_USD_MERCHANT_ID || process.env.CCAVENUE_MERCHANT_ID || '', 30);
    const accessCode = cleanText(process.env.CCAVENUE_USD_ACCESS_CODE || '', 200);
    const workingKey = String(process.env.CCAVENUE_USD_WORKING_KEY || '').trim();
    const missing = [];
    if (!merchantId) missing.push('CCAVENUE_USD_MERCHANT_ID or CCAVENUE_MERCHANT_ID');
    if (!accessCode) missing.push('CCAVENUE_USD_ACCESS_CODE');
    if (!workingKey) missing.push('CCAVENUE_USD_WORKING_KEY');
    if (missing.length) throw new Error(`Missing Vercel environment variable: ${missing.join(', ')}`);
    return { merchantId, accessCode, workingKey };
  }

  const merchantId = cleanText(process.env.CCAVENUE_MERCHANT_ID || '', 30);
  const accessCode = cleanText(process.env.CCAVENUE_ACCESS_CODE || '', 200);
  const workingKey = String(process.env.CCAVENUE_WORKING_KEY || '').trim();
  const missing = [];
  if (!merchantId) missing.push('CCAVENUE_MERCHANT_ID');
  if (!accessCode) missing.push('CCAVENUE_ACCESS_CODE');
  if (!workingKey) missing.push('CCAVENUE_WORKING_KEY');
  if (missing.length) throw new Error(`Missing Vercel environment variable: ${missing.join(', ')}`);
  return { merchantId, accessCode, workingKey };
}

function getPaymentUrl() {
  const configured = cleanText(process.env.CCAVENUE_PAYMENT_URL || '', 500);
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || !/(^|\.)ccavenue\.com$/i.test(url.hostname)) {
      throw new Error('CCAVENUE_PAYMENT_URL must be an HTTPS ccavenue.com URL.');
    }
    return url.toString();
  }
  return String(process.env.CCAVENUE_MODE || '').toLowerCase() === 'test'
    ? TEST_PAYMENT_URL
    : PRODUCTION_PAYMENT_URL;
}

/* Where the Order Status API lives (lib/ccavenue.js orderStatus). The same
   test switch as the payment page; an override must be CCAvenue's own host,
   because the request carries the access code and is read with the working
   key. */
const PRODUCTION_STATUS_URL = 'https://api.ccavenue.com/apis/servlet/DoWebTrans';
const TEST_STATUS_URL = 'https://apitest.ccavenue.com/apis/servlet/DoWebTrans';

function getStatusUrl() {
  const configured = cleanText(process.env.CCAVENUE_STATUS_URL || '', 500);
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || !/(^|\.)ccavenue\.com$/i.test(url.hostname)) {
      throw new Error('CCAVENUE_STATUS_URL must be an HTTPS ccavenue.com URL.');
    }
    return url.toString();
  }
  return String(process.env.CCAVENUE_MODE || '').toLowerCase() === 'test' ? TEST_STATUS_URL : PRODUCTION_STATUS_URL;
}

function randomToken(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  while (token.length < length) token += alphabet[crypto.randomInt(0, alphabet.length)];
  return token.slice(0, length);
}

function createPfaOrderId(type) {
  const prefix = {
    donate: 'PFA-DON-',
    caregiver: 'PFA-CAR-',
    'caregiver-application': 'PFA-CGA-',
    membership: 'PFA-MEM-'
  }[String(type || '').toLowerCase()];
  if (!prefix) throw new Error('Unsupported PFA payment type.');
  return `${prefix}${randomToken(8)}`;
}

function createMemberId() {
  return `PFA-MBR-${randomToken(8)}`;
}

// Colony Animal Colony Caregiver Card numbers. The same format is used whether the
// card was issued free as a digital card or alongside a paid shipping order:
// one person, one card number, wherever the journey started.
function createCaregiverCardId() {
  return `PFA-CCT-${randomToken(8)}`;
}


function renderError(response, statusCode, title, message, backUrl, backLabel) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | PFA</title><style>
*{box-sizing:border-box}@font-face{font-family:Marcellus;src:url(/fonts/marcellus-latin.woff2) format("woff2");font-display:swap}body{margin:0;background:#fff;color:#111;font-family:Helvetica Neue,Helvetica,Arial,sans-serif}h1{font-family:Marcellus,Georgia,serif;font-weight:400;letter-spacing:.01em;text-transform:uppercase}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(560px,100%);border:1px solid #d9d9d9;padding:32px}.logo{width:180px;max-width:55%;height:auto;margin-bottom:32px}h1{font-size:32px;line-height:1.08;margin:0 0 14px}p{font-size:17px;line-height:1.55;color:#555}.btn{display:inline-block;margin-top:18px;background:#111;color:#fff;text-decoration:none;padding:14px 20px;font-weight:700}
</style></head><body><main class="wrap"><section class="card"><img class="logo" src="/img/logo.png" alt="People for Animals"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="btn" href="${escapeHtml(backUrl)}">${escapeHtml(backLabel)}</a></section></main></body></html>`);
}

function renderTransfer(response, merchantValues, options) {
  const { accessCode, workingKey } = getCredentials(options && options.currency);
  const encryptedRequest = encrypt(encodeMerchantData(merchantValues), workingKey);
  const paymentUrl = getPaymentUrl();
  const nonce = crypto.randomBytes(18).toString('base64');
  const title = cleanText(options && options.title || 'Opening secure payment', 80);
  const message = cleanText(options && options.message || 'You are being transferred to CCAvenue.', 260);
  const returnUrl = cleanText(options && options.returnUrl || '/', 200);
  const orderId = cleanText(merchantValues && merchantValues.order_id || '', 80);

  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action https://secure.ccavenue.com https://test.ccavenue.com; base-uri 'none'; frame-ancestors 'none'`
  );
  response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | PFA</title><style>
*{box-sizing:border-box}@font-face{font-family:Marcellus;src:url(/fonts/marcellus-latin.woff2) format("woff2");font-display:swap}body{margin:0;background:#fff;color:#111;font-family:Helvetica Neue,Helvetica,Arial,sans-serif}h1{font-family:Marcellus,Georgia,serif;font-weight:400;letter-spacing:.01em;text-transform:uppercase}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(560px,100%);border:1px solid #ddd;padding:34px;text-align:center}.logo{width:180px;max-width:55%;height:auto;margin-bottom:30px}h1{font-size:30px;line-height:1.1;margin:0 0 12px}p{font-size:16px;line-height:1.55;color:#555}.btn{border:0;background:#111;color:#fff;padding:14px 20px;font:700 16px Helvetica Neue,Helvetica,Arial,sans-serif;cursor:pointer;margin-top:16px}.leave{display:inline-block;margin-top:18px;font-size:13px;color:#555;text-decoration:underline}.spinner{width:30px;height:30px;border:3px solid #ddd;border-top-color:#111;border-radius:50%;margin:22px auto;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><main class="wrap"><section class="card"><img class="logo" src="/img/logo.png" alt="People for Animals"><h1>${escapeHtml(title)}</h1><div class="spinner" aria-hidden="true"></div><p>${escapeHtml(message)}</p><form id="ccaForm" method="post" action="${escapeHtml(paymentUrl)}"><input type="hidden" name="encRequest" value="${escapeHtml(encryptedRequest)}"><input type="hidden" name="access_code" value="${escapeHtml(accessCode)}"><button class="btn" type="submit">Continue securely</button></form><a class="leave" href="${escapeHtml(returnUrl)}">Cancel and go back. No payment is taken.</a></section></main><script nonce="${nonce}">
/* The hand-off runs once. Coming BACK to this page - the Back button from
   CCAvenue, or their close button landing the visitor here - must never
   fire the transfer again, or every way out of the checkout loops straight
   back into it and the close button reads as broken. On a return visit the
   spinner stops and the page waits: Continue securely to try again, or the
   cancel link home. */
(function(){
  var KEY = 'pfa:transfer:${escapeHtml(orderId)}';
  var spin = document.querySelector('.spinner');
  function arm(again){
    if (spin) spin.style.display = again ? 'none' : '';
  }
  function returned(){
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function mark(){ try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  window.addEventListener('pageshow', function(e){
    if (e.persisted){ arm(true); return; }   /* restored from bfcache: wait for the visitor */
    if (returned()){ arm(true); return; }    /* a fresh load of a page already used once */
    mark(); arm(false);
    document.getElementById('ccaForm').submit();
  });
})();
</script></body></html>`);
}

function isConfigurationError(message) {
  return String(message || '').startsWith('Missing Vercel environment variable')
    || String(message || '').includes('PUBLIC_SITE_URL')
    || String(message || '').includes('CCAVENUE_PAYMENT_URL');
}

module.exports = {
  createPfaOrderId,
  createCaregiverCardId,
  createMemberId,
  getCredentials,
  getPaymentUrl,
  getStatusUrl,
  isConfigurationError,
  renderError,
  renderTransfer
};
