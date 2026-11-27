'use strict';
/* GET /api/partners: Partners in giving (lib/partners.js), as a visitor may
   see them: published only, an amount only where it is to be shown. */
const firebase = require('../firebase');
const P = require('../partners');

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  return async function handler(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET');
      response.statusCode = 405;
      return response.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }));
    }
    let partners;
    try { partners = await P.publicList(getDb()); } catch (error) {
      console.error('partners not read', error && error.message);
      /* not "none": the page keeps what it was written with */
      response.statusCode = 503;
      response.setHeader('Cache-Control', 'no-store');
      return response.end(JSON.stringify({ ok: false, code: 'NOT_READ' }));
    }
    response.statusCode = 200;
    /* an amount switched off, or a partnership taken off, is gone for every
       visitor within seconds (review of 27 Nov 2026: it was two minutes) */
    response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5');
    return response.end(JSON.stringify({ ok: true, partners }));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
