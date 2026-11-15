'use strict';

/* GET /api/digital-card?id=PFA-CCT-XXXXXXXX | PFA-MBR-XXXXXXXX
       -> what the digital card prints, and whether it is valid today
   GET /api/digital-card?id=...&photo=1
       -> the photograph on it

   The page card.html draws the card from this (lib/digital-cards.js). The
   holder shares the link; anyone with it sees what the card shows and that
   PFA issued it. A withdrawn card says so and shows no photograph. */

const DC = require('../digital-cards');

function sendJson(response, status, body, cache) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache || 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}
function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || (() => require('../firebase').getDb());
  const now = d.now || (() => Date.now());
  return async function handler(request, response) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    const q = queryOf(request);
    const id = String(q.id || '').replace(/\s+/g, '').toUpperCase();
    if (!DC.ID.test(id)) return sendJson(response, 400, { code: 'INVALID_ID', message: 'That is not a PFA card address. They look like PFA-CCT-XXXXXXXX or PFA-MBR-XXXXXXXX.' });
    try {
      const card = await DC.read(getDb(), id);
      if (!card) return sendJson(response, 404, { code: 'NOT_FOUND', found: false, message: 'PFA has not issued a digital card with that number.' }, 'public, max-age=0, s-maxage=30');
      const view = DC.publicView(id, card, now());
      if (String(q.photo || '') === '1') {
        if (!view.photo) return sendJson(response, 404, { code: 'NO_PHOTO' });
        const bytes = await require('../file-store').read(card.photo);
        if (!bytes) return sendJson(response, 404, { code: 'NO_PHOTO' });
        response.statusCode = 200;
        response.setHeader('Content-Type', card.photo.contentType === 'image/png' ? 'image/png' : 'image/jpeg');
        response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        return response.end(bytes);
      }
      /* where the signature sits on this kind of card online, as the
         panel set it (15 Nov 2026) */
      let sig = { x: 0, y: 0 };
      try { sig = (await require('../certificate-layout').readCards(getDb()))[view.kind === 'member' ? 'memberOnline' : 'caregiverOnline']; } catch (_) { /* its own place */ }
      view.sig = { x: Number(sig.x) || 0, y: Number(sig.y) || 0, s: Number(sig.s) || 100 };
      return sendJson(response, 200, view, 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    } catch (error) {
      console.error('digital card not read', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The card could not be opened just now. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
