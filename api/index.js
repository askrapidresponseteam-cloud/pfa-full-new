'use strict';

// Single Vercel function that serves every /api/* route (see vercel.json rewrites).
// Vercel Hobby allows 12 Serverless Functions per deployment; the 23 handlers
// now live in lib/routes and are required lazily, so only the module for the
// requested route is loaded per invocation. Public URLs are unchanged.

const ROUTES = {
  'admin/attachment': './admin/attachment.js',
  'admin/cards': './admin/cards.js',
  'admin/case': './admin/case.js',
  'admin/mail-check': './admin/mail-check.js',
  'admin/metrics': './admin/metrics.js',
  'admin/payments-pending': './admin/payments-pending.js',
  'admin/people': './admin/people.js',
  'admin/records': './admin/records.js',
  'admin/search': './admin/search.js',
  'admin/site': './admin/site.js',
  'admin/staff': './admin/staff.js',
  'admin/submission-status': './admin/submission-status.js',
  'admin/test-data': './admin/test-data.js',
  'caregiver/admin-shipment': './caregiver/admin-shipment.js',
  'caregiver/apply': './caregiver/apply.js',
  'caregiver/card': './caregiver/card.js',
  'caregiver/documents': './caregiver/documents.js',
  'caregiver/email-worker': './caregiver/email-worker.js',
  'caregiver/order': './caregiver/order.js',
  'caregiver/replace': './caregiver/replace.js',
  'inbound-mail': './inbound-mail.js',
  'location-lookup': './location-lookup.js',
  'payment/create': './payment/create.js',
  'payment/health': './payment/health.js',
  'payment/response': './payment/response.js',
  'pfa-submissions': './pfa-submissions.js',
  'shop/checkout': './shop/checkout.js',
  'shop/response': './shop/response.js',
  'visits': './visits.js',
  'wall': './wall.js',
  'field-notes': './field-notes.js',
  'field-note-photo': './field-note-photo.js',
  'search-popular': './search-popular.js',
  'site-visibility': './site-visibility.js',
  'photo/remove-background': './photo/remove-background.js',
  'verify-card': './verify-card.js',
};

// Static requires so Vercel's file tracer bundles every handler.
const LOADERS = {
  'admin/attachment': () => require('../lib/routes/admin/attachment.js'),
  'admin/cards': () => require('../lib/routes/admin/cards.js'),
  'admin/case': () => require('../lib/routes/admin/case.js'),
  'admin/mail-check': () => require('../lib/routes/admin/mail-check.js'),
  'admin/metrics': () => require('../lib/routes/admin/metrics.js'),
  'admin/payments-pending': () => require('../lib/routes/admin/payments-pending.js'),
  'admin/people': () => require('../lib/routes/admin/people.js'),
  'admin/records': () => require('../lib/routes/admin/records.js'),
  'admin/search': () => require('../lib/routes/admin/search.js'),
  'admin/site': () => require('../lib/routes/admin/site.js'),
  'admin/staff': () => require('../lib/routes/admin/staff.js'),
  'admin/submission-status': () => require('../lib/routes/admin/submission-status.js'),
  'admin/test-data': () => require('../lib/routes/admin/test-data.js'),
  'caregiver/admin-shipment': () => require('../lib/routes/caregiver/admin-shipment.js'),
  'caregiver/apply': () => require('../lib/routes/caregiver/apply.js'),
  'caregiver/card': () => require('../lib/routes/caregiver/card.js'),
  'caregiver/documents': () => require('../lib/routes/caregiver/documents.js'),
  'caregiver/email-worker': () => require('../lib/routes/caregiver/email-worker.js'),
  'caregiver/order': () => require('../lib/routes/caregiver/order.js'),
  'caregiver/replace': () => require('../lib/routes/caregiver/replace.js'),
  'inbound-mail': () => require('../lib/routes/inbound-mail.js'),
  'location-lookup': () => require('../lib/routes/location-lookup.js'),
  'payment/create': () => require('../lib/routes/payment/create.js'),
  'payment/health': () => require('../lib/routes/payment/health.js'),
  'payment/response': () => require('../lib/routes/payment/response.js'),
  'pfa-submissions': () => require('../lib/routes/pfa-submissions.js'),
  'shop/checkout': () => require('../lib/routes/shop/checkout.js'),
  'shop/response': () => require('../lib/routes/shop/response.js'),
  'visits': () => require('../lib/routes/visits.js'),
  'wall': () => require('../lib/routes/wall.js'),
  'field-notes': () => require('../lib/routes/field-notes.js'),
  'field-note-photo': () => require('../lib/routes/field-note-photo.js'),
  'search-popular': () => require('../lib/routes/search-popular.js'),
  'site-visibility': () => require('../lib/routes/site-visibility.js'),
  'photo/remove-background': () => require('../lib/routes/photo/remove-background.js'),
  'verify-card': () => require('../lib/routes/verify-card.js'),
};

function routeKey(request) {
  // vercel.json rewrites /api/<anything> here with ?__route=<anything>.
  const q = request.query || {};
  const rewritten = q.__route;
  if (Array.isArray(rewritten) && rewritten.length) return rewritten.join('/');
  if (typeof rewritten === 'string' && rewritten) return rewritten.replace(/^\/+|\/+$/g, '');
  const segments = q.path;
  if (Array.isArray(segments) && segments.length) return segments.join('/');
  if (typeof segments === 'string' && segments) return segments;
  try {
    const pathname = new URL(request.url, 'https://pfa.local').pathname;
    return pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

module.exports = async function handler(request, response) {
  const key = routeKey(request);
  // hasOwnProperty, not LOADERS[key]: a plain object answers for every name on
  // Object.prototype, so /api/constructor and /api/__proto__ used to find a
  // "handler" that was not one and throw, where every other unknown route
  // returns the JSON 404 below.
  const load = Object.prototype.hasOwnProperty.call(LOADERS, key) ? LOADERS[key] : null;
  if (!load) {
    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Unknown API route.' }));
  }
  // Remove the catch-all segment so handlers see the same query they always did.
  if (request.query && typeof request.query === 'object') { delete request.query.path; delete request.query.__route; }
  // Handlers that parse request.url themselves must not see the routing param.
  if (typeof request.url === 'string' && request.url.includes('__route=')) {
    const u = new URL(request.url, 'https://pfa.local');
    u.searchParams.delete('__route');
    request.url = u.pathname + (u.search || '');
  }
  return load()(request, response);
};

module.exports._private = { routeKey, ROUTES };
