'use strict';

/* GET  /api/admin/certificates                  issued internship certificates, newest first
   POST /api/admin/certificates { action: 'issue', name, startDate, endDate, issuedOn }
   POST /api/admin/certificates { action: 'revoke', number, reason }

   Internship certificates, made in the panel (owner, 31 Oct 2026: "this
   certificate should be admin generatable").

   Issuing gives the certificate its number: PFA-INT- and eight characters
   drawn at random from 32 letters and digits (no 0, 1, I or O), the same
   alphabet as the card numbers, so a number cannot be guessed from another
   or made up. The number, the name and the dates are kept in
   `certificates`, so a certificate can be drawn again exactly as issued,
   and checked. Revoking keeps the record and says why. The certificate
   itself is drawn in the panel (assets/certificate.js); nothing is sent to
   anyone from here. Every issue and revoke is in the audit log. */

const crypto = require('crypto');
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const RULES = require('../../../assets/field-rules.js');

const MODULE = 'certificates';
const COLLECTION = 'certificates';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NUMBER = /^PFA-INT-[A-HJ-NP-Z2-9]{8}$/;
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
    request.on('data', (c) => { raw += c; if (raw.length > 16 * 1024) raw = raw.slice(0, 16 * 1024); });
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
  return { ok: true, values: { name, startDate, endDate, issuedOn } };
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
    revokedReason: c.revokedReason || ''
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

      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      console.error('certificates failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Nothing was changed.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { checkIssue, dayOf, newNumber, rowOf, todayIst, NUMBER };
