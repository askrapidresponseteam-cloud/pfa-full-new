'use strict';

/* Drains the outbound email queue. Point a cron at it (Vercel cron, every few
   minutes). Everything queued is retried here with exponential backoff, so an
   email is never lost because the mail provider was down at the moment an
   application was submitted. */

const crypto = require('crypto');
const CAREGIVER = require('../../../lib/caregiver');
const store = require('../../../lib/caregiver-store');
const mail = require('../../../lib/caregiver-mail');
const documents = require('./documents');
const { getDb } = require('../../../lib/firebase');

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

/* Either token opens this. The documentation offers both, Vercel's cron sends
   CRON_SECRET, and a person running it by hand sends PFA_ADMIN_TOKEN.
   `PFA_ADMIN_TOKEN || CRON_SECRET` accepted only whichever was set first, so a
   deployment carrying both answered its own nightly run with a 401 and the
   queue was never worked. Both are compared, and both comparisons are made
   whatever the first one says, so the answer does not depend on which matched. */
function authorised(request) {
  const header = String((request.headers || {}).authorization || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented) return false;
  const accepted = [process.env.PFA_ADMIN_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value || '')).filter(Boolean);
  if (!accepted.length) return false;
  return accepted.reduce((ok, token) => CAREGIVER.safeEqual(token, presented) || ok, false);
}

module.exports = async function handler(request, response) {
  if (!authorised(request)) {
    return sendJson(response, 401, { code: 'UNAUTHORISED', message: 'A valid token is required.' });
  }
  /* Unpaid caregiver pictures older than a day go first; this does not need
     mail to be configured, so it runs before that check. */
  const summary = { claimed: 0, sent: 0, retried: 0, failed: 0, sweptDocuments: 0 };
  try { summary.sweptDocuments = await documents.sweep(getDb()); } catch (_) { /* logged inside */ }
  /* Payments whose callback never came are asked about and settled
     (lib/payment-reconcile.js): every ten minutes on Firebase, which calls
     this worker on that schedule, and once a day on Vercel's cron. Before
     the mail check, as a payment is recorded whether or not mail is set up;
     its receipt then waits in the queue like any other. */
  try {
    const ran = await require('../../payment-reconcile').run();
    summary.payments = { configured: ran.configured, asked: ran.asked, settled: ran.settled, abandoned: ran.abandoned };
  } catch (error) {
    console.error('payment reconcile failed', String(error && error.message).slice(0, 300));
  }

  if (!mail.isConfigured()) {
    return sendJson(response, 503, { code: 'MAIL_NOT_CONFIGURED', message: 'No mail is set up: neither PFA_SMTP_USER and PFA_SMTP_PASS nor PFA_MAIL_API_KEY.', sweptDocuments: summary.sweptDocuments });
  }

  /* Two runs can overlap (Vercel and Firebase share the queue; a run by
     hand, the panel's Resend, a form still sending). Each row is claimed in
     a transaction just before it is sent, so every row goes once, and a
     long batch never outlives the leases of its last rows (8 Oct 2026,
     review C item 4). */
  const by = `worker:${crypto.randomBytes(4).toString('hex')}`;
  Object.assign(summary, { skipped: 0, uncertain: 0, stoppedFor: '' });
  /* After a refused login the mailbox is left alone for a while
     (lib/caregiver-store.js loginGate): the worker runs every ten minutes
     and must not ask GoDaddy with a wrong password every ten minutes. A run
     by hand can say force=1. */
  const forced = String((request.query || {}).force || '') === '1' || Boolean(request.body && request.body.force === true);
  if (!forced) {
    try {
      const gate = await store.loginGate();
      if (gate.closed) return sendJson(response, 200, Object.assign(summary, { waitingForLogin: gate.nextTryAt }));
    } catch (_) { /* no gate to read: work as before */ }
  }
  let loginError = '';
  try {
    const due = await store.dueEmails(25);

    for (const row of due) {
      const item = await store.claimEmail(row.id || row.emailId, { by });
      if (!item) { summary.skipped += 1; continue; }
      summary.claimed += 1;
      try {
        const sent = await mail.deliver({ to: item.to, template: item.template, payload: item.payload });
        await store.recordEmailResult({ emailId: item.emailId, claimToken: item.claimToken, ok: true, providerId: sent && sent.providerId });
        summary.sent += 1;
      } catch (error) {
        /* The mailer says what kind of failure it was, and the queue counts
           it accordingly: a refused address (a 5xx about the recipient) is
           parked at once rather than retried six times against an address
           that will never accept it; a refused login is not counted at all;
           no answer after the message was handed over waits out its lease. */
        const kind = store.failureKind(error);
        const result = await store.recordEmailResult({
          emailId: item.emailId,
          claimToken: item.claimToken,
          ok: false,
          kind,
          error: (error && error.message) || String(error)
        });
        if (result && result.status === 'failed') summary.failed += 1;
        else if (kind === 'unknown') summary.uncertain += 1;
        else summary.retried += 1;
        /* Every email after a refused login would be refused the same way,
           and repeated bad logins can get the mailbox locked: the rest wait,
           uncounted, for the next run. */
        if (kind === 'config') { summary.stoppedFor = 'login'; loginError = (error && error.message) || String(error); break; }
      }
    }

    try {
      if (summary.stoppedFor === 'login') summary.waitingForLogin = await store.noteLoginFailure(loginError);
      else if (summary.sent > 0) await store.noteLoginWorks();
    } catch (_) { /* the gate is a courtesy to the mailbox, never a reason to fail the run */ }
    return sendJson(response, 200, summary);
  } catch (error) {
    console.error('PFA email worker error:', CAREGIVER.clean(error && error.message, 240));
    return sendJson(response, 503, { code: 'WORKER_FAILED', message: 'The queue could not be drained.' });
  }
};
