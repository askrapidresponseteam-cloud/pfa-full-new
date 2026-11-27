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
    let partners = [];
    try { partners = await P.publicList(getDb()); } catch (error) { console.error('partners not read', error && error.message); }
    response.statusCode = 200;
    /* a change in the panel reaches every visitor within two minutes */
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=90');
    return response.end(JSON.stringify({ partners }));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
