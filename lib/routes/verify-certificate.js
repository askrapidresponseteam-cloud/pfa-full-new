'use strict';

/* GET /api/verify-certificate?n=PFA-INT-XXXXXXXX

   Is this PFA internship certificate genuine? (owner, 2 Nov 2026: "there
   should be a publicy verifiable link that it is a genuine certificate").
   Anyone holding the number (it is printed on the certificate, and the
   email carries the link) can ask, without signing in. The answer is what a
   college or an employer needs and nothing more: the name on it, the
   internship's dates, the day it was issued, and whether PFA has since
   withdrawn it (with the day, not the reason). Never the email or anything
   else on the record. Numbers are eight characters from 32 at random, so
   one cannot be guessed from another. */

const firebase = require('../firebase');
const LETTERS = require('../letters');

/* every purpose's number: PFA-INT-, PFA-VOL-, PFA-PAR-, PFA-REC-, PFA-DNR-
   (lib/certificate-kinds.js, 15 Nov 2026) */
const KINDS = require('../certificate-kinds');
const NUMBER = KINDS.NUMBER;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const long = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  return async function handler(request, response) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const q = queryOf(request);
    const number = String(q.n || q.number || '').replace(/\s+/g, '').toUpperCase();
    /* A letter on PFA's letterhead (owner, 20 Nov 2026: "link should just shw
       to who the letter has been issued, when and for what. not the actual
       letter"): those three and whether it still stands. Never the letter,
       the address, an amount or an email. */
    if (LETTERS.NUMBER.test(number)) return letterAnswer(getDb, number, response);
    if (!NUMBER.test(number)) {
      return sendJson(response, 400, { code: 'INVALID_NUMBER', message: 'That is not a PFA certificate number. They look like PFA-INT-XXXXXXXX: PFA, three letters, and eight letters and digits.' });
    }
    try {
      const snap = await getDb().collection('certificates').doc(number).get();
      if (!snap.exists) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'PFA has not issued a certificate with that number.' });
      const c = snap.data() || {};
      const kind = KINDS.kindOf(c.kind) || KINDS.kindOfNumber(number);
      const line = KINDS.lineOf(Object.assign({}, c, { kind }));
      const day = KINDS.dayPrinted(Object.assign({}, c, { kind }));
      return sendJson(response, 200, {
        found: true,
        genuine: !c.revoked,
        number,
        /* what it is for, in a line a college, an employer or a school reads */
        kind,
        kindLabel: KINDS.KINDS[kind].label,
        title: KINDS.titleOf(kind),
        about: kind === 'internship' ? `Remote Internship, from ${long(c.startDate)} to ${long(c.endDate)}` : `${line}${day ? `, ${long(day)}` : ''}`,
        line: kind === 'internship' ? '' : line,
        date: String(c.date || ''),
        colour: KINDS.colourOf(c.colour) || KINDS.KINDS[kind].colour,
        name: String(c.name || ''),
        startDate: String(c.startDate || ''),
        endDate: String(c.endDate || ''),
        issuedOn: String(c.issuedOn || ''),
        withdrawn: Boolean(c.revoked),
        withdrawnOn: c.revoked ? String(c.revokedAt || '').slice(0, 10) : ''
      });
    } catch (error) {
      console.error('verify-certificate failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be checked just now. Try again.' });
    }
  };
}

const istDay = (iso) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t + 330 * 60000).toISOString().slice(0, 10) : ''; };
const sentence = (v) => { const t = String(v || '').trim(); return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

async function letterAnswer(getDb, number, response) {
  try {
    const snap = await getDb().collection('letters').doc(number).get();
    if (!snap.exists) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'PFA has not issued a letter with that reference.' });
    const l = snap.data() || {};
    const kindLabel = (LETTERS.TEMPLATES[l.kind] || {}).label || 'Letter';
    const subject = sentence(l.subject);
    return sendJson(response, 200, {
      found: true,
      letter: true,
      genuine: !l.withdrawn,
      number,
      kindLabel,
      /* what it is for: its subject, when that says more than what it is */
      about: subject && subject.toLowerCase() !== kindLabel.toLowerCase() ? subject : '',
      name: LETTERS.rowOf(snap.id, l).name,
      issuedOn: istDay(l.issuedAt),
      withdrawn: Boolean(l.withdrawn),
      withdrawnOn: l.withdrawn ? istDay(l.withdrawnAt) : ''
    });
  } catch (error) {
    console.error('verify-letter failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be checked just now. Try again.' });
  }
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
