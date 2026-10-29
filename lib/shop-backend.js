'use strict';

/* Where shop orders live: the pfa-oldsite Firestore.

   Owner's instruction, 3 Oct 2026: orders from the shop go to the pfa-oldsite
   backend, the database its admin panel (pfa-oldsite.web.app) reads. Every
   other record this site keeps (donations, members, submissions) stays in
   pfa-new-website; pfa-oldsite is still retired for those, and
   scripts/firebase-project.js still refuses a pfa-oldsite key as the site's
   own server key. The shop holds a key of its own, under a name of its own,
   and this file refuses it if it belongs to any project but the one named.

   The order records are written in the shape the old site's checkout wrote
   them (PFAcurrent: api/store-checkout.js and api/_record-order.js), so the
   panel reads them unchanged:

     orders/{orderId}     written 'initiated' before the shopper is sent to
                          CCAvenue, completed 'paid' (or failed) by the callback
     stock/{id}__{size}   pieces left, reserved at checkout, returned when a
                          payment fails
     aggregates/store     orders and revenue, counted once per paid order

   No firebase-admin: this talks to the Firestore REST API with the service
   account, as the old site did, so it can sit beside the firebase-admin
   connection to pfa-new-website without the two ever sharing an app.

   Vercel environment:
     PFA_SHOP_FIREBASE_SERVICE_ACCOUNT  the pfa-oldsite service account JSON,
                                        or that JSON base64-encoded
     PFA_SHOP_FIREBASE_PROJECT          optional; defaults to pfa-oldsite

   Until that key is set, the shop does what donations do (owner, 3 Oct
   2026: "fix like money is taken in for donations"): it records its orders
   in this site's own Firestore, through the connection donations already use,
   under shopOrders, shopStock and shopTotals. Setting the key moves new
   orders to pfa-oldsite. A key that is set but belongs to another project is
   refused outright; the shop never falls back quietly from a wrong key.

   Either way, every order is also written to this site's transactions
   collection as type 'shop' (see ledger below), which is the register the
   admin panel's Payments tab reads. */

const crypto = require('crypto');
const SHOP = require('./shop');

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_PROJECT = 'pfa-oldsite';

function expectedProject() {
  return String(process.env.PFA_SHOP_FIREBASE_PROJECT || DEFAULT_PROJECT).trim();
}

function serviceAccount() {
  const raw = String(process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('Missing Vercel environment variable: PFA_SHOP_FIREBASE_SERVICE_ACCOUNT');
  let sa;
  try {
    sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch (_) {
    throw new Error('PFA_SHOP_FIREBASE_SERVICE_ACCOUNT is not a service account JSON.');
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('PFA_SHOP_FIREBASE_SERVICE_ACCOUNT is missing client_email, private_key or project_id.');
  }
  if (sa.project_id !== expectedProject()) {
    throw new Error(`PFA_SHOP_FIREBASE_SERVICE_ACCOUNT belongs to ${sa.project_id}, not ${expectedProject()}. Shop orders are only written to ${expectedProject()}.`);
  }
  return sa;
}

function isConfigured() {
  try { serviceAccount(); return true; } catch (_) { return false; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken = null;
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(String(sa.private_key).replace(/\\n/g, '\n')));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` })
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000, projectId: sa.project_id };
  return cachedToken;
}

/* ---- values to and from Firestore's typed REST form ---- */
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  const fields = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) fields[k] = encode(v);
  return { mapValue: { fields } };
}

function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) out[k] = decode(x);
    return out;
  }
  return null;
}

function fieldPath(...segments) {
  return segments.map((s) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : '`' + String(s).replace(/[`\\]/g, '\\$&') + '`')).join('.');
}

/* ---- the REST transport ---------------------------------------------------- */
async function call(path, init, timeoutMs) {
  const { token, projectId } = await accessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
  try {
    return { res: await fetch(`${base}${path}`, { ...init, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), projectId };
  } finally {
    clearTimeout(timer);
  }
}

const rest = {
  /* { data, updateTime } or null when the document does not exist. Throws when
     the database cannot be read, so a caller never mistakes an outage for an
     empty record. */
  async read(collection, id) {
    const { res } = await call(`/${collection}/${encodeURIComponent(id)}`, { method: 'GET' }, 6000);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore read ${res.status}`);
    const body = await res.json();
    const data = {};
    for (const [k, v] of Object.entries(body.fields || {})) data[k] = decode(v);
    return { data, updateTime: body.updateTime || '' };
  },

  /* Applies writes atomically. Each write is
       { set: [collection, id], data, ifUpdateTime?, mustNotExist? }
     or
       { increment: [collection, id], by: { path: n } }
     Resolves to { ok: true } or { ok: false, conflict, error }. */
  async commit(writes) {
    const { projectId } = await accessToken();
    const docs = `projects/${projectId}/databases/(default)/documents`;
    const body = {
      writes: writes.map((w) => {
        if (w.increment) {
          return { transform: { document: `${docs}/${w.increment[0]}/${w.increment[1]}`, fieldTransforms: Object.entries(w.by).map(([p, n]) => ({ fieldPath: p, increment: Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n } })) } };
        }
        const fields = {};
        for (const [k, v] of Object.entries(w.data)) if (v !== undefined) fields[k] = encode(v);
        const out = { update: { name: `${docs}/${w.set[0]}/${w.set[1]}`, fields }, updateMask: { fieldPaths: Object.keys(fields).map((k) => fieldPath(k)) } };
        if (w.ifUpdateTime) out.currentDocument = { updateTime: w.ifUpdateTime };
        else if (w.mustNotExist) out.currentDocument = { exists: false };
        return out;
      })
    };
    const { res } = await call(':commit', { method: 'POST', body: JSON.stringify(body) }, 8000);
    if (res.ok) return { ok: true };
    const text = (await res.text()).slice(0, 400);
    return { ok: false, conflict: res.status === 400 && /FAILED_PRECONDITION|ALREADY_EXISTS/.test(text) || res.status === 409, error: `Firestore commit ${res.status}: ${text}` };
  }
};

/* ---- this site's own Firestore, through the donations connection ---------- */
const SITE_COLLECTIONS = { orders: 'shopOrders', stock: 'shopStock', aggregates: 'shopTotals' };

function siteDb() {
  return require('./firebase').getDb();
}

function siteConfigured() {
  return require('./firebase').isConfigured();
}

const site = {
  name: 'pfa-new-website',
  async read(collection, id) {
    const snap = await siteDb().collection(SITE_COLLECTIONS[collection] || collection).doc(id).get();
    if (!snap.exists) return null;
    return { data: snap.data(), updateTime: snap.updateTime };
  },
  async commit(writes) {
    const db = siteDb();
    const { FieldValue } = require('firebase-admin/firestore');
    const batch = db.batch();
    for (const w of writes) {
      const [collection, id] = w.set || w.increment;
      const ref = db.collection(SITE_COLLECTIONS[collection] || collection).doc(id);
      if (w.increment) batch.set(ref, Object.fromEntries(Object.entries(w.by).map(([k, n]) => [k, FieldValue.increment(n)])), { merge: true });
      else if (w.mustNotExist) batch.create(ref, w.data);
      else if (w.ifUpdateTime) batch.update(ref, w.data, { lastUpdateTime: w.ifUpdateTime });
      else batch.set(ref, w.data, { merge: true });
    }
    try {
      await batch.commit();
      return { ok: true };
    } catch (error) {
      /* 5 NOT_FOUND, 6 ALREADY_EXISTS, 9 FAILED_PRECONDITION: someone else got
         there first, which the callers retry or read back. */
      return { ok: false, conflict: [5, 6, 9].includes(error && error.code), error: String((error && error.message) || error).slice(0, 300) };
    }
  }
};
rest.name = 'pfa-oldsite';

/* Which database takes the orders: pfa-oldsite when its key is set, this
   site's own otherwise. Throws a configuration error when neither can. */
function driver() {
  if (String(process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT || '').trim()) {
    serviceAccount();
    return rest;
  }
  if (siteConfigured()) return site;
  throw new Error('Missing Vercel environment variable: PFA_SHOP_FIREBASE_SERVICE_ACCOUNT (or the site Firebase key donations use)');
}

/* The tests swap the transport for an in-memory one; nothing else should. */
let override = null;
function use(next) { override = next || null; }
function current() { return override || driver(); }
function ready() { const d = current(); return d.name || 'memory'; }

/* ---- the ledger: the shop's line in the admin panel's Payments tab ---------

   transactions/{orderId} in this site's Firestore, in the shape
   lib/firebase.js gives a donation, with type 'shop'. Best effort: the order
   itself is already safe in the order store, so a ledger that cannot be
   written is logged and never stops a sale. */
const ledger = {
  async started(order, where) {
    try {
      const { serverTimestamp } = require('./firebase');
      const d = order.delivery || {};
      await siteDb().collection('transactions').doc(order.orderId).set({
        orderId: order.orderId,
        type: 'shop',
        amount: Number(order.total),
        currency: 'INR',
        status: 'initiated',
        source: 'pfa-website shop',
        customer: { name: order.customer.name, email: order.customer.email, mobile: order.customer.tel, address: d.address, city: d.city || '', district: d.district, state: d.state, pin: d.zip },
        metadata: {
          note: order.items.map((i) => SHOP.describe(i)).join('; '),
          items: order.items,
          orderStore: where
        },
        ccaVenue: { trackingId: null, bankReference: null, paymentMode: null, responseStatus: null },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('PFA shop ledger row not written', { orderId: order.orderId, message: String((error && error.message) || error).slice(0, 200) });
    }
  },
  async settled(order) {
    try {
      const { serverTimestamp } = require('./firebase');
      /* A payment that settled an order already cancelled, and found its
         stock gone, is flagged on the Payments line too (8 Oct 2026). */
      await siteDb().collection('transactions').doc(order.orderId).set(Object.assign({
        status: order.status === 'paid' ? 'success' : order.status,
        ccaVenue: { trackingId: order.trackingId || null, bankReference: order.bankRef || null, paymentMode: order.paymentMode || null, responseStatus: order.status, failureMessage: order.failureMessage || null },
        updatedAt: serverTimestamp()
      }, order.settledAfter ? { settledAfter: order.settledAfter, needsAttention: Boolean(order.needsAttention), attentionNote: order.attentionNote || '' } : {}), { merge: true });
    } catch (error) {
      console.error('PFA shop ledger row not updated', { orderId: order.orderId, message: String((error && error.message) || error).slice(0, 200) });
    }
  }
};

module.exports = {
  DEFAULT_PROJECT,
  expectedProject,
  isConfigured,
  serviceAccount,
  fieldPath,
  encode,
  decode,
  SITE_COLLECTIONS,
  read: (collection, id) => current().read(collection, id),
  commit: (writes) => current().commit(writes),
  ready,
  ledger,
  use
};
