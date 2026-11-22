'use strict';
/* GET /api/signature?for=certificate|card[&builtin=svg]
   The finished signature picture a certificate or a card is drawn with
   (lib/signature-vault.js): the one chosen in the panel, in its colour, or,
   until one is chosen, the built-in signature. Only the finished picture,
   as the document shows it: never the signature's vector, which stays
   sealed. Letters are drawn on the server and do not come here. */
const firebase = require('../firebase');
const V = require('../signature-vault');

const BUILT_IN = '/assets/certificates/signature-print.png';
/* the cards online keep their built-in signature as a vector, sharp at any zoom */
const BUILT_IN_SVG = '/assets/certificates/signature.svg';
const PLACES = { certificate: 'certificate', card: 'card' };

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  return async function handler(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET');
      response.statusCode = 405;
      return response.end();
    }
    const q = request.query || {};
    const place = PLACES[String(q.for || '')];
    const builtIn = () => {
      response.statusCode = 302;
      response.setHeader('Location', q.builtin === 'svg' ? BUILT_IN_SVG : BUILT_IN);
      response.setHeader('Cache-Control', 'no-cache');
      return response.end();
    };
    if (!place) return builtIn();
    let pic = null;
    try { pic = await V.pictureFor(getDb(), place); } catch (error) { console.error('signature picture not read', error && error.message); }
    if (!pic) return builtIn();
    response.statusCode = 200;
    response.setHeader('Content-Type', 'image/png');
    /* a change in the panel shows within a minute */
    response.setHeader('Cache-Control', 'public, max-age=60');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.end(request.method === 'HEAD' ? undefined : pic.png);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
