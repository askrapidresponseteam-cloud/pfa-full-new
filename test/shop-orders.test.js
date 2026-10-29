'use strict';

/* Shop orders, a section of their own (owner, 28 Oct 2026): "let shop
   orders be one sep thing on the left and admin should have option to
   change the status to order shipped. and enter details of courier- which
   onces saved - will have option to trigger email in the pfa template to the
   person who ordered - the standard tracking id and details. and a ecom
   style amazing message". */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const backend = require('../lib/shop-backend');
const mailer = require('../lib/caregiver-mail');
const M = require('../lib/admin-modules');
const ROUTE = require('../lib/routes/admin/shop-orders');

const ROOT = path.join(__dirname, '..');
const ID = 'PFA-SHP-ZX81QW22';
const ITEM = { id: '23', name: 'Sabyasachi x PFA', size: 'L', qty: 1, price: 2500, lineTotal: 2500 };
let db; let store; let sent; let auditRows;

test.beforeEach(async () => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  store = { orders: { [ID]: { orderId: ID, status: 'paid', paidAt: '2026-10-26T10:00:00.000Z', customer: { name: 'Asha Rao', email: 'asha@example.com' }, items: [ITEM], delivery: { name: 'Asha Rao', address: 'Flat 4, FC Road', city: 'Pune', district: 'Pune', state: 'Maharashtra', zip: '411004', tel: '9876543210' }, total: 2500 } } };
  backend.use({
    name: 'memory',
    async read(c, id) { return store[c] && store[c][id] ? { data: store[c][id], updateTime: 'x' } : null; },
    async commit(writes) { for (const w of writes) { const [c, id] = w.set; store[c] = store[c] || {}; store[c][id] = Object.assign({}, store[c][id], w.data); } return { ok: true }; }
  });
  const base = { type: 'shop', amount: 2500, currency: 'INR', customer: { name: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', address: 'Flat 4, FC Road', district: 'Pune', state: 'Maharashtra', pin: '411004' }, metadata: { items: [ITEM] } };
  await db.collection('transactions').doc(ID).set(Object.assign({}, base, { status: 'success', createdAt: '2026-10-26T09:55:00.000Z' }));
  await db.collection('transactions').doc('PFA-SHP-AAAAAAAA').set(Object.assign({}, base, { status: 'initiated', createdAt: '2026-10-27T09:55:00.000Z' }));
  await db.collection('transactions').doc('PFA-DON-AAAAAAAA').set({ type: 'donate', status: 'success', amount: 500 });
  await db.collection('submissions').doc(ID).set({ reference: ID, kind: 'PFA-SHP', status: 'new', threadId: 'abcdefabcdef', history: [], createdAt: '2026-10-26T10:00:00.000Z' });
  sent = [];
  auditRows = [];
  require('../lib/admin-audit').record = async (who, row) => { auditRows.push(row); };
});
test.afterEach(() => { backend.use(null); firebase._setDbForTests(null); });

function handler() {
  return ROUTE.createHandler({
    getDb: () => db,
    requireAdmin: async () => ({ uid: 'u1', email: 'office@pfa.test', name: 'Office', role: 'super' }),
    send: async (m) => { sent.push(m); return { sent: true, queued: true, reason: '' }; },
    now: () => Date.parse('2026-10-28T10:00:00.000Z')
  });
}
function call(method, { body, query } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200 };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {},
      end(raw) { out.json = JSON.parse(String(raw || '{}')); resolve(out); } };
    Promise.resolve(handler()({ method, url: '/api/admin/shop-orders', query: query || {}, body, headers: {} }, response)).catch(reject);
  });
}

test('a section of its own: paid orders only, newest first, with how many are to ship', async () => {
  assert.ok(M.MODULE_KEYS.includes('shop'));
  const r = await call('GET');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json.orders.map((o) => o.orderId), [ID], 'not the unpaid one, not a donation');
  assert.deepEqual(r.json.counts, { toShip: 1, shipped: 0, all: 1 });
  const o = r.json.orders[0];
  assert.equal(o.stage, 'to-ship');
  assert.deepEqual(o.items, ['1 x Sabyasachi x PFA, size L']);
  assert.match(o.place, /Flat 4, FC Road, Pune, Maharashtra 411004/);
});

test('marked shipped with the courier and tracking number, everywhere the order is kept; then the customer is emailed', async () => {
  assert.equal((await call('POST', { body: { action: 'notify', orderId: ID } })).json.code, 'NOT_SHIPPED', 'no email before the details are saved');
  assert.equal((await call('POST', { body: { action: 'ship', orderId: ID, courier: '', trackingNumber: 'BD12345678' } })).json.field, 'courier');
  assert.equal((await call('POST', { body: { action: 'ship', orderId: ID, courier: 'Blue Dart', trackingNumber: 'x' } })).json.field, 'trackingNumber');
  assert.equal((await call('POST', { body: { action: 'ship', orderId: ID, courier: 'Blue Dart', trackingNumber: 'BD12345678', trackingUrl: 'javascript:alert(1)' } })).json.field, 'trackingUrl');
  assert.equal((await call('POST', { body: { action: 'ship', orderId: 'PFA-SHP-AAAAAAAA', courier: 'Blue Dart', trackingNumber: 'BD12345678' } })).json.code, 'NOT_PAID');

  const ship = await call('POST', { body: { action: 'ship', orderId: ID, courier: 'Blue Dart', trackingNumber: 'bd 1234 5678', trackingUrl: 'https://www.bluedart.com/track?n=BD12345678' } });
  assert.equal(ship.statusCode, 200, JSON.stringify(ship.json));
  assert.equal(ship.json.order.stage, 'shipped');
  assert.equal(ship.json.order.shipment.trackingNumber, 'BD12345678', 'spaces gone, capitals');
  const t = db.dump()[`transactions/${ID}`];
  assert.equal(t.fulfilment, 'shipped');
  assert.equal(t.status, 'success', 'the payment itself is untouched');
  assert.equal(store.orders[ID].fulfilment, 'shipped', 'the order store the old shop panel reads');
  assert.equal(store.orders[ID].shipment.courier, 'Blue Dart');
  const notes = Object.entries(db.dump()).filter(([k]) => k.startsWith(`submissions/${ID}/messages/`)).map(([, v]) => v.text);
  assert.ok(notes.some((n) => /Shipped by Blue Dart, tracking number BD12345678/.test(n)), 'a line on the order\'s case');
  assert.ok(auditRows.some((a) => a.action === 'shop-shipped'));
  assert.equal(sent.length, 0, 'saving does not email: that is its own step');

  const mail = await call('POST', { body: { action: 'notify', orderId: ID } });
  assert.equal(mail.json.emailed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].template, 'shop_order_shipped');
  assert.equal(sent[0].to, 'asha@example.com');
  assert.equal(sent[0].dedupeKey, `shop_order_shipped:${ID}:BD12345678`);
  assert.equal(sent[0].payload.threadId, 'abcdefabcdef', 'it continues the order\'s conversation');
  assert.equal(sent[0].payload.delivery.city, 'Pune', 'the delivery as the order store holds it');
  assert.equal(db.dump()[`transactions/${ID}`].shippedEmail.state, 'sent');
  const list = await call('GET');
  assert.deepEqual(list.json.counts, { toShip: 0, shipped: 1, all: 1 });

  /* corrected: kept in the history, and the new number can be emailed */
  const again = await call('POST', { body: { action: 'ship', orderId: ID, courier: 'Blue Dart', trackingNumber: 'BD99990000' } });
  assert.equal(again.json.emailedThis, false);
  assert.equal(db.dump()[`transactions/${ID}`].shipmentHistory.length, 2);
  assert.ok(auditRows.some((a) => a.action === 'shop-shipment-corrected'));
});

test('the email: the PFA letter, a tracker, the tracking number big, the courier\'s link, and a reply comes back to the order', async () => {
  await call('POST', { body: { action: 'ship', orderId: ID, courier: 'Blue Dart', trackingNumber: 'BD12345678', trackingUrl: 'https://www.bluedart.com/track?n=BD12345678' } });
  const p = await call('GET', { query: { preview: ID } });
  assert.equal(p.statusCode, 200);
  assert.equal(p.json.subject, 'Asha, your PFA order is on its way - Blue Dart BD12345678');
  const h = p.json.html;
  for (const want of ['It’s on its way.', 'Ordered', 'Shipped', 'Delivered', 'On its way', 'BD12345678', 'Blue Dart', 'Track your parcel', 'https://www.bluedart.com/track?n=BD12345678', 'Sabyasachi x PFA, size L', 'Flat 4, FC Road', 'every purchase supports PFA']) {
    assert.ok(h.includes(want.replace('&', '&amp;')) || h.includes(want), want);
  }
  const r = mailer.render('shop_order_shipped', { reference: ID, orderId: ID, threadId: 'abcdefabcdef', name: 'Asha Rao', courier: 'India Post', trackingNumber: 'EE1', shippedAt: '2026-10-28T10:00:00Z' });
  assert.equal(r.gateway, true, 'replies come to the site and are kept on the order');
  assert.match(r.messageId, /^<PFA-SHP-ZX81QW22\.abcdefabcdef\.shipped@/);
  assert.match(r.inReplyTo, /\.confirm@/);
  assert.match(r.text, /Track it on India Post's website or app/);
});

test('the panel: Shop orders on the left, off the Submissions register, staged and with a preview', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /<button class="tab" type="button" data-tab="payments">Payments &amp; donations<\/button>\n\s*<button class="tab" type="button" data-tab="shop">Shop orders<span class="pip" id="pipShop" hidden>0<\/span><\/button>/);
  assert.match(html, /shop:\s+\{ title: 'Shop orders',\s+module: 'shop',\s+needs: 'shop' \}/);
  assert.match(html, /act = '<button class="press" type="button" data-so="ship">Mark shipped<\/button>'/);
  assert.match(html, /Email ' \+ esc\(next\.name \|\| 'the customer'\) \+ ' the tracking details now\?/);
  assert.match(html, /<iframe id="soPreviewFrame" title="The shipping email, as the customer will see it" sandbox=""><\/iframe>/);
  assert.ok(require('../lib/submissions').OFF_REGISTER.has('PFA-SHP'));
  const { ROUTES } = require('../api/index.js')._private;
  assert.ok(ROUTES['admin/shop-orders']);
});
