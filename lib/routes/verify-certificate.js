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

const NUMBER = /^PFA-INT-[A-HJ-NP-Z2-9]{8}$/;

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
    if (!NUMBER.test(number)) {
      return sendJson(response, 400, { code: 'INVALID_NUMBER', message: 'That is not a PFA certificate number. They look like PFA-INT-XXXXXXXX.' });
    }
    try {
      const snap = await getDb().collection('certificates').doc(number).get();
      if (!snap.exists) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'PFA has not issued a certificate with that number.' });
      const c = snap.data() || {};
      return sendJson(response, 200, {
        found: true,
        genuine: !c.revoked,
        number,
        kind: 'Internship',
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

module.exports = createHandler();
module.exports.createHandler = createHandler;
