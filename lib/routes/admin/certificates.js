'use strict';

/* GET  /api/admin/certificates                  issued internship certificates, newest first
   POST /api/admin/certificates { action: 'issue', name, startDate, endDate, issuedOn }
   POST /api/admin/certificates { action: 'revoke', number, reason }
   POST /api/admin/certificates { action: 'preview', number, email }
                                                 the email as it would go, and a preview token
   POST /api/admin/certificates { action: 'email', number, email, token, pdf }
                                                 the certificate, emailed to the person (logged)

   Internship certificates, made in the panel (owner, 31 Oct 2026: "this
   certificate should be admin generatable").

   Issuing gives the certificate its number: PFA-INT- and eight characters
   drawn at random from 32 letters and digits (no 0, 1, I or O), the same
   alphabet as the card numbers, so a number cannot be guessed from another
   or made up. The number, the name and the dates are kept in
   `certificates`, so a certificate can be drawn again exactly as issued,
   and checked. Revoking keeps the record and says why. The certificate
   itself is drawn in the panel (assets/certificate.js). Every issue and
   revoke is in the audit log.

   Sending it (owner, 2 Nov 2026: "once course is completed - admin should
   be able to issue the cert digitally which can be sent to the person
   completing it over email and there should be a publicy verifiable link
   that it is a genuine certificate"): the panel shows the email first
   (preview, with a token made from the email exactly as shown), then sends
   the certificate as the panel drew it, an A4 PDF. The PDF is kept with the
   certificate (lib/file-store.js), and the email carries it and the public
   check, /verify-certificate?n=<number> (lib/routes/verify-
   certificate.js), which anyone can open. A withdrawn certificate is never
   sent. */

const crypto = require('crypto');
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const RULES = require('../../../assets/field-rules.js');

const MODULE = 'certificates';
const COLLECTION = 'certificates';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NUMBER = /^PFA-INT-[A-HJ-NP-Z2-9]{8}$/;
/* the emailed PDF: the panel draws it at a size that fits a record either way */
const MAX_PDF = 720 * 1024;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

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
    /* the certificate PDF rides in the body, base64 */
    request.on('data', (c) => { raw += c; if (raw.length > 1200 * 1024) raw = raw.slice(0, 1200 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function newNumber() {
  let out = '';
  while (out.length < 8) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return `PFA-INT-${out}`;
}

function emailOf(value) {
  const v = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : '';
}

function siteUrl() {
  return String(process.env.PFA_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://peopleforanimalsindia.org').replace(/\/+$/, '');
}

function verifyUrl(number) {
  return `${siteUrl()}/verify-certificate?n=${encodeURIComponent(number)}`;
}

/* The letter, as it would go; the token is made from it exactly. */
function letterOf(number, c, to, who) {
  const payload = { name: c.name, number, startDate: c.startDate, endDate: c.endDate, issuedOn: c.issuedOn, verifyUrl: verifyUrl(number), siteUrl: siteUrl(), pdfName: `PFA-internship-certificate-${number}.pdf` };
  const r = require('../../caregiver-mail').render('internship_certificate', payload);
  const token = crypto.createHash('sha256').update(`${who.uid || who.email || ''}\u0000${number}\u0000${to}\u0000${r.subject}\u0000${r.text}`).digest('hex');
  return { payload, subject: r.subject, html: r.html, text: r.text, token };
}

/* A real calendar day, YYYY-MM-DD. */
function dayOf(value) {
  const v = clean(value, 10);
  const m = DAY.exec(v);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return '';
  if (Number(m[1]) < 2000 || Number(m[1]) > 2100) return '';
  return v;
}

/* India's date, for "issued on" when the panel does not say. */
function todayIst(nowMs) {
  return new Date(nowMs + 330 * 60000).toISOString().slice(0, 10);
}

/* What the panel sent, checked. Returns { ok, values } or { ok: false, field, message }. */
function checkIssue(body, nowMs) {
  const rawName = clean(body.name, 80);
  if (!rawName) return { ok: false, field: 'name', message: "Type the intern's name as it should read on the certificate." };
  const nameError = RULES.checkField('name', rawName, { required: true });
  if (nameError) return { ok: false, field: 'name', message: nameError };
  const name = RULES.normaliseField('name', rawName);
  if (name.length > 48) return { ok: false, field: 'name', message: 'Keep the name under 48 letters so it fits on the certificate.' };
  const startDate = dayOf(body.startDate);
  if (!startDate) return { ok: false, field: 'startDate', message: 'Choose the day the internship began.' };
  const endDate = dayOf(body.endDate);
  if (!endDate) return { ok: false, field: 'endDate', message: 'Choose the day the internship ended.' };
  if (endDate < startDate) return { ok: false, field: 'endDate', message: 'The internship cannot end before it began.' };
  const issuedOn = body.issuedOn ? dayOf(body.issuedOn) : todayIst(nowMs);
  if (!issuedOn) return { ok: false, field: 'issuedOn', message: 'Choose the date of issue.' };
  if (issuedOn < endDate) return { ok: false, field: 'issuedOn', message: 'A certificate is issued on or after the last day of the internship.' };
  const email = emailOf(body.email);
  if (body.email && String(body.email).trim() && !email) return { ok: false, field: 'email', message: 'That email does not look right.' };
  return { ok: true, values: Object.assign({ name, startDate, endDate, issuedOn }, email ? { email } : {}) };
}

function rowOf(id, c) {
  return {
    number: id,
    name: c.name || '',
    startDate: c.startDate || '',
    endDate: c.endDate || '',
    issuedOn: c.issuedOn || '',
    issuedAt: c.issuedAt || '',
    issuedBy: (c.issuedBy && (c.issuedBy.name || c.issuedBy.email)) || '',
    revoked: Boolean(c.revoked),
    revokedAt: c.revokedAt || '',
    revokedReason: c.revokedReason || '',
    email: c.email || '',
    sent: Array.isArray(c.sends) && c.sends.length ? c.sends[c.sends.length - 1] : null,
    verifyUrl: verifyUrl(id)
  };
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  const makeNumber = d.makeNumber || newNumber;

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, MODULE);
    if (who && request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    if (!who) return undefined;
    const by = { email: who.email || '', name: who.name || '' };
    try {
      const db = getDb();

      if (request.method === 'GET') {
        const snap = await db.collection(COLLECTION).get();
        const rows = snap.docs.map((doc) => rowOf(doc.id, doc.data() || {}))
          .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)) || b.number.localeCompare(a.number));
        return sendJson(response, 200, { ok: true, certificates: rows, today: todayIst(now()) });
      }

      const body = await readBody(request);
      const nowMs = now();
      const at = new Date(nowMs).toISOString();

      if (body.action === 'issue') {
        const checked = checkIssue(body, nowMs);
        if (!checked.ok) return sendJson(response, 422, { code: 'BAD_FIELD', field: checked.field, message: checked.message });
        /* a fresh number, never one already given */
        let number = '';
        let record = null;
        for (let tries = 0; tries < 8 && !record; tries += 1) {
          const candidate = makeNumber();
          if (!NUMBER.test(candidate)) continue;
          const doc = Object.assign({ number: candidate, kind: 'internship' }, checked.values, { issuedAt: at, issuedBy: by, revoked: false });
          try {
            await db.collection(COLLECTION).doc(candidate).create(doc);
            number = candidate;
            record = doc;
          } catch (error) {
            if (!/already exists|ALREADY_EXISTS|code 6/i.test(String((error && (error.message || error.code)) || ''))) throw error;
          }
        }
        if (!record) return sendJson(response, 503, { code: 'NO_NUMBER', message: 'A certificate number could not be given just now. Try again.' });
        await audit.record(who, { module: MODULE, action: 'certificate-issued', subject: number, detail: `${record.name}, ${record.startDate} to ${record.endDate}, issued on ${record.issuedOn}` }, request);
        return sendJson(response, 200, { ok: true, certificate: rowOf(number, record) });
      }

      if (body.action === 'revoke') {
        const number = clean(body.number, 20).toUpperCase();
        if (!NUMBER.test(number)) return sendJson(response, 400, { code: 'BAD_NUMBER', message: 'That is not a certificate number.' });
        const reason = clean(body.reason, 300);
        if (reason.length < 4) return sendJson(response, 422, { code: 'NO_REASON', field: 'reason', message: 'Say why the certificate is withdrawn.' });
        const ref = db.collection(COLLECTION).doc(number);
        const snap = await ref.get();
        if (!snap.exists) return sendJson(response, 404, { code: 'NO_CERTIFICATE', message: 'No certificate has that number.' });
        const c = snap.data() || {};
        if (c.revoked) return sendJson(response, 409, { code: 'ALREADY', message: 'That certificate is already withdrawn.' });
        const update = { revoked: true, revokedAt: at, revokedBy: by, revokedReason: reason };
        await ref.set(update, { merge: true });
        await audit.record(who, { module: MODULE, action: 'certificate-revoked', subject: number, detail: `${c.name}: ${reason}` }, request);
        return sendJson(response, 200, { ok: true, certificate: rowOf(number, Object.assign({}, c, update)) });
      }

      if (body.action === 'preview' || body.action === 'email') {
        const number = clean(body.number, 20).toUpperCase();
        if (!NUMBER.test(number)) return sendJson(response, 400, { code: 'BAD_NUMBER', message: 'That is not a certificate number.' });
        const ref = db.collection(COLLECTION).doc(number);
        const snap = await ref.get();
        if (!snap.exists) return sendJson(response, 404, { code: 'NO_CERTIFICATE', message: 'No certificate has that number.' });
        const c = snap.data() || {};
        if (c.revoked) return sendJson(response, 409, { code: 'WITHDRAWN', message: 'A withdrawn certificate is not sent.' });
        const to = emailOf(body.email || c.email);
        if (!to) return sendJson(response, 422, { code: 'BAD_FIELD', field: 'email', message: 'Type the email it goes to.' });
        const letter = letterOf(number, c, to, who);
        if (body.action === 'preview') return sendJson(response, 200, { ok: true, to, subject: letter.subject, html: letter.html, token: letter.token, verifyUrl: letter.payload.verifyUrl });
        if (String(body.token || '') !== letter.token) return sendJson(response, 409, { code: 'PREVIEW_STALE', message: 'Something changed since the preview. Look at it again, then send.' });
        let pdf = null;
        try { pdf = Buffer.from(String(body.pdf || ''), 'base64'); } catch (_) { pdf = null; }
        if (!pdf || pdf.length < 1000 || pdf.subarray(0, 5).toString() !== '%PDF-') return sendJson(response, 422, { code: 'NO_PDF', message: 'The certificate PDF did not come through. Try again.' });
        if (pdf.length > MAX_PDF) return sendJson(response, 413, { code: 'PDF_TOO_LARGE', message: 'The certificate PDF is too large to send.' });
        const pdfSha = crypto.createHash('sha256').update(pdf).digest('hex');
        const kept = await require('../../file-store').put(`certificates/${number}.pdf`, pdf, 'application/pdf');
        await ref.set({ email: to, pdf: Object.assign({ size: pdf.length, sha256: pdfSha }, kept) }, { merge: true });
        const store = d.queue || require('../../caregiver-store');
        const mail = d.mail || require('../../caregiver-mail');
        const configured = mail.isConfigured();
        const queued = await store.queueEmail({ template: 'internship_certificate', to, payload: letter.payload, dedupeKey: `${number}:${letter.token.slice(0, 16)}:${pdfSha.slice(0, 12)}`, claim: configured ? 'certificates' : undefined });
        let state = queued.created ? 'queued' : (queued.status === 'sent' ? 'sent' : 'queued');
        let reason = configured ? '' : 'Email is not set up on the server; it is queued.';
        if (queued.created && configured) {
          try {
            const sent = await mail.deliver({ to, template: 'internship_certificate', payload: letter.payload });
            await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
            state = 'sent';
          } catch (error) {
            await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
            reason = 'Not sent just now; it will be tried again.';
          }
        }
        if (queued.created) {
          const sends = (Array.isArray(c.sends) ? c.sends.slice(-19) : []).concat([{ at, by: by.email || by.name || '', to, state, emailId: queued.emailId }]);
          await ref.set({ sends }, { merge: true });
        }
        await audit.record(who, { module: MODULE, action: 'certificate-emailed', subject: number, detail: `${c.name}, to ${to}: ${state}` }, request);
        return sendJson(response, 200, { ok: true, state, reason, to, verifyUrl: letter.payload.verifyUrl });
      }

      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      console.error('certificates failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Nothing was changed.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { checkIssue, dayOf, newNumber, rowOf, todayIst, NUMBER, verifyUrl, letterOf };
module.exports.COLLECTION = COLLECTION;
