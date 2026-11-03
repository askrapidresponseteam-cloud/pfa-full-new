'use strict';

/* POST /api/analytics    one page view, from assets/chrome.js
   { p: page path, n: 1 on a visit's first page, r: referrer, us/uc: the
   utm_source and utm_campaign of the address, w: screen width } or, for a
   script that failed, { p, e: message }.

   Answers 204 whatever happens: a visitor's page never waits on, or learns
   anything from, the count. What is kept and why: lib/analytics.js. */

const A = require('../analytics');
const { getDb, fieldValue } = require('../firebase');
const { clientIp } = require('../client-ip');

const COLLECTION = 'analytics_days';
const MAX_BODY = 4096;
/* a browser opens a few pages a minute; a script that posts hundreds is not
   a visitor. Per server instance, which is enough to blunt a flood. */
const PER_MINUTE = 60;
const seen = new Map();
function flooding(ip, nowMs) {
  if (!ip) return false;
  if (seen.size > 5000) seen.clear();
  const s = seen.get(ip);
  if (!s || nowMs - s.at > 60000) { seen.set(ip, { at: nowMs, n: 1 }); return false; }
  s.n += 1;
  return s.n > PER_MINUTE;
}

function done(response, status) {
  response.statusCode = status || 204;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end();
}

function bodyOf(request) {
  const b = request.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return Promise.resolve(b);
  if (typeof b === 'string' || Buffer.isBuffer(b)) { try { return Promise.resolve(JSON.parse(String(b).slice(0, MAX_BODY))); } catch (_) { return Promise.resolve(null); } }
  if (b === null || request.readableEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => { if (raw.length < MAX_BODY) raw += c; });
    request.on('end', () => { try { resolve(JSON.parse(raw)); } catch (_) { resolve(null); } });
    request.on('error', () => resolve(null));
  });
}

module.exports = async function handler(request, response, deps) {
  const o = deps || {};
  if (String(request.method || '').toUpperCase() !== 'POST') {
    response.setHeader('Allow', 'POST');
    return done(response, 405);
  }
  const nowMs = o.now ? o.now() : Date.now();
  if (flooding(clientIp(request), nowMs)) return done(response);
  const hit = A.readHit(await bodyOf(request), request.headers || {}, nowMs);
  if (!hit) return done(response);
  try {
    const db = o.getDb ? o.getDb() : getDb();
    const inc = (n) => fieldValue().increment(n);
    const w = A.writesFor(hit, inc);
    const col = db.collection(COLLECTION);
    const jobs = [col.doc(hit.day).set(w.main, { merge: true })];
    if (w.campaigns) jobs.push(col.doc(`${hit.day}_campaigns`).set(w.campaigns, { merge: true }));
    if (w.errors) jobs.push(col.doc(`${hit.day}_errors`).set(w.errors, { merge: true }));
    await Promise.all(jobs);
  } catch (error) {
    console.error('analytics: not counted', { message: error && error.message });
  }
  return done(response);
};

module.exports.COLLECTION = COLLECTION;
module.exports._reset = () => seen.clear();
