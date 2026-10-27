'use strict';

/* Watches the reading of replies, so they can never pile up unseen.

   Owner, 27 Oct 2026: "An alert if replies get stuck. If the info@ check
   fails or hasn't run for 30 minutes, you get an email and the panel shows a
   red notice. Replies can never silently pile up."

   Every reply to an email PFA sends comes to the site's own mailbox (info@)
   and is filed and sent on from there (lib/inbound-mail.js, every two
   minutes on Firebase). If that reading stops, replies wait in the mailbox
   and nobody would know. So:

   - health() says how the reading stands: 'ok', 'failing' (the mailbox could
     not be read on FAIL_RUNS runs in a row, about six minutes, so one passing
     blip is not an alert), 'stale' (not read for STALE_MINUTES), or 'off'
     (no mailbox is read on this deployment, so replies go straight to the
     person and there is nothing to watch).
   - watch() acts on it: an email to the administrators when it goes wrong,
     again every REMIND_HOURS while it stays wrong, and one when it is
     working again. It runs after every reading (which catches a failing
     mailbox) and from the ten-minute job (which catches a reading that has
     stopped running at all: a stopped job cannot report itself).
   - The panel reads health() with the reading's status and shows a red
     notice on every page while it is not 'ok' (admin.html, replyAlert).

   Who is emailed: PFA_ALERT_EMAIL (comma separated) when set; otherwise
   every super administrator of the panel; failing those, the site's own
   mailbox. The alert goes through the outbound queue like every other
   email, so if mail itself is down it waits and is retried; the panel's red
   notice does not depend on mail at all. */

const STATE = 'replyWatch';
const STALE_MINUTES = 30;
const FAIL_RUNS = 3;
const REMIND_HOURS = 6;

function configured() {
  const INBOUND = require('./inbound-mail');
  const off = /^off$/i.test(String(process.env.PFA_CAPTURE_REPLIES || '').trim());
  return INBOUND.imapConfigured() && !off;
}

function msOf(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) ? ms : 0;
}

/* `reading` is counters/inboundMail; `watching` is counters/replyWatch. */
function health(reading, watching, nowMs, isConfigured) {
  const r = reading || {};
  const w = watching || {};
  const on = isConfigured === undefined ? configured() : Boolean(isConfigured);
  if (!on) return { state: 'off' };
  const lastRunMs = msOf(r.lastRunAt);
  const streak = Number(r.failStreak) || 0;
  if (r.lastError && streak >= FAIL_RUNS) {
    return { state: 'failing', error: String(r.lastError).slice(0, 300), since: r.failingSince || r.lastRunAt || '', failStreak: streak, lastRunAt: r.lastRunAt || '' };
  }
  /* never read: counted from when the watch first looked, so a fresh deploy
     is not an alert before its first run */
  const fromMs = lastRunMs || msOf(w.watchingSince);
  if (fromMs && nowMs - fromMs > STALE_MINUTES * 60000) {
    return { state: 'stale', since: r.lastRunAt || w.watchingSince || '', lastRunAt: r.lastRunAt || '', minutes: Math.floor((nowMs - fromMs) / 60000) };
  }
  return { state: 'ok', lastRunAt: r.lastRunAt || '' };
}

/* The panel's sentence for a health that is not ok. */
function sentence(h) {
  if (!h || h.state === 'ok' || h.state === 'off') return '';
  if (h.state === 'failing') return `Replies to PFA's emails are not being picked up: the mailbox could not be read (${h.error}). They wait safely in the mailbox and are filed as soon as it works again.`;
  return `Replies to PFA's emails are not being picked up: the mailbox has not been checked ${h.lastRunAt ? `for ${h.minutes} minutes` : 'since the site was deployed'}. They wait safely in the mailbox and are filed as soon as the check runs again.`;
}

async function superAdmins() {
  require('./firebase').getDb();
  const auth = require('firebase-admin/auth').getAuth();
  const out = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    page.users.forEach((u) => {
      const c = u.customClaims || {};
      if (c.admin === true && c.role === 'super' && !u.disabled && u.email) out.push(u.email.toLowerCase());
    });
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

async function recipients() {
  const named = String(process.env.PFA_ALERT_EMAIL || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s));
  if (named.length) return [...new Set(named)];
  try {
    const supers = await superAdmins();
    if (supers.length) return [...new Set(supers)];
  } catch (error) {
    console.warn('reply watch: administrators not listed', error && error.message);
  }
  const own = String(process.env.PFA_IMAP_USER || process.env.PFA_SMTP_USER || '').trim().toLowerCase();
  return own ? [own] : [];
}

/* One look. Never throws; resolves to what it saw and did. */
async function watch(db, options) {
  const o = options || {};
  const nowMs = o.now ? o.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  try {
    const watchRef = db.collection('counters').doc(STATE);
    const [readSnap, watchSnap] = await Promise.all([db.collection('counters').doc('inboundMail').get(), watchRef.get()]);
    const reading = readSnap.exists ? readSnap.data() || {} : {};
    const watching = watchSnap.exists ? watchSnap.data() || {} : {};
    const next = Object.assign({}, watching);
    if (!next.watchingSince) next.watchingSince = nowIso;
    const h = health(reading, next, nowMs, o.configured);
    const send = o.send || require('./membership-notify').send;
    const who = o.recipients ? o.recipients : null;
    const mailbox = String(process.env.PFA_IMAP_USER || process.env.PFA_SMTP_USER || '').trim().toLowerCase();
    const panelUrl = require('./membership-notify').panelUrl();
    let sent = '';

    if (h.state === 'failing' || h.state === 'stale') {
      const due = next.alertState !== h.state || nowMs - msOf(next.alertedAt) >= REMIND_HOURS * 3600000;
      if (due) {
        const to = who || await recipients();
        const key = `replies_stuck:${h.state}:${nowIso.slice(0, 13)}`;
        for (const address of to) {
          await send({ template: 'replies_stuck', to: address, dedupeKey: `${key}:${address}`, claimBy: 'reply-watch',
            payload: { kind: h.state, error: h.error || '', since: h.since || '', failStreak: h.failStreak || 0, lastRunAt: h.lastRunAt || '', mailbox, panelUrl } });
        }
        next.alertState = h.state;
        next.alertedAt = nowIso;
        if (!next.troubleSince) next.troubleSince = h.since || nowIso;
        next.alertedTo = to;
        sent = 'alert';
      }
    } else if (next.alertState) {
      const to = who || (Array.isArray(next.alertedTo) && next.alertedTo.length ? next.alertedTo : await recipients());
      for (const address of to) {
        await send({ template: 'replies_working', to: address, dedupeKey: `replies_working:${nowIso.slice(0, 16)}:${address}`, claimBy: 'reply-watch',
          payload: { at: nowIso, since: next.troubleSince || '', mailbox, panelUrl } });
      }
      next.alertState = '';
      next.alertedAt = '';
      next.troubleSince = '';
      next.recoveredAt = nowIso;
      sent = 'recovered';
    }
    next.lastLookAt = nowIso;
    next.lastState = h.state;
    await watchRef.set(next);
    return { health: h, sent };
  } catch (error) {
    console.error('reply watch failed', String(error && error.message).slice(0, 300));
    return { error: String(error && error.message) };
  }
}

module.exports = { health, sentence, watch, recipients, configured, STATE, STALE_MINUTES, FAIL_RUNS, REMIND_HOURS };
