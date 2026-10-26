'use strict';

/* Retired: self-service issuance.

   A card is not something a stranger can give themselves. The application is
   paid for, read by a named person at PFA, and the card is issued from the
   admin panel (lib/routes/admin/case.js, Approve), and nowhere else; the
   printed card is then posted (owner, 24 Oct 2026: "hope card wont be issued
   to the applicant without it being approved by the team at the back office.
   and only physical card will go to the applicant"). This endpoint stays so
   that anything still pointing at it gets an answer rather than a 404, and
   says where to go. The handler that used to issue a card here, kept below
   the answer as dead code until v1.461, is gone: there is no code path left
   in this file that can reach the register. */

const { setSecurityHeaders } = require('../../../lib/ccavenue');

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);

  return sendJson(response, 410, {
    code: 'APPLY_MOVED',
    message: 'Colony caregiver cards are no longer issued on the spot. Apply from the Get Involved page; '
      + 'the card is free, and the fifty-rupee charge is for postage only. It also gives you a number to track the application with.',
    where: '/get-involved.html#caregiver'
  });
};
