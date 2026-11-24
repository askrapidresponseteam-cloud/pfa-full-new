'use strict';

/* The settings the site's server reads that differ between a deployment and
   the next: names only. Platform ones (the host's own, the Firebase key
   Vercel needs and Firebase does not) are left out, as is PUBLIC_SITE_URL,
   which is meant to differ (lib/public-site.js). */
const SETTINGS = [
  'CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE', 'CCAVENUE_PAYMENT_URL', 'CCAVENUE_STATUS_URL',
  'CCAVENUE_USD_MERCHANT_ID', 'CCAVENUE_USD_ACCESS_CODE', 'CCAVENUE_USD_WORKING_KEY',
  'PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_SMTP_HOST', 'PFA_SMTP_PORT', 'PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_MAIL_FROM', 'PFA_MAIL_REPLY_TO',
  'PFA_IMAP_USER', 'PFA_IMAP_PASS', 'PFA_IMAP_HOST', 'PFA_IMAP_PORT', 'PFA_CAPTURE_REPLIES', 'PFA_REPLY_ADDRESS_PATTERN', 'PFA_SENT_COPY',
  'PFA_ADMIN_TOKEN', 'PFA_AUTH_PEPPER', 'CRON_SECRET', 'PFA_PUBLIC_SITE_URL', 'PFA_PANEL_URL', 'PFA_ALERT_EMAIL',
  'PFA_SHOP_FIREBASE_SERVICE_ACCOUNT', 'PFA_SHOP_FIREBASE_PROJECT', 'PFA_SHOP_ORDERS_EMAIL',
  'PFA_STORAGE_BUCKET', 'PFA_FILE_STORE', 'PHOTO_CUTOUT_KEY', 'PHOTO_CUTOUT_ENDPOINT', 'PHOTO_CUTOUT_FORMAT', 'PHOTO_CUTOUT_FIELD',
  'PFA_RRT_REFERRAL_SECRET', 'PFA_RRT_API', 'PFA_RRT_SITE', 'PFA_REGISTER_SHEET_ID',
  'PFA_WEEKLY_DIGEST', 'PFA_DIGEST_CC', 'PFA_QUIZ_REPORT', 'PFA_INTERN_APPS_REPORT', 'PFA_FINANCE_REPORT', 'PFA_CRUELTY_REPORT', 'PFA_SECTION_REPORT_TO', 'PFA_BIRTHDAY_GREETINGS'
];

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method !== 'GET') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET');
    response.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }
  const ccavenue = {
    merchantId: Boolean(process.env.CCAVENUE_MERCHANT_ID),
    accessCode: Boolean(process.env.CCAVENUE_ACCESS_CODE),
    workingKey: Boolean(process.env.CCAVENUE_WORKING_KEY)
  };
  const firebase = require('../../firebase').isConfigured();
  const ok = Object.values(ccavenue).every(Boolean) && firebase;
  /* Whether acknowledgement, receipt and welcome emails can leave at all.
     Without the key every form still files and the page tells the person the
     email did not go; this makes that visible without submitting anything.
     A yes or no only, never the key, and not part of ok: payments work
     without it. DEPLOY.command reads it after every deploy. */
  const mail = Boolean((process.env.PFA_SMTP_USER && process.env.PFA_SMTP_PASS) || process.env.PFA_MAIL_API_KEY);
  const mailVia = process.env.PFA_SMTP_USER && process.env.PFA_SMTP_PASS ? 'mailbox' : (process.env.PFA_MAIL_API_KEY ? 'resend' : 'none');
  /* Where shop orders are being written: 'pfa-oldsite' once its key is set,
     this site's own Firestore ('pfa-new-website') otherwise, or 'none'. A
     name only, never a key. */
  let shopOrders = 'none';
  try { shopOrders = require('../../shop-backend').ready(); } catch (_) { shopOrders = 'none'; }
  /* Where photographs and documents are being kept: 'storage' once the
     Firebase Storage bucket takes files (lib/file-store.js), 'database'
     while it does not. A word only. Never holds the answer up past 4s. */
  let files = 'database';
  try {
    const where = await Promise.race([require('../../file-store').bucket(), new Promise((r) => setTimeout(() => r(null), 4000))]);
    files = where ? 'storage' : 'database';
  } catch (_) { files = 'database'; }
  /* The two servers (Vercel and Firebase) share one database but not their
     settings (8 Oct 2026). These let DEPLOY.command see whether they agree
     without showing a secret: `pepper` is the first 4 hex characters of a
     hash of PFA_AUTH_PEPPER (16 bits: enough to tell two values apart, far
     too little to recover one), or 'none'; `site` is where this server's
     emails link to. */
  /* The same for CCAvenue's keys (24 Nov 2026, moving the website to
     Firebase): 4 hex characters of a hash of each, or 'none', so
     scripts/firebase-move-check.js can say the two servers hold exactly the
     same keys without either one showing a key. */
  const print = (name) => {
    const v = String(process.env[name] || '').trim();
    return v ? require('crypto').createHash('sha256').update(`pfa-key-fingerprint:${name}:${v}`, 'utf8').digest('hex').slice(0, 4) : 'none';
  };
  const keyPrints = {
    merchantId: print('CCAVENUE_MERCHANT_ID'), accessCode: print('CCAVENUE_ACCESS_CODE'), workingKey: print('CCAVENUE_WORKING_KEY'),
    usdMerchantId: print('CCAVENUE_USD_MERCHANT_ID'), usdAccessCode: print('CCAVENUE_USD_ACCESS_CODE'), usdWorkingKey: print('CCAVENUE_USD_WORKING_KEY')
  };
  const pepperValue = String(process.env.PFA_AUTH_PEPPER || '');
  const pepper = pepperValue
    ? require('crypto').createHash('sha256').update(`pfa-pepper-fingerprint:${pepperValue}`, 'utf8').digest('hex').slice(0, 4)
    : 'none';
  /* The caller's address as this server sees it, masked (203.0.113.x).
     DEPLOY.command asks both servers from the same computer: if they see
     the same network, each one's rate limits key on the real visitor
     (lib/client-ip.js). */
  const IP = require('../../client-ip');
  const seenAs = IP.masked(IP.clientIp(request));
  let site = '';
  try { site = new URL(String(process.env.PUBLIC_SITE_URL || '')).origin; } catch (_) { site = ''; }
  /* Which of the site's settings this server has, by name only, never a
     value (24 Nov 2026, for moving the website from Vercel to Firebase):
     scripts/firebase-move-check.js reads both servers and lists any setting
     Vercel has that Firebase does not, before the domain is moved. */
  const settings = SETTINGS.filter((name) => String(process.env[name] || '').trim() !== '');
  const host = process.env.VERCEL ? 'vercel' : (process.env.K_SERVICE || process.env.FUNCTION_TARGET) ? 'firebase' : 'local';
  response.statusCode = ok ? 200 : 503;
  response.end(JSON.stringify({
    ok,
    scope: ['donate', 'caregiver', 'caregiver-application', 'membership'],
    store: false,
    ccavenue,
    firebase,
    mail,
    mailVia,
    shopOrders,
    files,
    pepper,
    site,
    seenAs,
    host,
    settings,
    keyPrints,
    callback: '/api/payment/response'
  }));
};

module.exports.SETTINGS = SETTINGS;
