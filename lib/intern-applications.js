'use strict';

/* Internship applications, one per person (owner, 7 Nov 2026: "if person had
   not provided whatever needs to go in for login, ask for those to be
   submitted through the form. and the application has to be merged. cant
   have 2 applications for same person- same email id means same person.").

   An intern signs in with three details: email, mobile number and date of
   birth (lib/intern-store.js signInWith). So an application can be approved
   only when it carries all three.

   One application per email. The internship form sent again with an email
   already on an application is not filed under a new number: it is added to
   that application as `resent`, in the order it came, and the newest value
   of each detail is the one that counts. What the person wrote the first
   time is never written over (test/submissions.test.js), and the panel shows
   every time they sent it.

   When something is missing, PFA asks for it from the panel: the person is
   emailed to fill in the form again with the same email, and what they send
   lands on the same application. */

const I = require('./internship');
const TEST = require('./test-data');

const KIND = 'PFA-VI';
const DEAD = new Set(['removed', 'spam']);
const MAX_RESENT = 20;

function pick(fields, re) {
  const f = fields || {};
  const k = Object.keys(f).find((x) => re.test(x));
  return k ? I.clean(f[k], 160) : '';
}

/* The details one sending carried, as the form names them. */
function detailsOf(fields, nowMs) {
  return {
    name: pick(fields, /^(name|full ?name)$/i),
    email: pick(fields, /^e-?mail$/i),
    mobile: pick(fields, /^(mobile|phone|whatsapp)$/i),
    dob: I.dobOf(pick(fields, /^(dob|date ?of ?birth|birth ?date)$/i), nowMs),
    age: pick(fields, /^age$/i),
    city: pick(fields, /^(city|district|town)$/i)
  };
}

/* An application as it stands: the first sending, then each one after it,
   a later value taking the place of an earlier one only when it is there. */
function applicantOf(a, nowMs = Date.now()) {
  const out = detailsOf(a && a.fields, nowMs);
  for (const again of (a && a.resent) || []) {
    const d = detailsOf(again && again.fields, nowMs);
    for (const key of Object.keys(out)) if (d[key]) out[key] = d[key];
  }
  return Object.assign(out, {
    reference: a.reference, status: a.status || 'new', createdAt: a.createdAt || '',
    sentTimes: 1 + ((a && a.resent) || []).length,
    missing: missingOf(out),
    askedAt: (a && a.detailsAskedAt) || ''
  });
}

/* What sign-in needs that the application does not have, in words. */
function missingOf(p) {
  const out = [];
  if (!I.emailOf(p.email)) out.push('email address');
  if (!I.mobileOf(p.mobile)) out.push('10-digit mobile number');
  if (!p.dob) out.push('date of birth');
  return out;
}
function listOf(words) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* Every live internship application, oldest first. */
async function all(db) {
  const snap = await db.collection('submissions').where('kind', '==', KIND).get();
  return (snap.docs || []).map((doc) => Object.assign({ reference: doc.id }, doc.data() || {}))
    .filter((a) => !DEAD.has(a.status) && !TEST.isTest(a))
    .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)) || String(x.reference).localeCompare(String(y.reference)));
}

/* The application this email already has, or null. */
async function forEmail(db, email, nowMs = Date.now()) {
  const want = I.emailOf(email);
  if (!want) return null;
  return (await all(db)).find((a) => I.emailOf(applicantOf(a, nowMs).email) === want) || null;
}

/* The form sent again: added to the application, in one transaction with the
   request's own key, so a double press adds it once. Returns null when this
   email has no application yet (the caller files a new one), or the
   application's reference and the record as it now stands. */
async function addTo(db, { fields, page, nowMs, dedupe, claimFor }) {
  const earlier = await forEmail(db, fields && Object.keys(fields).length ? detailsOf(fields, nowMs).email : '', nowMs);
  if (!earlier) return null;
  const ref = db.collection('submissions').doc(earlier.reference);
  const at = new Date(nowMs).toISOString();
  return db.runTransaction(async (tx) => {
    const seen = dedupe ? await tx.get(dedupe) : null;
    const claim = seen && seen.exists ? seen.data() : null;
    if (claim && claim.reference) return { replay: true, claim };
    const snap = await tx.get(ref);
    const now = snap.exists ? snap.data() || {} : null;
    if (!now) return null;
    const resent = (now.resent || []).concat([{ at, page: I.clean(page, 120), fields }]).slice(-MAX_RESENT);
    const p = applicantOf(Object.assign({ reference: earlier.reference }, now, { resent }), nowMs);
    const note = `Sent the internship form again, so it was added to this application, not filed as a new one.${p.missing.length ? ` Still missing for sign-in: ${listOf(p.missing)}.` : ' It now has all three details they sign in with.'}`;
    const history = (now.history || []).concat([{ status: now.status || 'new', at, note }]);
    tx.update(ref, { resent, history, lastSentAt: at });
    if (dedupe) tx.set(dedupe, claimFor(earlier.reference));
    return { replay: false, reference: earlier.reference, record: Object.assign({}, now, { reference: earlier.reference, resent, history, fields: Object.assign({}, now.fields, fields), createdAt: at, attachments: 0, followUp: `again-${resent.length}` }) };
  });
}

/* PFA asks for what is missing: the email (lib/caregiver-mail.js
   intern_details_needed) and a line in the application's history. */
async function askFor(db, reference, by, nowMs = Date.now(), deps = {}) {
  const ref = db.collection('submissions').doc(String(reference || '').toUpperCase());
  const snap = await ref.get();
  const a = snap.exists ? Object.assign({ reference: ref.id }, snap.data()) : null;
  if (!a || a.kind !== KIND) throw fail('NO_APPLICATION', 'That internship application is not on record.', 404);
  const p = applicantOf(a, nowMs);
  if (!p.missing.length) throw fail('NOTHING_MISSING', 'This application has all three sign-in details. Approve it.', 409);
  const to = I.emailOf(p.email);
  if (!to) throw fail('NO_EMAIL', `There is no email address on ${a.reference} to write to. Call them on ${p.mobile || 'the number they gave'} and ask them to fill in the internship form again.`, 409);
  const at = new Date(nowMs).toISOString();
  const send = deps.mailNow || require('./intern-store').mailNow;
  const mailed = await send({
    template: 'intern_details_needed', to, dedupeKey: `${a.reference}:details:${at.slice(0, 10)}`,
    payload: { name: p.name, reference: a.reference, missing: p.missing, formUrl: `${require('./intern-store').publicSite()}/internship.html`, siteUrl: require('./intern-store').publicSite() },
    mail: deps.mail, queue: deps.queue
  });
  const history = (a.history || []).concat([{ status: a.status || 'new', at, by, note: `Asked them for their ${listOf(p.missing)}, by email to ${to}: they fill in the internship form again with the same email, and it is added here.` }]);
  await ref.update({ history, detailsAskedAt: at });
  return { reference: a.reference, missing: p.missing, to, mailed: mailed.sent ? 'sent' : mailed.queued ? 'queued' : 'not-sent' };
}

function fail(code, message, status) { return require('./intern-store').fail(code, message, status); }

module.exports = { KIND, detailsOf, applicantOf, missingOf, listOf, all, forEmail, addTo, askFor };
