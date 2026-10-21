'use strict';

/* Settles, on its own, every payment CCAvenue knows the end of and this site
   does not (owner, 21 Oct 2026, of a panel listing payments still "Started"
   or "Unverified": "payment success to be recorded properly like done for
   https://pfa-oldsite.web.app/").

   A payment is recorded the moment CCAvenue's callback arrives. A payer who
   closes the tab on the bank's page after paying sends no callback, so the
   payment stayed 'initiated' until somebody pressed Check with CCAvenue in
   the panel. This presses it for them, every ten minutes on Firebase
   (functions/index.js) and once a day on Vercel (the email worker's cron):

   - each payment still initiated, pending or refused (verification_failed),
     started 15 minutes to 14 days ago, is asked about through the panel's
     own check (lib/routes/admin/payments-pending.js), so a final answer is
     applied exactly as the callback would have been: the same amount,
     merchant and currency checks, the same record, number and receipt, each
     once;
   - a payment is asked about at most every 30 minutes, and no more than
     LIMIT a run, so CCAvenue is never hammered;
   - CCAvenue having no record of an order two hours after it was started
     means the payer never paid there: it is marked abandoned (its status is
     left as it is, so a late callback still settles it) and leaves the
     panel's list of payments waiting;
   - without the CCAvenue access code and working key on the server it does
     nothing and says so. */

const firebase = require('./firebase');
const { cleanText } = require('./ccavenue');
const { getCredentials, getStatusUrl } = require('./pfa-ccavenue-flow');

const MIN_AGE_MS = 15 * 60 * 1000;
const RECHECK_MS = 30 * 60 * 1000;
const ABANDON_AFTER_MS = 2 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;
const LIMIT = 25;
const NO_RECORD = /no\s+record|not\s+found|invalid\s+order|order\s+(?:no|number)\s+(?:is\s+)?invalid/i;

function configured() {
  try { getCredentials('inr'); getStatusUrl(); return true; } catch (_) { return false; }
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  return Date.parse(value) || 0;
}

/* the request the panel's check reads the site's address from */
function siteRequest() {
  let host = 'peopleforanimalsindia.org';
  try { host = new URL(process.env.PUBLIC_SITE_URL || 'https://peopleforanimalsindia.org').host; } catch (_) { /* default */ }
  return { method: 'POST', url: '/api/payment/reconcile', headers: { host, 'x-forwarded-proto': 'https' }, query: {}, body: {} };
}

async function run(options) {
  const o = options || {};
  const nowMs = o.now ? o.now() : Date.now();
  const summary = { configured: configured(), looked: 0, asked: 0, settled: 0, abandoned: 0, waiting: 0, errors: 0, results: [] };
  if (!summary.configured) return summary;
  const db = o.db || firebase.getDb();
  const PP = require('./routes/admin/payments-pending')._private;
  const since = firebase.timestampFromMillis(nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db.collection('transactions').where('createdAt', '>=', since).orderBy('createdAt', 'desc').limit(2000).get();
  const due = snap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, t: doc.data() || {} }))
    .filter(({ t }) => ['initiated', 'pending', 'verification_failed'].includes(t.status) && !t.abandoned)
    .filter(({ t }) => {
      const age = nowMs - millisOf(t.createdAt);
      return age >= MIN_AGE_MS && nowMs - millisOf(t.lastAutoCheckAt) >= RECHECK_MS;
    })
    .slice(0, o.limit || LIMIT);
  summary.looked = due.length;
  const request = siteRequest();
  for (const { id, ref, t } of due) {
    const orderId = cleanText(t.orderId || id, 80);
    let outcome;
    try {
      outcome = await PP.check(orderId, t, request, o.fetch || ((...a) => fetch(...a)));
    } catch (error) {
      outcome = { status: 503, body: { code: 'UNAVAILABLE', message: cleanText(error && error.message, 200) } };
    }
    summary.asked += 1;
    const b = outcome.body || {};
    const note = { at: new Date(nowMs).toISOString(), ccavenue: b.ccavenue || '', applied: Boolean(b.applied), code: b.code || '', message: cleanText(b.message, 200) };
    const update = { lastAutoCheckAt: firebase.timestampFromMillis(nowMs), lastAutoCheck: note };
    const age = nowMs - millisOf(t.createdAt);
    if (b.applied) {
      summary.settled += 1;
    } else if (b.code === 'STATUS_UNAVAILABLE' && NO_RECORD.test(String(b.message || '')) && age >= ABANDON_AFTER_MS) {
      Object.assign(update, { abandoned: true, abandonedAt: new Date(nowMs).toISOString() });
      summary.abandoned += 1;
    } else if (outcome.status >= 400) {
      summary.errors += 1;
    } else {
      summary.waiting += 1;
    }
    try { await ref.update(update); } catch (error) {
      console.warn('payment reconcile: note not written', { orderId, message: cleanText(error && error.message, 200) });
    }
    summary.results.push({ orderId, status: b.status || t.status, ccavenue: b.ccavenue || '', applied: Boolean(b.applied), abandoned: Boolean(update.abandoned), code: b.code || '' });
  }
  return summary;
}

module.exports = { run, MIN_AGE_MS, RECHECK_MS, ABANDON_AFTER_MS, LIMIT };
