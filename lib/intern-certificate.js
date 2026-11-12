'use strict';

/* The internship certificate, issued by itself when the internship is done
   (owner, 11 Nov 2026: "once one completes, this is automatically sent with
   the person's name. and this should be like one of those coursera certs
   that can be seen live online in a url").

   Called after any task is accepted: by PFA in the panel (lib/intern-
   store.js, review) or by the law quiz (lib/intern-quiz.js). When that makes
   the intern's required work complete (lib/internship.js, progressOf), and
   only then, a certificate is issued once:

     the number   PFA-INT- and eight characters at random, as the panel's
                  are (lib/routes/admin/certificates.js), never one given
     the name     as the intern gave it, tidied as every name on the site is
     the dates    from the day their internship began (the batch's first
                  day, or the day PFA approved them if that was later) to
                  the day it was completed, in India
     issued on    the day it was completed

   kept in `certificates` with the intern's ID and email, beside the ones
   PFA issues by hand, and marked on the intern so it is never issued
   twice, however many reviews land at once (one transaction holds both).
   Then it is emailed to them: the live certificate's address
   (/certificate?n=<number>, certificate.html), where it can be seen,
   downloaded as a PDF and shared, and the public check. Every issue is in
   the audit log, as made automatically.

   Never throws: a certificate that cannot be issued just now is issued by
   the next acceptance, or by PFA from the panel, and the review that called
   this is not undone. */

const crypto = require('crypto');
const I = require('./internship');

const COLLECTION = 'certificates';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NUMBER = /^PFA-INT-[A-HJ-NP-Z2-9]{8}$/;
const AUTOMATIC = { email: '', name: 'Automatic, on completion' };

function newNumber() {
  let out = '';
  while (out.length < 8) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return `PFA-INT-${out}`;
}

/* Where a certificate lives: the public site, always (owner, 12 Nov 2026:
   "we cant expose the firebase admin site url to people"). PFA_PUBLIC_SITE_URL
   if it is set to a real address, otherwise peopleforanimalsindia.org.
   Never a Firebase host, which is the panel's (lib/public-site.js). */
const PUBLIC_SITE = require('./public-site').DEFAULT_SITE;
function siteUrl() { return require('./public-site').publicSite(); }
function certificateUrl(number) { return `${siteUrl()}/certificate?n=${encodeURIComponent(number)}`; }
function verifyUrl(number) { return `${siteUrl()}/verify-certificate?n=${encodeURIComponent(number)}`; }

/* India's date, YYYY-MM-DD */
function dayIst(ms) { return new Date(Number(ms) + 330 * 60000).toISOString().slice(0, 10); }

function nameOf(intern) {
  const RULES = require('../assets/field-rules.js');
  const raw = String((intern && intern.name) || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  try { return RULES.normaliseField('name', raw) || raw; } catch (_) { return raw; }
}

/* What goes on it, or null when the work is not complete. */
async function whatIfComplete(db, intern, nowMs, S) {
  const batch = await S.getBatch(db, intern.batchId);
  if (!batch) return null;
  const works = await S.listWorks(db, intern.internId);
  const p = I.progressOf(batch, intern, works, null);
  if (!p.complete) return null;
  const today = dayIst(nowMs);
  const approved = /^\d{4}-\d{2}-\d{2}/.test(String(intern.approvedAt || '')) ? dayIst(Date.parse(intern.approvedAt)) : '';
  let startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(batch.startDate || '')) ? batch.startDate : (approved || today);
  if (approved && approved > startDate) startDate = approved;
  if (startDate > today) startDate = today;
  return { name: nameOf(intern), startDate, endDate: today, issuedOn: today };
}

async function issueIfComplete(db, internId, nowMs = Date.now(), deps = {}) {
  try {
    const S = deps.store || require('./intern-store');
    const intern = await S.getIntern(db, internId);
    if (!intern || intern.status === 'revoked' || intern.status === 'reserving') return { issued: false, why: 'no-intern' };
    if (intern.certificateNumber) return { issued: false, why: 'already', number: intern.certificateNumber };
    const facts = await whatIfComplete(db, intern, nowMs, S);
    if (!facts) return { issued: false, why: 'not-complete' };
    if (!facts.name) return { issued: false, why: 'no-name' };
    const email = String(intern.email || '').trim().toLowerCase();
    const at = new Date(nowMs).toISOString();
    const internRef = db.collection('interns').doc(intern.internId);
    const make = deps.makeNumber || newNumber;

    let issued = null;
    for (let tries = 0; tries < 6 && !issued; tries += 1) {
      const number = make();
      if (!NUMBER.test(number)) continue;
      const doc = Object.assign({ number, kind: 'internship' }, facts, {
        email, internId: intern.internId, batchId: intern.batchId || '', auto: true,
        issuedAt: at, issuedBy: AUTOMATIC, revoked: false
      });
      try {
        issued = await db.runTransaction(async (tx) => {
          const now = await tx.get(internRef);
          const had = now.exists ? (now.data() || {}).certificateNumber : '';
          if (had) return { number: had, already: true };
          const taken = await tx.get(db.collection(COLLECTION).doc(number));
          if (taken.exists) return null;
          tx.set(db.collection(COLLECTION).doc(number), doc);
          tx.set(internRef, { certificateNumber: number, certificateAt: at }, { merge: true });
          return { number, doc };
        });
      } catch (error) {
        if (!/already exists|ALREADY_EXISTS|code 6/i.test(String((error && (error.message || error.code)) || ''))) throw error;
        issued = null;
      }
    }
    if (!issued) return { issued: false, why: 'no-number' };
    if (issued.already) return { issued: false, why: 'already', number: issued.number };

    const { number, doc } = issued;
    const audit = deps.audit || require('./admin-audit');
    await audit.record(AUTOMATIC, { module: 'certificates', action: 'certificate-issued', subject: number, detail: `${doc.name}, ${doc.startDate} to ${doc.endDate}, issued on ${doc.issuedOn}, automatically when ${intern.internId} completed the internship` });

    let mailed = { sent: false, queued: false };
    if (email) {
      const payload = {
        name: doc.name, number, startDate: doc.startDate, endDate: doc.endDate, issuedOn: doc.issuedOn,
        certificateUrl: certificateUrl(number), verifyUrl: verifyUrl(number), siteUrl: siteUrl(), attached: false
      };
      mailed = await S.mailNow({ template: 'internship_certificate', to: email, payload, dedupeKey: `${number}:auto`, mail: deps.mail, queue: deps.queue });
      const state = mailed.sent ? 'sent' : 'queued';
      await db.collection(COLLECTION).doc(number).set({ sends: [{ at, by: AUTOMATIC.name, to: email, state, emailId: mailed.emailId || '' }] }, { merge: true });
      await audit.record(AUTOMATIC, { module: 'certificates', action: 'certificate-emailed', subject: number, detail: `${doc.name}, to ${email}: ${state}` });
    }
    return { issued: true, number, mailed };
  } catch (error) {
    console.warn('internship certificate not issued automatically', internId, error && error.message);
    return { issued: false, why: 'error' };
  }
}

module.exports = { issueIfComplete, certificateUrl, verifyUrl, siteUrl, PUBLIC_SITE, newNumber, dayIst, NUMBER, AUTOMATIC };
