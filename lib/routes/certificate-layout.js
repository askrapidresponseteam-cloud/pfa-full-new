/* GET /api/certificate-layout -> { x, y, cards: { caregiver: { x, y }, member: { x, y } } }

   Where the signature sits on the internship certificate (lib/certificate-
   layout.js), for every page that draws one. Public and the same for
   everyone, so the edge keeps it a minute; a change in the panel reaches a
   certificate drawn after that. If the setting cannot be read the answer is
   the design's own position, kept only a moment. */

'use strict';

const L = require('../certificate-layout');

module.exports = async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.setHeader('Cache-Control', 'no-store');
    return response.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }));
  }
  let body;
  let cache = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
  try {
    const db = require('../firebase').getDb();
    const l = await L.read(db);
    const cards = await L.readCards(db);
    /* and the two cards' (15 Nov 2026), for the panel's card studios */
    const only = {};
    Object.keys(L.CARDS).forEach((c) => { only[c] = { x: cards[c].x, y: cards[c].y, s: cards[c].s }; });
    body = { x: l.x, y: l.y, s: l.s, cards: only };
  } catch (error) {
    console.warn('certificate layout could not be read; the design’s own', (error && error.message) || error);
    const only = {};
    Object.keys(L.CARDS).forEach((c) => { only[c] = Object.assign({}, L.CARD_DEFAULT); });
    body = Object.assign({}, L.DEFAULT, { cards: only, unavailable: true });
    cache = 'public, max-age=0, s-maxage=2';
  }
  response.statusCode = 200;
  response.setHeader('Cache-Control', cache);
  return response.end(request.method === 'HEAD' ? '' : JSON.stringify(body));
};
