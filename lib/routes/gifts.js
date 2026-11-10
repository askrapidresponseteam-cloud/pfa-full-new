/* GET /api/gifts -> { ok, today, season, next }

   What gifts.html shows (lib/gift-seasons.js): the season on today, India
   time, with its offers and collections, or null; and the next season that
   is scheduled, or null. Public and the same for everyone, so the edge keeps
   it half a minute and serves it a minute longer while it fetches again: a
   season set live in the panel, or one whose first day has come, is on the
   page within about half a minute.

   It fails quietly. If the seasons cannot be read the answer says so, the
   edge keeps that only a moment, and the page shows its year-round gifts. */

'use strict';

const G = require('../gift-seasons');

const FRESH = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';
const FAILED = 'public, max-age=0, s-maxage=3';

module.exports = async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.setHeader('Cache-Control', 'no-store');
    return response.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }));
  }
  const answer = await G.publicAnswer();
  response.statusCode = 200;
  response.setHeader('Cache-Control', answer.unavailable ? FAILED : FRESH);
  return response.end(request.method === 'HEAD' ? '' : JSON.stringify(answer));
};

module.exports._private = { FRESH, FAILED };
