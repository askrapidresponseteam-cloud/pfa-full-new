'use strict';

/* The PFA shop: prices come from lib/shop.js and nowhere else, orders are
   written to the pfa-oldsite backend before any payment starts, and the
   CCAvenue answer settles an order once, whatever arrives twice. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHOP = require('../lib/shop');
const backend = require('../lib/shop-backend');
const C = require('../lib/ccavenue');

const KEY = 'TESTWORKINGKEY0123456789ABCDEF00';
const SHOPPER = { name: 'Meera Shah', mobile: '9876543210', email: 'meera@example.com', address: 'Flat 4, Shanti Niwas, FC Road', state: 'Maharashtra', district: 'Pune', pincode: '411004' };

function env() {
  process.env.CCAVENUE_MERCHANT_ID = '123456';
  process.env.CCAVENUE_ACCESS_CODE = 'AVTEST';
  process.env.CCAVENUE_WORKING_KEY = KEY;
  process.env.PUBLIC_SITE_URL = 'https://peopleforanimalsindia.org';
  process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'pfa-oldsite', client_email: 's@pfa-oldsite.iam.gserviceaccount.com', private_key: 'x' });
  delete process.env.PFA_SHOP_FIREBASE_PROJECT;
  delete process.env.PFA_MAIL_API_KEY;
  delete process.env.PFA_SHOP_ORDERS_EMAIL;
}

/* Firestore as the shop uses it, with update times and preconditions. */
function memory() {
  const docs = new Map();
  let clock = 0;
  return {
    docs,
    async read(c, id) { const d = docs.get(`${c}/${id}`); return d ? { data: JSON.parse(JSON.stringify(d.data)), updateTime: d.updateTime } : null; },
    async commit(writes) {
      for (const w of writes) {
        if (!w.set) continue;
        const d = docs.get(w.set.join('/'));
        if (w.ifUpdateTime && (!d || d.updateTime !== w.ifUpdateTime)) return { ok: false, conflict: true };
        if (w.mustNotExist && d) return { ok: false, conflict: true };
      }
      for (const w of writes) {
        const key = (w.set || w.increment).join('/');
        const d = docs.get(key) || { data: {}, updateTime: '' };
        if (w.set) Object.assign(d.data, JSON.parse(JSON.stringify(w.data)));
        else for (const [k, n] of Object.entries(w.by)) d.data[k] = (Number(d.data[k]) || 0) + n;
        d.updateTime = `t${++clock}`;
        docs.set(key, d);
      }
      return { ok: true };
    }
  };
}

function post(body) {
  return { method: 'POST', url: '/api/shop', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'peopleforanimalsindia.org' }, body: new URLSearchParams(body).toString() };
}
function res() {
  return { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } };
}

async function checkout(items, extra) {
  const r = res();
  await require('../lib/routes/shop/checkout')(post({ items: JSON.stringify(items), ...SHOPPER, ...(extra || {}) }), r);
  const m = /name="encRequest" value="([0-9a-f]+)"/.exec(r.body);
  return { r, sent: m ? Object.fromEntries(new URLSearchParams(C.decrypt(m[1], KEY))) : null };
}

async function answer(sent, over) {
  const v = { order_id: sent.order_id, order_status: 'Success', amount: sent.amount, merchant_id: sent.merchant_id, tracking_id: '310000000001', bank_ref_no: 'BRN1', payment_mode: 'UPI', ...(over || {}) };
  const r = res();
  await require('../lib/routes/shop/response')(post({ encResp: C.encrypt(new URLSearchParams(v).toString(), KEY) }), r);
  return r;
}

test('every piece on shop.html is in the catalogue, at the catalogue price, with its photographs on disk', () => {
  const html = fs.readFileSync(path.join(ROOT, 'shop.html'), 'utf8');
  const cards = [...html.matchAll(/<article class="item[^"]*"[^>]*?data-id="(\d+)"[\s\S]*?data-price="(\d+)"(?: data-was="(\d+)")?[\s\S]*?data-images="([^"]+)"/g)];
  assert.equal(cards.length, Object.keys(SHOP.PRODUCTS).length, 'one card per catalogue piece');
  for (const [, id, price, was, images] of cards) {
    const p = SHOP.get(id);
    assert.ok(p, `card ${id} is not in lib/shop.js`);
    assert.equal(Number(price), p.price, `${p.name}: the page shows ${price}, the catalogue charges ${p.price}`);
    if (p.listPrice !== p.price) assert.equal(Number(was), p.listPrice);
    for (const src of images.split('|')) assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} is missing`);
  }
  assert.doesNotMatch(html, /peopleforanimalsindia\.org\/uploads/, 'photographs are served from this site');
});

test('a bag is priced from the catalogue, never from what the browser says', () => {
  const q = SHOP.quote(JSON.stringify([{ id: '23', size: 'l', qty: 1, price: 1 }, { id: '21', colour: 'Red', size: 'XL', qty: 2, unitPrice: 0 }, { id: '23', size: 'L', qty: 1 }]));
  assert.deepEqual(q.lines.map((l) => [l.id, l.size, l.qty, l.lineTotal]), [['23', 'L', 2, 5000], ['21', 'XL', 2, 700]]);
  assert.equal(q.shipping, SHOP.SHIPPING_FLAT);
  assert.equal(q.total, 5850);
  assert.equal(SHOP.get('23').listPrice, 5000, 'the designer pieces show the price they were listed at, struck through');
  assert.throws(() => SHOP.quote('[]'), /empty/);
  assert.throws(() => SHOP.quote('[{"id":"999","size":"L","qty":1}]'), /no longer in the shop/);
  assert.throws(() => SHOP.quote('[{"id":"23","size":"M","qty":1}]'), /Choose a size/);
  assert.throws(() => SHOP.quote('[{"id":"23","size":"L","qty":11}]'), /between 1 and 10/);
  assert.throws(() => SHOP.quote('[{"id":"23","size":"L","qty":0.5}]'), /between 1 and 10/);
  assert.throws(() => SHOP.quote('not json'), /could not be read/);
});

test('shop orders go only to pfa-oldsite, and only with a key that belongs to it', () => {
  env();
  assert.equal(backend.serviceAccount().project_id, 'pfa-oldsite');
  process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'pfa-new-website', client_email: 'a@b', private_key: 'x' });
  assert.throws(() => backend.serviceAccount(), /belongs to pfa-new-website, not pfa-oldsite/);
  delete process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT;
  assert.throws(() => backend.serviceAccount(), /PFA_SHOP_FIREBASE_SERVICE_ACCOUNT/);
  assert.equal(backend.isConfigured(), false);
});

test('without the pfa-oldsite key, orders go to the site database donations use; a wrong key is never fallen back from', () => {
  env();
  backend.use(null);
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'pfa-new-website', client_email: 'a@b', private_key: 'x' });
    assert.equal(backend.ready(), 'pfa-oldsite', 'the pfa-oldsite key wins when it is set');
    delete process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT;
    assert.equal(backend.ready(), 'pfa-new-website');
    assert.deepEqual(backend.SITE_COLLECTIONS, { orders: 'shopOrders', stock: 'shopStock', aggregates: 'shopTotals' });
    process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'someone-else', client_email: 'a@b', private_key: 'x' });
    assert.throws(() => backend.ready(), /belongs to someone-else/);
    delete process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    assert.throws(() => backend.ready(), /Missing Vercel environment variable/);
  } finally {
    if (saved === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved;
  }
});

test('the logo tee is not sold by colour: PFA chooses it at dispatch, says so on every line, and a colour sent is ignored', () => {
  assert.deepEqual(SHOP.get('21').palette, ['Red', 'Yellow', 'White', 'Pink']);
  assert.equal(SHOP.get('23').palette, null);
  assert.equal('colours' in SHOP.get('21'), false);
  /* no colour needed, and one sent (an old page, an old bag) is not read: two colours in one size are one line */
  const q = SHOP.quote([{ id: '21', size: 'L', qty: 1 }, { id: '21', colour: 'Yellow', size: 'L', qty: 1 }, { id: '21', colour: 'WHITE', size: 'XL', qty: 2 }, { id: '23', colour: 'Red', size: 'L', qty: 1 }]);
  assert.deepEqual(q.lines.map((l) => SHOP.describe(l)), ['2 x PFA logo T-shirt, size L, colour chosen at dispatch', '2 x PFA logo T-shirt, size XL, colour chosen at dispatch', '1 x Sabyasachi x PFA, size L']);
  for (const l of q.lines) assert.equal('colour' in l, false);
  assert.equal(q.total, 4 * 350 + 2500 + SHOP.SHIPPING_FLAT);
  /* an order placed while colours were chosen still reads as it was placed */
  assert.equal(SHOP.describe({ id: '21', name: 'PFA logo T-shirt', colour: 'Pink', size: 'L', qty: 1 }), '1 x PFA logo T-shirt, Pink, size L');
  assert.equal(SHOP.atDispatch({ id: '21', colour: 'Pink', size: 'L' }), false);
  /* the page offers no colour anywhere, and says how the colour is chosen */
  const html = fs.readFileSync(path.join(ROOT, 'shop.html'), 'utf8');
  assert.doesNotMatch(html, /name="colour-|class="colours|id="lookColours"|data-colour="/, 'a colour picker is left on the page');
  const tee = html.match(/<article class="item" id="pfa-logo-tee"[\s\S]*?<\/article>/)[0];
  assert.match(tee, /data-colour-at-dispatch/);
  assert.match(tee, /colour chosen for you at dispatch/);
  assert.match(html, /class="feature__note"><b>A limited palette<\/b>[^<]*chosen for you according to availability\./);
  for (const c of ['red', 'yellow', 'white', 'pink']) assert.match(html, new RegExp(`data-open-id="21" data-start="media/shop/v3/t-shirt-${c}-front\\.webp"`));
  const js = fs.readFileSync(path.join(ROOT, 'assets/shop.js'), 'utf8');
  assert.match(js, /its colour chosen for you according to availability\./);
  assert.doesNotMatch(js, /\.colours\b|colour: l\.colour/);
  const mail = require('../lib/caregiver-mail');
  const r = mail.render('shop_order_confirmed', { orderId: 'PFA-SHP-TEST0001', name: 'Meera', items: q.lines, subtotal: q.subtotal, shipping: q.shipping, total: q.total, delivery: {} });
  assert.match(r.text, /2 x PFA logo T-shirt, size L, colour chosen at dispatch/);
  const staff = mail.render('shop_order_staff', { orderId: 'PFA-SHP-TEST0001', name: 'Meera', items: q.lines, total: q.total, delivery: {} });
  assert.match(staff.html, /size XL, colour chosen at dispatch/);
});

test('checkout records the order before payment, reserves stock, and asks CCAvenue for the catalogue total', async () => {
  env();
  const db = memory();
  backend.use(db);
  try {
    const { r, sent } = await checkout([{ id: '23', size: 'XL', qty: 1, price: 1 }, { id: '21', colour: 'pink', size: 'L', qty: 2 }]);
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    assert.equal(sent.amount, '3350.00');
    assert.match(sent.order_id, /^PFA-SHP-[A-Z0-9]{8}$/);
    assert.equal(sent.redirect_url, 'https://peopleforanimalsindia.org/api/shop/response');
    assert.equal(sent.merchant_param3, 'store-order');
    const order = db.docs.get(`orders/${sent.order_id}`).data;
    assert.equal(order.status, 'initiated');
    assert.equal(order.total, 3350);
    assert.deepEqual(order.delivery, { name: 'Meera Shah', address: 'Flat 4, Shanti Niwas, FC Road', house: '', street: 'Flat 4, Shanti Niwas, FC Road', landmark: '', city: 'Pune', district: 'Pune', state: 'Maharashtra', zip: '411004', country: 'India', tel: '9876543210' });
    assert.equal(db.docs.get('stock/23__XL').data.remaining, 98);
    assert.equal(db.docs.has('stock/21__L'), false, 'the logo tee is not counted');
    assert.equal([...db.docs.keys()].some((k) => /^stock\/21_/.test(k)), false);
    assert.deepEqual(order.items.map((i) => SHOP.describe(i)), ['1 x Sabyasachi x PFA, size XL', '2 x PFA logo T-shirt, size L, colour chosen at dispatch']);
    assert.equal(order.items.some((i) => 'colour' in i), false, 'a colour the browser sent is not kept');
    assert.match(order.itemSummary, /(^|,)t-shirt:Lx2/);
  } finally { backend.use(null); }
});

test('a size that has sold out cannot be bought, and no order is written', async () => {
  env();
  const db = memory();
  backend.use(db);
  try {
    await db.commit([{ set: ['stock', '38__L'], data: { remaining: 0 } }]);
    const { r, sent } = await checkout([{ id: '38', size: 'L', qty: 1 }]);
    assert.equal(sent, null);
    assert.match(r.body, /sold out/);
    assert.equal([...db.docs.keys()].filter((k) => k.startsWith('orders/')).length, 0);
  } finally { backend.use(null); }
});

test('with no order store at all, checkout takes no payment', async () => {
  env();
  delete process.env.PFA_SHOP_FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_PROJECT_ID;
  const { r, sent } = await checkout([{ id: '23', size: 'L', qty: 1 }]);
  assert.equal(sent, null);
  assert.equal(r.statusCode, 503);
  assert.match(r.body, /Nothing has been charged/);
});

test('a paid answer settles the order once, however often it arrives', async () => {
  env();
  const db = memory();
  backend.use(db);
  try {
    const { sent } = await checkout([{ id: '26', size: 'L', qty: 1 }]);
    const first = await answer(sent);
    assert.match(first.body, /Thank you, Meera\./);
    assert.match(first.body, new RegExp(sent.order_id));
    assert.match(first.body, /localStorage\.removeItem\('pfa-shop-bag'\)/, 'the bag empties once paid');
    const order = db.docs.get(`orders/${sent.order_id}`).data;
    assert.equal(order.status, 'paid');
    assert.equal(order.fulfilment, 'pending');
    assert.equal(order.trackingId, '310000000001');
    assert.deepEqual(db.docs.get('aggregates/store').data, { orders: 1, revenue: 2650 });
    const second = await answer(sent);
    assert.match(second.body, /Thank you, Meera\./);
    assert.deepEqual(db.docs.get('aggregates/store').data, { orders: 1, revenue: 2650 }, 'counted once');
  } finally { backend.use(null); }
});

test('a cancelled payment gives its stock back; a mismatched amount is held for a person to check', async () => {
  env();
  const db = memory();
  backend.use(db);
  try {
    const a = await checkout([{ id: '37', size: 'XL', qty: 2 }]);
    assert.equal(db.docs.get('stock/37__XL').data.remaining, 97);
    const cancelled = await answer(a.sent, { order_status: 'Aborted' });
    assert.match(cancelled.body, /Payment cancelled/);
    assert.equal(db.docs.get(`orders/${a.sent.order_id}`).data.status, 'cancelled');
    assert.equal(db.docs.get('stock/37__XL').data.remaining, 99);

    const b = await checkout([{ id: '37', size: 'XL', qty: 1 }]);
    const forged = await answer(b.sent, { amount: '1.00' });
    assert.match(forged.body, /needs a check/);
    assert.equal(db.docs.get(`orders/${b.sent.order_id}`).data.status, 'verification_failed');
    assert.equal(db.docs.has('aggregates/store'), false, 'nothing counted as revenue');

    const c = await checkout([{ id: '37', size: 'XL', qty: 1 }]);
    const other = await answer(c.sent, { merchant_id: '999999' });
    assert.match(other.body, /needs a check/);
  } finally { backend.use(null); }
});

test('the shop routes are served by the one API function', () => {
  const { ROUTES } = require('../api/index.js')._private;
  assert.ok(ROUTES['shop/checkout'] && ROUTES['shop/response']);
});
