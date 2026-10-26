'use strict';

/* Sending the membership card's letters (lib/caregiver-mail.js member_*).

   The same discipline as every other email the site sends: the letter is
   queued first, under a key that makes a second press or a retried request
   the same letter, so it survives a mail outage and the email worker sends
   it later; then it is sent now, so that "emailed" is true when the panel
   says it. A copy lands in info@'s Sent folder through deliver() itself. */

const firebase = require('./firebase');
const store = require('./caregiver-store');
const mail = require('./caregiver-mail');

const DEFAULT_SITE = 'https://peopleforanimalsindia.org';
const DEFAULT_PANEL = 'https://pfa-new-website.web.app/admin.html';

function originOf(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) ? url.origin : '';
  } catch (_) {
    return '';
  }
}

/* Where members are sent: the public site, which serves the photo page.
   PFA_PUBLIC_SITE_URL names it; PUBLIC_SITE_URL is this deployment's own
   address (on Firebase, the panel's), so it is the second choice only. */
function publicSite() {
  return originOf(process.env.PFA_PUBLIC_SITE_URL) || DEFAULT_SITE;
}

function panelUrl() {
  const named = String(process.env.PFA_PANEL_URL || '').trim();
  return originOf(named) ? named : DEFAULT_PANEL;
}

function photoLink(token) {
  return `${publicSite()}/member-photo.html#t=${encodeURIComponent(token)}`;
}

/* scrub: once the letter has gone, the queued copy's link is blanked, so the
   only place a live photo link is kept in full is the member's inbox. A
   letter that could not go keeps it, for the worker to send. */
async function scrubLink(emailId) {
  try {
    await firebase.getDb().collection('caregiverEmails').doc(emailId).set({ payload: { uploadUrl: '' }, linkScrubbedAt: new Date().toISOString() }, { merge: true });
  } catch (error) {
    console.warn('membership letter: link not scrubbed from the queue', error && error.message);
  }
}

/* Resolves to { sent, queued, reason }. Never throws: a letter that could
   not go now is retried by the worker, and the caller says so. */
async function send({ template, to, payload, dedupeKey, claimBy, scrub }) {
  try {
    const configured = mail.isConfigured();
    const queued = await store.queueEmail({ template, to, payload, dedupeKey, claim: configured ? (claimBy || 'membership') : undefined });
    if (!queued.created) return { sent: queued.status === 'sent', queued: true, reason: queued.status === 'sent' ? '' : 'already queued' };
    if (!configured) return { sent: false, queued: true, reason: 'Email is not set up on the server; the letter is queued.' };
    try {
      const result = await mail.deliver({ to, template, payload });
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: result && result.providerId });
      if (scrub) await scrubLink(queued.emailId);
      return { sent: true, queued: true, reason: '' };
    } catch (error) {
      await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
      return { sent: false, queued: true, reason: `Not sent just now (${String((error && error.message) || error).slice(0, 120)}); it will be retried.` };
    }
  } catch (error) {
    console.error('membership letter not queued', template, error && error.message);
    return { sent: false, queued: false, reason: 'The letter could not be queued.' };
  }
}

module.exports = { send, publicSite, panelUrl, photoLink, originOf };
