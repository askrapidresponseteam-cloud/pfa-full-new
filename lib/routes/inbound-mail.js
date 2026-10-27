'use strict';

/* GET  /api/inbound-mail            where the reading of replies has got to
   POST /api/inbound-mail            read PFA's mailbox now and file what arrived
   POST /api/inbound-mail  { message: {...} }
                                     file one message handed in by a webhook
                                     (from, to, subject, messageId, inReplyTo,
                                     references, text, html, attachments[],
                                     headers) - the schedule's secret only

   Opened by the schedule (Vercel cron or Cloud Scheduler, bearer
   CRON_SECRET or PFA_ADMIN_TOKEN, as the email worker is) or by an
   administrator from the panel, with the Submissions section. The filing
   itself is lib/inbound-mail.js.

   An administrator can ask for the mailbox to be read now, and that is all
   (8 Oct 2026). Until then a signed-in member of staff could POST any
   { message } and it was filed as an email from the person, or from PFA's
   inbox (taking the case up in the inbox's name), with any date, and no
   audit row said who had done it. A message handed in whole is now taken
   only from the webhook or schedule holding the secret; from a signed-in
   account it is refused, and the refusal is in the audit log.

   Vercel's cron calls a path with GET (user agent vercel-cron/1.0, with
   CRON_SECRET as the bearer when that variable is set). Until 8 Oct 2026 a
   GET only reported where the reading had got to, so the daily Vercel run
   read nothing; only Firebase's schedule (a POST) and the panel's button
   did. A scheduled GET from Vercel's cron now reads the mailbox, as a POST
   does; the panel's GET still only asks for the status. */

const CAREGIVER = require('../caregiver');
const adminAuth = require('../admin-auth');
const firebase = require('../firebase');
const mail = require('../caregiver-mail');
const store = require('../caregiver-store');
const INBOUND = require('../inbound-mail');
const audit = require('../admin-audit');
const SENT = require('../sent-copy');
const WATCH = require('../reply-watch');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 8 * 1024 * 1024) raw = raw.slice(0, 8 * 1024 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function scheduled(request) {
  const header = String((request.headers || {}).authorization || '');
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented) return false;
  const accepted = [process.env.CRON_SECRET, process.env.PFA_ADMIN_TOKEN].map((v) => String(v || '')).filter(Boolean);
  return accepted.reduce((ok, token) => CAREGIVER.safeEqual(token, presented) || ok, false);
}

function fromVercelCron(request) {
  const h = request.headers || {};
  return /^vercel-cron\//i.test(String(h['user-agent'] || '')) || Boolean(h['x-vercel-cron-schedule']);
}

function siteUrl(request) {
  const configured = String(process.env.PUBLIC_SITE_URL || '').trim();
  try { const u = new URL(configured); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* fall through */ }
  const host = (request.headers || {})['x-forwarded-host'] || (request.headers || {}).host || 'pfa-full-website.vercel.app';
  return `https://${host}`;
}

function createHandler(deps) {
  const getDb = deps.getDb || firebase.getDb;
  const requireAdmin = deps.requireAdmin || adminAuth.requireAdmin;
  const mailer = deps.mail || mail;
  const queue = deps.queue || store;
  const inbound = deps.inbound || INBOUND;

  return async function handler(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    let who = null;
    if (!scheduled(request)) {
      who = await requireAdmin(request, response, 'submissions');
      if (!who) return undefined;
    }
    const db = getDb();
    const options = { mail: mailer, queue, siteUrl: siteUrl(request), fieldValue: firebase.fieldValue };

    try {
      if (request.method === 'GET' && !(who === null && fromVercelCron(request))) {
        return sendJson(response, 200, Object.assign({ ok: true }, await inbound.status(db)));
      }
      const body = request.method === 'GET' ? {} : await readBody(request);
      if (body && body.message !== undefined && body.message !== null) {
        if (who) {
          await audit.record(who, {
            module: 'submissions', action: 'mail-file', subject: 'replies',
            detail: 'Refused: an email handed in by hand. Only the mailbox reader or the webhook files email.', outcome: 'refused'
          }, request);
          return sendJson(response, 403, { ok: false, code: 'WEBHOOK_ONLY', message: 'Emails are filed only as they arrive in the mailbox. Use "Read the mailbox now", or add a note to the case.' });
        }
        if (typeof body.message !== 'object') return sendJson(response, 400, { ok: false, code: 'BAD_MESSAGE', message: 'message must be an object.' });
        const out = await inbound.file(db, body.message, options);
        return sendJson(response, 200, Object.assign({ ok: true }, out));
      }
      if (!inbound.imapConfigured()) {
        return sendJson(response, 503, { ok: false, code: 'MAILBOX_NOT_CONFIGURED', message: 'No mailbox is set up to read replies from. In Vercel, set PFA_SMTP_USER and PFA_SMTP_PASS (the info@ mailbox), or PFA_IMAP_USER and PFA_IMAP_PASS.' });
      }
      const summary = await inbound.check(db, Object.assign({ limit: 40 }, options));
      if (summary.busy) {
        return sendJson(response, 200, Object.assign({ ok: true, message: 'A reading of the mailbox is already under way; what it finds is filed in a moment.' }, summary));
      }
      /* The same run saves into the Sent folder any copy of a sent email that
         did not get there at once (lib/sent-copy.js), so every ten minutes on
         Firebase nothing is left waiting. */
      try { summary.sentCopies = await SENT.flush(db); } catch (error) {
        summary.sentCopies = { saved: 0, waiting: 0, error: String(error && error.message) };
      }
      /* After every scheduled reading: an alert if replies have stopped being
         picked up, and word when they are again (lib/reply-watch.js). A
         reading pressed in the panel is looked at too, so a mailbox put
         right by hand clears the red notice at once. Never throws. */
      summary.watch = await (deps.watch || WATCH.watch)(db);
      if (who) {
        /* awaited before the answer; record() never throws */
        await audit.record(who, {
          module: 'submissions', action: 'mail-read', subject: 'replies',
          detail: summary.error ? `Mailbox not read: ${summary.error}` : `${summary.fetched} new, ${summary.filed} filed, ${summary.unmatched} not about a submission`,
          outcome: summary.error ? 'refused' : 'done'
        }, request);
      }
      return sendJson(response, summary.error ? 502 : 200, Object.assign({ ok: !summary.error }, summary));
    } catch (error) {
      console.error('inbound mail failed', error && error.message);
      return sendJson(response, 500, { ok: false, code: 'SERVER_ERROR', message: 'Replies could not be read right now.' });
    }
  };
}

module.exports = createHandler({});
module.exports._private = { createHandler, scheduled, fromVercelCron };
