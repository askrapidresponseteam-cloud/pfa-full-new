'use strict';
/* GET /api/chat-taught: what PFA has taught the site's chat (lib/chat-learn.js),
   for every visitor's chat to say before the site's own text. Only what a
   person at PFA wrote: the question, its other wordings, the answer and a
   page of the site. */
const firebase = require('../firebase');
const L = require('../chat-learn');

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
    let taught = [];
    try { taught = await L.publicList(getDb()); } catch (error) { console.error('chat taught not read', error && error.message); }
    response.statusCode = 200;
    /* an answer taught in the panel reaches the chat within five minutes */
    response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return response.end(JSON.stringify({ taught }));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
