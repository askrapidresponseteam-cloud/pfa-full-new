'use strict';

/* GET  /api/visits          the footer's number: people who have visited
   POST /api/visits          the same (kept for pages a browser cached
                             before 11 Nov 2026; it no longer adds one)

   The number of people, each counted once (owner, 11 Nov 2026: "look at the
   count. why is there discrepancy. i need it to be accurate ... same person
   opened cannot count as unique", choosing "Unique visitors"). It is kept
   by /api/analytics, which adds one when a browser visits for the first
   time (lib/analytics.js, "Unique visitors"), so the footer and the panel's
   Analytics are one count, read the same way: bots, and browsers that ask
   not to be tracked, are in neither.

   Until 11 Nov 2026 this counted every browser session itself, bots and
   all, so a person coming back counted again and the footer ran far ahead
   of the panel (8158 against 3,264 visits in the panel's 30 days). That
   total is kept in counters/visits, unread; the count of people starts on
   the day it could first be told apart.

   The number is never invented. If Firestore is unreachable the endpoint
   says so and the footer stays silent rather than showing a made-up
   figure. */

const { getDb } = require('../firebase');

const DOC = 'counters/uniques';
const MAX_AGE = 20;        /* seconds the edge may serve a stale total */

function sendJson(response, statusCode, payload, cache) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache || 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  const method = String(request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST.' });
  }

  let db;
  try {
    db = getDb();
  } catch (error) {
    return sendJson(response, 503, { code: 'COUNTER_UNAVAILABLE', message: 'The counter is not available.' });
  }

  try {
    const snap = await db.doc(DOC).get();
    const total = snap.exists ? Number(snap.data().total) || 0 : 0;
    return sendJson(response, 200, { total }, method === 'POST'
      ? 'no-store'
      : `public, max-age=0, s-maxage=${MAX_AGE}, stale-while-revalidate=120`);
  } catch (error) {
    console.error('visit counter failed', { message: error && error.message });
    return sendJson(response, 503, { code: 'COUNTER_UNAVAILABLE', message: 'The counter is not available.' });
  }
};

module.exports._DOC = DOC;
