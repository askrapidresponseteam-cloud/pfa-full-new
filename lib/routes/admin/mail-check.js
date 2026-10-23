'use strict';

/* GET  /api/admin/mail-check   whether email can leave the site, where the
                                copies of submissions go, and what happened
                                to the last ones sent there
   POST /api/admin/mail-check   sends a test email to that inbox now, and
                                says in plain words what the provider answered

   Owner, 7 Oct 2026: "need the submissions to work perfectly. it should go
   to gandhim email id." Every form already files its record and sends PFA's
   inbox a copy, and a test proves it does. What no test can prove is the live
   mail account: whether its key is set, and whether the provider will send
   from the address the site sends as. A provider that refuses the sender
   refuses every email, and the forms still say "received", because the record
   is real. So this makes it visible, from the panel, without anyone opening
   the provider's dashboard or the server logs, and without showing any key.

   Reading needs the Submissions section; sending a test needs a super
   administrator, and is written to the audit log. */

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb } = require('../../../lib/firebase');
const mail = require('../../../lib/caregiver-mail');
const FORWARD = require('../../../lib/submission-forward');
const audit = require('../../../lib/admin-audit');
const store = require('../../../lib/caregiver-store');
const SENT = require('../../../lib/sent-copy');

const DEFAULT_FROM = 'People for Animals <cards@peopleforanimalsindia.org>';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => { raw += c; if (raw.length > 4096) raw = raw.slice(0, 4096); });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

/* Where this copy of the site runs, so every instruction names the place
   the setting actually lives. Until 8 Oct 2026 they all said "In Vercel",
   which on the Firebase deployment sent the reader to the wrong dashboard. */
function host() {
  return process.env.K_SERVICE || process.env.FUNCTION_TARGET ? 'firebase' : 'vercel';
}

function whereSettingsLive() {
  return host() === 'firebase'
    ? 'On the Firebase deployment, set the password with: npx firebase-tools functions:secrets:set PFA_SMTP_PASS, and deploy again (npm run deploy:firebase); PFA_SMTP_USER is info@peopleforanimalsindia.org unless functions/.env names another'
    : 'In Vercel, Settings, Environment Variables, add PFA_SMTP_USER (info@peopleforanimalsindia.org) and PFA_SMTP_PASS (that mailbox\'s password), then redeploy';
}

/* the mailer's own answer: PFA's mailbox by SMTP, or Resend */
function sender() {
  return mail.sender ? mail.sender() : { via: 'resend', from: DEFAULT_FROM, address: 'cards@peopleforanimalsindia.org', domain: 'peopleforanimalsindia.org' };
}

/* What a refusal means, said so that the person reading it knows what to
   change and where. The provider's own words are kept underneath. */
/* `on`: the server the failed attempt was made from ('vercel', 'firebase'),
   recorded on the queue row since 8 Oct 2026. The panel runs on Firebase,
   so naming the panel's own server sent people to mend the wrong one when
   the email had failed on the website (Vercel). */
function plainly(error, on) {
  const raw = String((error && error.message) || error || '');
  const { domain } = sender();
  /* an attempt whose answer never came (lib/caregiver-mail.js smtpPhase) */
  if ((error && error.uncertain) || /outcome not known/i.test(raw)) {
    return 'The mail server had not answered when the site stopped waiting, so this email may already have arrived. It is tried again only after a few minutes have passed: at worst it arrives twice, never not at all.';
  }
  if ((error && error.code === 'MAIL_NOT_CONFIGURED') || /not configured/i.test(raw)) {
    return `No email is set up on the live site, so none leaves it. ${whereSettingsLive()}.`;
  }
  const code = String((error && (error.code || error.responseCode)) || '');
  if (code === 'EAUTH' || /\b535\b|authentication|invalid login|auth.*fail/i.test(raw)) {
    const server = on || (error && error.on) || '';
    const where = server === 'vercel'
      ? 'in Vercel, where the website runs (this email was tried from there)'
      : server === 'firebase'
        ? 'on Firebase, where the panel runs (npx firebase-tools functions:secrets:set PFA_SMTP_PASS)'
        : on === undefined && host() === 'firebase'
          ? 'on Firebase (npx firebase-tools functions:secrets:set PFA_SMTP_PASS)'
          : on === undefined ? 'in Vercel' : 'in Vercel for the website and on Firebase for the panel, whichever sent it';
    return `GoDaddy did not accept the mailbox and password. Check PFA_SMTP_USER and PFA_SMTP_PASS ${where}, and in the mailbox's settings (Titan, Settings) turn on third-party email access; with two-step sign-in on, use an app password. Then deploy again.`;
  }
  if (/ECONNECTION|ETIMEDOUT|ESOCKET|ENOTFOUND|EDNS|ECONNREFUSED|ECONNRESET/.test(code)) {
    return 'The site could not reach GoDaddy\'s mail server. It tried smtpout.secureserver.net and smtp.titan.email. Try again in a minute; if it keeps failing, set PFA_SMTP_HOST in Vercel to the server GoDaddy shows for this mailbox.';
  }
  if (/\b55[0-4]\b|sender.*(rejected|denied)|not allowed to send/i.test(raw)) {
    return 'GoDaddy refused to send as this address. The site sends as the mailbox itself (PFA_SMTP_USER); check it is the full address of a working GoDaddy mailbox.';
  }
  if (/domain.{0,40}not.{0,10}verified|verify.{0,20}domain|not a verified domain/i.test(raw)) {
    return `Resend will not send from ${domain || 'that domain'} until the domain is verified in the Resend account. Either add the DNS records Resend lists for ${domain || 'it'}, or set PFA_MAIL_FROM in Vercel to an address on a domain that is verified there, then redeploy.`;
  }
  if (/only send testing emails|testing emails to your own email/i.test(raw)) {
    return 'The Resend account is still in test mode: it sends only to the account owner\'s own address. Verify a sending domain in Resend so it can send to anyone else.';
  }
  if (/\b401\b|api key is invalid|invalid.api.key|missing api key|unauthori[sz]ed/i.test(raw)) {
    return 'Resend does not accept the mail key the site holds. Create a new API key in Resend, paste it into PFA_MAIL_API_KEY in Vercel, and redeploy.';
  }
  if (/\b429\b|rate.?limit/i.test(raw)) {
    return 'Resend is asking the site to slow down. Wait a minute and send the test again.';
  }
  if (/abort|timeout|ENOTFOUND|ECONNRE/i.test(raw)) {
    return 'The mail provider did not answer in time. Try again in a minute.';
  }
  return 'The mail provider refused the email.';
}

const isoOf = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/* The last copies sent to the inbox, newest first. One equality filter and
   no order on the query, so it needs no composite index; the sort is here. */
async function recentForwards(db) {
  const snap = await db.collection('caregiverEmails').where('template', '==', 'submission_forward').limit(300).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() || {};
      const status = String(d.status || '');
      return {
        id: doc.id,
        uncertain: Boolean(d.uncertain),
        reference: (d.payload && d.payload.reference) || '',
        to: d.to || '',
        status,
        attempts: Number(d.attempts) || 0,
        problem: status === 'sent' ? '' : (d.lastError ? plainly(d.lastError) : ''),
        detail: status === 'sent' ? '' : String(d.lastError || '').slice(0, 300),
        at: isoOf(d.updatedAt) || isoOf(d.createdAt)
      };
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 15);
}

/* Submissions that never had a copy queued for an inbox. A copy is queued
   only when email is set up at the moment the form is sent, so everything
   that arrived while it was not (on Firebase, until 8 Oct 2026, because a
   fresh deploy dropped PFA_SMTP_USER) has no copy anywhere and nothing would
   ever send one. Two unordered single-collection reads, so no index.

   A copy is found by the very row the forward writes: the queue id built
   from FORWARD.forwardKey, which carries the record's threadId (CONTRACT
   section 4). Matching on the reference alone, a reused reference looked
   copied because its predecessor's row was there (review C item 1). Copies
   queued before the threadId joined the key (8 Oct 2026) sit under the old
   key; such a row counts for a record only when the thread it carries is
   the record's own. */
async function missedSubmissions(db, inboxes) {
  if (!inboxes.length) return [];
  /* each record is checked against its own route: a record of money against
     the payments inboxes, anything else against the forms inbox */
  const queued = await db.collection('caregiverEmails').where('template', '==', 'submission_forward').limit(2000).get();
  const rows = new Map(queued.docs.map((doc) => [doc.id, doc.data() || {}]));
  const copied = (record, to) => {
    if (rows.has(store.emailIdFor('submission_forward', FORWARD.forwardKey(record, to)))) return true;
    if (!record.threadId) return false;
    const older = rows.get(store.emailIdFor('submission_forward', FORWARD.forwardKey({ reference: record.reference }, to)));
    return Boolean(older && older.payload && older.payload.threadId === record.threadId);
  };
  const subs = await db.collection('submissions').limit(2000).get();
  return subs.docs
    .map((doc) => Object.assign({ reference: doc.id }, doc.data() || {}))
    /* a record of money copied to the forms inbox before 21 Oct 2026 had its
       copy then: it is not listed as missed, or the first press would send
       every old payment again to the payments inboxes */
    .filter((d) => d.reference && FORWARD.inboxes(d).some((to) => !copied(d, to))
      && !(FORWARD.isPaid(d) && copied(d, FORWARD.DEFAULT_INBOX)))
    .map((d) => ({ reference: d.reference, kind: d.kind || '', kindLabel: d.kindLabel || d.kind || '', createdAt: isoOf(d.createdAt) }))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/* What each queued email is, in the panel's words. */
const WHAT = {
  submission_received: 'Confirmation to the sender',
  submission_forward: 'Copy to PFA\'s inbox',
  submission_followup: 'Their reply, relayed to PFA\'s inbox',
  submission_reply: 'Reply from staff',
  payment_received: 'Donation receipt',
  membership_welcome: 'Membership welcome letter',
  caregiver_application_received: 'Application confirmation',
  shop_order_confirmed: 'Shop order confirmation',
  shop_order_staff: 'Shop order, to staff',
  card_issued: 'Caregiver card',
  shipping_paid: 'Printed card paid',
  shipment_update: 'Delivery update',
  staff_invite: 'Panel access',
  inbox_test: 'Test email'
};

const LOGIN_WORDS = /EAUTH|ENOAUTH|Invalid login|Missing credentials|\b53[0458]\b|authenticat|\b401\b|api key is invalid/i;
const STALE_QUEUED_MS = 10 * 60 * 1000;

/* Every email of every template that has not gone and needs a person to
   see it (8 Oct 2026, review C item 2: until then only the copies to the
   inbox were listed, so a confirmation, receipt or relayed reply that
   failed stayed failed where nobody could see it): parked, retrying, sent
   with no answer (outcome not known), a claim whose lease ran out, and a
   row nobody has tried for ten minutes. One unordered single-field query. */
async function failingEmails(db) {
  const snap = await db.collection('caregiverEmails').where('status', 'in', ['failed', 'retry', 'sending', 'queued']).limit(500).get();
  const nowMs = Date.now();
  const ms = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
  return snap.docs
    .map((doc) => Object.assign({ id: doc.id }, doc.data() || {}))
    /* a copy about money queued for an inbox that may no longer have it (the
       forms inbox, before 21 Oct 2026) is refused by deliver() for good: it
       is superseded, not failing, and Send again would only fail again */
    .filter((d) => !mail.moneyToWrongInbox(d.to, d.template, d.payload))
    .filter((d) => d.status === 'failed' || d.status === 'retry'
      || (d.status === 'sending' && (d.uncertain || ms(d.leaseUntil) <= nowMs))
      || (d.status === 'queued' && ms(d.nextAttemptAt) <= nowMs - STALE_QUEUED_MS))
    .map((d) => {
      const kind = d.lastErrorKind || (d.lastError ? store.failureKind(String(d.lastError)) : '');
      const live = d.status === 'sending' && ms(d.leaseUntil) > nowMs;
      return {
        id: d.id,
        template: d.template || '',
        what: WHAT[d.template] || String(d.template || 'Email'),
        reference: (d.payload && (d.payload.reference || d.payload.applicationRef || d.payload.memberId || d.payload.orderId)) || '',
        to: d.to || '',
        status: d.status,
        attempts: Number(d.attempts) || 0,
        kind,
        login: kind === 'config' && LOGIN_WORDS.test(String(d.lastError || '')),
        uncertain: Boolean(d.uncertain),
        bounced: Boolean(d.bounced),
        problem: d.lastError
          ? plainly(d.lastError, d.lastErrorOn || '') + (kind === 'config' && LOGIN_WORDS.test(String(d.lastError)) ? ' If that has been put right since this was tried, press Send again.' : '')
          : (d.status === 'queued' ? 'Not tried yet: the email worker sends it on its next run.' : ''),
        detail: String(d.lastError || '').slice(0, 300),
        at: d.lastErrorAt || isoOf(d.updatedAt) || isoOf(d.createdAt),
        retryAt: live ? d.leaseUntil : (d.status === 'failed' ? null : d.nextAttemptAt || null),
        canResend: !live && d.status !== 'queued'
      };
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 60);
}

/* "The mail is failing to log in": the newest failures are refused logins,
   recent (three days), and no copy has gone since. Said once, at the top,
   instead of as fifty separate failures, because it is one thing to mend
   and it blocks every email (review C item 2). */
function loginState(failing, recent) {
  const login = failing.filter((r) => r.login && r.at);
  if (!login.length) return { failing: false };
  const newest = login.reduce((a, r) => (String(r.at) > a ? String(r.at) : a), '');
  if (Date.now() - Date.parse(newest) > 3 * 24 * 3600 * 1000) return { failing: false };
  const otherSince = failing.some((r) => !r.login && r.kind !== 'unknown' && r.status !== 'queued' && String(r.at || '') > newest);
  const sentSince = (recent || []).some((r) => r.status === 'sent' && String(r.at || '') > newest);
  if (otherSince || sentSince) return { failing: false };
  const since = login.reduce((a, r) => (!a || String(r.at) < a ? String(r.at) : a), '');
  const said = login[0].detail;
  return { failing: true, since, waiting: login.length, problem: /\b401\b|api key/i.test(said) ? plainly(said) : plainly({ code: 'EAUTH', message: said }) };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }
  const who = await requireAdmin(request, response, 'submissions');
  if (!who) return undefined;

  const { from, domain, via } = sender();
  const inboxes = FORWARD.formInboxes();
  const paymentInboxes = FORWARD.paymentInboxes();
  const everyInbox = FORWARD.allInboxes();
  const configured = mail.isConfigured();

  if (request.method === 'GET') {
    let recent = [];
    let recentError = '';
    try { recent = await recentForwards(getDb()); } catch (error) {
      console.error('mail check: recent forwards not read', error && error.message);
      recentError = 'The list of recent copies could not be read.';
    }
    let missed = [];
    try { missed = await missedSubmissions(getDb(), everyInbox); } catch (error) {
      console.error('mail check: missed submissions not read', error && error.message);
    }
    let sentCopies = { on: false, waiting: 0, lastError: '' };
    try { sentCopies = await SENT.status(getDb()); } catch (error) {
      console.error('mail check: sent copies not read', error && error.message);
    }
    let failing = [];
    let failingError = '';
    try { failing = await failingEmails(getDb()); } catch (error) {
      console.error('mail check: failed emails not read', error && error.message);
      failingError = 'The list of emails that did not go could not be read.';
    }
    /* One word for the panel's headline: not-configured, login-failing
       (the mailbox refuses the site's login: mend the password and press
       Resend), some-failed, or ok. */
    /* While the worker is leaving the mailbox alone after a refused login,
       an email waiting on the login is next tried when the gate opens, not
       at its own time. */
    let gate = { closed: false };
    try { gate = await store.loginGate(); } catch (_) { gate = { closed: false }; }
    if (gate.closed) failing.forEach((r) => { if (r.kind === 'config' && r.retryAt && r.retryAt < gate.nextTryAt) r.retryAt = gate.nextTryAt; });
    const login = configured ? loginState(failing, recent) : { failing: false };
    const state = !configured ? 'not-configured' : login.failing ? 'login-failing' : failing.length ? 'some-failed' : 'ok';
    return sendJson(response, 200, {
      ok: true, state, configured, via, from, fromDomain: domain, inboxes, paymentInboxes, recent, recentError, missed,
      failing, failingError, login, sentCopies, host: host(), settingsHelp: whereSettingsLive()
    });
  }

  if (who.role !== 'super') return sendJson(response, 403, { code: 'SUPER_ONLY', message: 'Only a super administrator can send from here.' });
  const body = await readBody(request);
  if (body && body.action === 'resend') return resend(who, request, response, body);
  if (body && body.action === 'send-missed') return sendMissed(who, request, response, everyInbox);
  if (!everyInbox.length) return sendJson(response, 200, { ok: false, configured, from, inboxes: everyInbox, results: [], message: 'Forwarding is switched off (PFA_SUBMISSIONS_INBOX and PFA_PAYMENTS_INBOX are "off").' });

  const at = new Date().toISOString();
  const results = [];
  for (const to of everyInbox) {
    try {
      /* what this inbox actually receives, so the test says it truly */
      const covers = inboxes.includes(to) && paymentInboxes.includes(to) ? 'both' : paymentInboxes.includes(to) ? 'payments' : 'forms';
      const sent = await mail.deliver({ to, template: 'inbox_test', payload: { at, from, by: who.email || '', covers, siteUrl: process.env.PUBLIC_SITE_URL || '' } });
      results.push({ to, ok: true, providerId: (sent && sent.providerId) || '' });
    } catch (error) {
      results.push({ to, ok: false, problem: plainly(error), detail: String((error && error.message) || '').slice(0, 300) });
    }
  }
  const ok = results.every((r) => r.ok);
  /* wait for the copy in Sent too, so the answer can say it is there */
  const copies = ok && via === 'smtp' && SENT.enabled() ? await SENT.settle(12000) : null;
  const sentCopy = !copies ? 'off' : (copies.waiting ? 'waiting' : 'saved');
  try {
    await audit.record(who, {
      module: 'submissions', action: 'mail-test', subject: everyInbox.join(', '),
      detail: ok ? 'Test email accepted by the mail provider' : `Test email refused: ${results.filter((r) => !r.ok).map((r) => r.detail).join(' | ').slice(0, 200)}`,
      outcome: ok ? 'ok' : 'failed'
    }, request);
  } catch (_) { /* the log is a record of the test, not a condition of it */ }
  return sendJson(response, 200, { ok, configured, from, inboxes: everyInbox, results, sentCopy });
};

/* Sends again, now, emails that have not gone: every one in the failing
   list (any template: confirmations, receipts, relayed replies, copies to
   the inbox), or just the rows named by `id` or `ids`. For after the mail
   settings are put right, so a backlog arrives at once rather than over the
   next days, or never.

   Each row is claimed first (lib/caregiver-store.js claimEmail), so a row
   the form, the worker or a second press of this button is sending right
   now is left alone, and pressing twice sends once (review C item 4). A row
   already sent is never sent again. Each result is recorded under the claim
   exactly as the worker records it. A refused login stops the run: every
   other email would be refused the same way, and repeated bad logins can
   get the mailbox locked. */
const ID = /^[A-Za-z0-9_-]{1,160}$/;
async function resend(who, request, response, body) {
  const db = getDb();
  const named = body && (body.id || Array.isArray(body.ids))
    ? [...new Set([].concat(body.id || [], Array.isArray(body.ids) ? body.ids : []).map(String))]
    : null;
  if (named && (!named.length || !named.every((id) => ID.test(id)))) {
    return sendJson(response, 400, { code: 'BAD_ID', message: 'Name the emails to send again by their id.' });
  }
  const ids = (named || (await failingEmails(db)).filter((r) => r.canResend).map((r) => r.id)).slice(0, 40);
  const by = `resend:${String(who.email || who.uid || 'admin').slice(0, 60)}`;
  let sent = 0;
  let tried = 0;
  const skipped = [];
  const problems = [];
  let stoppedFor = '';
  let loginError = '';
  for (const id of ids) {
    if (stoppedFor) { skipped.push(id); continue; }
    const item = await store.claimEmail(id, { by, includeFailed: true, ignoreSchedule: true });
    if (!item) { skipped.push(id); continue; }
    tried += 1;
    const reference = (item.payload && (item.payload.reference || item.payload.applicationRef || item.payload.memberId || item.payload.orderId)) || '';
    try {
      const out = await mail.deliver({ to: item.to, template: item.template, payload: item.payload || {} });
      await store.recordEmailResult({ emailId: item.emailId, claimToken: item.claimToken, ok: true, providerId: out && out.providerId });
      sent += 1;
    } catch (error) {
      const kind = store.failureKind(error);
      await store.recordEmailResult({ emailId: item.emailId, claimToken: item.claimToken, ok: false, error: (error && error.message) || String(error), kind }).catch(() => {});
      problems.push({ id, reference, what: WHAT[item.template] || item.template, problem: plainly(error), detail: String((error && error.message) || '').slice(0, 300) });
      if (kind === 'config') { stoppedFor = 'login'; loginError = (error && error.message) || String(error); }
    }
  }
  /* the mailbox's login gate (lib/caregiver-store.js): a success opens it for
     every waiting email, a refusal keeps the worker away a little longer */
  try {
    if (stoppedFor === 'login') await store.noteLoginFailure(loginError);
    else if (sent > 0) await store.noteLoginWorks();
  } catch (_) { /* a courtesy to the mailbox, never a reason to fail */ }
  try {
    await audit.record(who, {
      module: 'submissions', action: 'mail-resend', subject: named ? named.join(', ').slice(0, 120) : `${ids.length} emails`,
      detail: `Sent again: ${sent} went, ${problems.length} did not, ${skipped.length} left alone${stoppedFor ? ' (the mailbox refused the login)' : ''}`, outcome: problems.length ? 'failed' : 'ok'
    }, request);
  } catch (_) { /* as above */ }
  await SENT.settle(12000);
  return sendJson(response, 200, { ok: problems.length === 0, tried, sent, skipped: skipped.length, skippedIds: skipped.slice(0, 40), stoppedFor, problems: problems.slice(0, 5) });
}

/* Makes and sends the copy for every submission that never had one, exactly
   as the form would have at the time: through FORWARD.forward, so it is
   queued (a refusal is then retried like any other), carries the photographs
   and the thread id, and is noted on the submission's conversation. The
   owner presses this; nothing old is sent on its own. */
async function sendMissed(who, request, response, inboxes) {
  if (!mail.isConfigured()) return sendJson(response, 200, { ok: false, tried: 0, sent: 0, problems: [{ problem: plainly({ code: 'MAIL_NOT_CONFIGURED' }) }] });
  const db = getDb();
  const missed = (await missedSubmissions(db, inboxes)).slice(0, 40);
  const siteUrl = String(process.env.PUBLIC_SITE_URL || '').trim();
  let sent = 0;
  const problems = [];
  for (const m of missed) {
    const snap = await db.collection('submissions').doc(m.reference).get();
    if (!snap.exists) continue;
    const record = Object.assign({ reference: m.reference }, snap.data() || {});
    const outcomes = await FORWARD.forward({ record, siteUrl, mail, queue: store, timeoutMs: 9000, db });
    const bad = outcomes.filter((o) => !o || o.state !== 'sent');
    if (!bad.length) { sent += 1; continue; }
    problems.push({
      reference: m.reference,
      problem: bad[0] && bad[0].state === 'queued'
        ? 'It did not go at once. It is in the list below with the reason, and is tried again.'
        : 'It could not be sent.'
    });
  }
  try {
    await audit.record(who, {
      module: 'submissions', action: 'mail-send-missed', subject: `${missed.length} submissions`,
      detail: `Copies made for submissions that never had one: ${sent} went, ${problems.length} did not`, outcome: problems.length ? 'failed' : 'ok'
    }, request);
  } catch (_) { /* the log is a record of the send, not a condition of it */ }
  await SENT.settle(12000);
  return sendJson(response, 200, { ok: problems.length === 0, tried: missed.length, sent, problems: problems.slice(0, 5) });
}

module.exports._private = { plainly, sender, host, missedSubmissions, failingEmails, loginState };
