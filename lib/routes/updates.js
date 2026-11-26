'use strict';
/* GET /api/updates: "From PFA", the news and notices written in the panel
   (lib/site-updates.js), newest first, the pinned one ahead of the rest.
   Also says whether a live show is on (lib/live-show.js), so the home strip
   can say "Live now" without a second request. */
const firebase = require('../firebase');
const U = require('../site-updates');
const Live = require('../live-show');

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
    let updates = [];
    let live = null;
    try {
      const db = getDb();
      const [u, l] = await Promise.all([U.publicList(db), Live.headline(db).catch(() => null)]);
      updates = u; live = l;
    } catch (error) { console.error('updates not read', error && error.message); }
    response.statusCode = 200;
    /* a new update reaches every visitor within two minutes */
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=90');
    return response.end(JSON.stringify({ updates, live }));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
