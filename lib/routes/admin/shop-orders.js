'use strict';

/* GET  /api/admin/shop-orders                          paid shop orders, newest first, and how far each has got
   GET  /api/admin/shop-orders?preview=<order number>    the shipping email as the customer would see it
   POST /api/admin/shop-orders { action: 'ship', orderId, courier, trackingNumber, trackingUrl }
   POST /api/admin/shop-orders { action: 'notify', orderId }   the shipping email to the customer

   Shop orders, a section of their own (owner, 28 Oct 2026: "let shop orders
   be one sep thing on the left and admin should have option to change the
   status to order shipped. and enter details of courier- which onces saved -
   will have option to trigger email in the pfa template to the person who
   ordered - the standard tracking id and details. and a ecom style amazing
   message").

   The list is the shop's line in the payments register (transactions, type
   'shop', lib/shop-backend.js ledger), paid orders only. Shipping is two
   steps, as asked:
     1. ship: the courier, its tracking number and, if there is one, the
        courier's tracking link are saved. The order is marked shipped on the
        payments line, in the order store the pfa-oldsite panel reads, and as
        a line on the order's case. Saving again corrects them; every saving
        is kept in shipmentHistory.
     2. notify: the customer is sent shop_order_shipped (lib/caregiver-mail.js)
        with those details, once per tracking number. It continues the
        order's conversation, so their reply is kept on the order.
   Both are in the audit log. Nothing here takes or returns money. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const backend = require('../../shop-backend');
const SHOP = require('../../shop');
const NOTIFY = require('../../membership-notify');
const mail = require('../../caregiver-mail');
const CASE = require('./case');

const ORDER_ID = /^PFA-SHP-[A-Z0-9]{8}$/;
const TRACKING = /^[A-Z0-9-]{4,40}$/;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) raw = raw.slice(0, 64 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function isoOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return '';
}

function courierOf(value) {
  const c = clean(value, 60);
  return c.length >= 2 ? c : '';
}
function trackingOf(value) {
  const t = String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase().slice(0, 60);
  return TRACKING.test(t) ? t : '';
}
function linkOf(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { ok: true, url: '' };
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || raw.length > 500) return { ok: false };
    return { ok: true, url: u.toString() };
  } catch (_) {
    return { ok: false };
  }
}

/* One paid order as the list shows it. */
function rowOf(id, t) {
  const c = t.customer || {};
  const items = Array.isArray((t.metadata || {}).items) ? t.metadata.items : [];
  const s = t.shipment || null;
  const e = t.shippedEmail || null;
  return {
    orderId: id,
    at: isoOf(t.createdAt) || isoOf(t.updatedAt),
    name: clean(c.name, 120),
    email: clean(c.email, 160),
    mobile: clean(c.mobile, 20),
    place: [clean(c.address, 200), clean(c.district, 60), [clean(c.state, 40), clean(c.pin, 10)].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    items: items.map((i) => SHOP.describe(i)),
    total: Number(t.amount) || 0,
    needsAttention: Boolean(t.needsAttention),
    attentionNote: t.attentionNote || '',
    stage: s ? 'shipped' : 'to-ship',
    shipment: s ? { courier: s.courier || '', trackingNumber: s.trackingNumber || '', trackingUrl: s.trackingUrl || '', shippedAt: s.shippedAt || '', by: s.by || null } : null,
    shippedEmail: e ? { state: e.state || '', to: e.to || '', at: e.at || '', trackingNumber: e.trackingNumber || '', reason: e.reason || '' } : null
  };
}

async function paidOrders(db) {
  const snap = await db.collection('transactions').where('type', '==', 'shop').get();
  return snap.docs.map((d) => [d.id, d.data() || {}])
    .filter(([, t]) => String(t.status || '') === 'success')
    .map(([id, t]) => rowOf(id, t))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.orderId.localeCompare(a.orderId));
}

/* What the shipping email carries: the order as the store holds it (the
   delivery name, town and mobile are there, not on the payments line), with
   the payments line to fall back on. */
async function emailPayload(id, t, threadId) {
  let order = null;
  try { const doc = await backend.read('orders', id); order = doc ? doc.data : null; } catch (_) { /* the payments line will do */ }
  const c = t.customer || {};
  const s = t.shipment || {};
  const delivery = (order && order.delivery) || { name: c.name, address: c.address, district: c.district, state: c.state, zip: c.pin, tel: c.mobile };
  return {
    reference: id, orderId: id, threadId: threadId || '',
    name: clean((order && order.customer && order.customer.name) || c.name, 120),
    email: clean((order && order.customer && order.customer.email) || c.email, 160).toLowerCase(),
    items: (order && Array.isArray(order.items) && order.items.length) ? order.items : ((t.metadata || {}).items || []),
    delivery,
    paidAt: (order && order.paidAt) || isoOf(t.updatedAt) || '',
    courier: s.courier || '', trackingNumber: s.trackingNumber || '', trackingUrl: s.trackingUrl || '', shippedAt: s.shippedAt || '',
    siteUrl: NOTIFY.publicSite()
  };
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const send = d.send || NOTIFY.send;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, 'shop');
    if (who && request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    if (!who) return undefined;
    const by = { email: who.email || '', name: who.name || '' };
    try {
      const db = getDb();
      const query = request.query || {};

      if (request.method === 'GET' && query.preview) {
        const id = String(query.preview).toUpperCase();
        if (!ORDER_ID.test(id)) return sendJson(response, 400, { code: 'BAD_ORDER', message: 'That is not a shop order number.' });
        const snap = await db.collection('transactions').doc(id).get();
        if (!snap.exists) return sendJson(response, 404, { code: 'NO_ORDER', message: 'No such order.' });
        const t = snap.data() || {};
        if (!t.shipment) return sendJson(response, 409, { code: 'NOT_SHIPPED', message: 'Save the courier and tracking number first.' });
        const { threadId } = await CASE.shopCase(db, id);
        const r = mail.render('shop_order_shipped', await emailPayload(id, t, threadId));
        return sendJson(response, 200, { ok: true, subject: r.subject, html: r.html });
      }

      if (request.method === 'GET') {
        const orders = await paidOrders(db);
        return sendJson(response, 200, {
          ok: true, orders,
          counts: { toShip: orders.filter((o) => o.stage === 'to-ship').length, shipped: orders.filter((o) => o.stage === 'shipped').length, all: orders.length },
          mailOn: mail.isConfigured()
        });
      }

      const body = await readBody(request);
      const id = String(body.orderId || '').trim().toUpperCase();
      if (!ORDER_ID.test(id)) return sendJson(response, 400, { code: 'BAD_ORDER', message: 'That is not a shop order number.' });
      const ref = db.collection('transactions').doc(id);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() || {}).type !== 'shop') return sendJson(response, 404, { code: 'NO_ORDER', message: 'No such order.' });
      const t = snap.data() || {};
      if (String(t.status || '') !== 'success') return sendJson(response, 409, { code: 'NOT_PAID', message: 'Only a paid order can be shipped.' });
      const at = new Date(now()).toISOString();

      if (body.action === 'ship') {
        const courier = courierOf(body.courier);
        if (!courier) return sendJson(response, 422, { code: 'NO_COURIER', field: 'courier', message: 'Type the courier, for example India Post or Blue Dart.' });
        const trackingNumber = trackingOf(body.trackingNumber);
        if (!trackingNumber) return sendJson(response, 422, { code: 'NO_TRACKING', field: 'trackingNumber', message: 'Type the tracking number: 4 to 40 letters and numbers.' });
        const link = linkOf(body.trackingUrl);
        if (!link.ok) return sendJson(response, 422, { code: 'BAD_LINK', field: 'trackingUrl', message: 'The tracking link should start with https://, or leave it empty.' });
        const before = t.shipment || null;
        const shipment = { courier, trackingNumber, trackingUrl: link.url, shippedAt: (before && before.shippedAt) || at, savedAt: at, by };
        const history = Array.isArray(t.shipmentHistory) ? t.shipmentHistory.slice(-19) : [];
        history.push(shipment);
        await ref.set({ fulfilment: 'shipped', shipment, shipmentHistory: history, updatedAt: at }, { merge: true });
        /* the order store the pfa-oldsite panel reads: best effort, the
           payments line already holds it */
        let store = 'updated';
        try {
          const done = await backend.commit([{ set: ['orders', id], data: { fulfilment: 'shipped', shipment: { courier, trackingNumber, trackingUrl: link.url, shippedAt: shipment.shippedAt }, shippedAt: shipment.shippedAt } }]);
          if (!done.ok) store = 'not updated';
        } catch (_) { store = 'not updated'; }
        const changed = before ? `Corrected: ${courier}, tracking number ${trackingNumber} (was ${before.courier}, ${before.trackingNumber}).` : `Shipped by ${courier}, tracking number ${trackingNumber}.`;
        try { await CASE.shopNote(db, firebase.fieldValue, id, { at, by: by.email, event: before ? 'shipment-corrected' : 'shipped', text: changed + (link.url ? ` Tracking link: ${link.url}` : ''), detail: { courier, trackingNumber } }); } catch (_) { /* the order is marked either way */ }
        await audit.record(who, { module: 'shop', action: before ? 'shop-shipment-corrected' : 'shop-shipped', subject: id, detail: changed }, request);
        const emailedThis = Boolean(t.shippedEmail && t.shippedEmail.state === 'sent' && t.shippedEmail.trackingNumber === trackingNumber);
        return sendJson(response, 200, { ok: true, order: rowOf(id, Object.assign({}, t, { shipment, shipmentHistory: history })), store, emailedThis });
      }

      if (body.action === 'notify') {
        if (!t.shipment) return sendJson(response, 409, { code: 'NOT_SHIPPED', message: 'Save the courier and tracking number first.' });
        const { threadId } = await CASE.shopCase(db, id);
        const payload = await emailPayload(id, t, threadId);
        if (!payload.email) return sendJson(response, 422, { code: 'NO_EMAIL', message: 'This order has no email address to write to.' });
        const sent = await send({ template: 'shop_order_shipped', to: payload.email, dedupeKey: `shop_order_shipped:${id}:${payload.trackingNumber}`, claimBy: 'panel', payload });
        const state = sent.sent ? 'sent' : sent.queued ? 'queued' : 'unsent';
        const shippedEmail = { state, to: payload.email, at, by, trackingNumber: payload.trackingNumber, reason: sent.reason || '' };
        await ref.set({ shippedEmail, updatedAt: at }, { merge: true });
        try { await CASE.shopNote(db, firebase.fieldValue, id, { at, by: by.email, event: 'shipped-email', text: `Shipping email ${state === 'sent' ? 'sent' : state === 'queued' ? 'queued' : 'not sent'} to ${payload.email}: ${payload.courier}, tracking number ${payload.trackingNumber}.`, detail: { to: payload.email, state } }); } catch (_) { /* recorded on the order either way */ }
        await audit.record(who, { module: 'shop', action: 'shop-shipped-email', subject: id, detail: `To ${payload.email} (${state}): ${payload.courier} ${payload.trackingNumber}`, outcome: state === 'unsent' ? 'refused' : 'done' }, request);
        return sendJson(response, 200, { ok: true, order: rowOf(id, Object.assign({}, t, { shippedEmail })), emailed: state === 'sent', mailNote: state === 'sent' ? '' : (sent.reason || 'The email is queued and will go shortly.') });
      }

      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      console.error('shop orders failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Nothing was changed.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { rowOf, courierOf, trackingOf, linkOf, paidOrders, emailPayload };
