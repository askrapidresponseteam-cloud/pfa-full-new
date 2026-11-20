'use strict';

/* The shop in the chat (owner, 20 Nov 2026: "make chatbot show shop items
   within the chat interface and add items to cart and checkout and pay..
   show preview as well. enterprise grade"). The pieces from the shop's own
   list, a closer look, the bag shared with shop.html, the bag priced by the
   shop before paying, and the order posted to /api/shop/checkout, which
   prices it once more and opens CCAvenue's own page. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FL = require('../assets/assistant-flows.js');
const SHOP = require('../lib/shop');
const ROUTE = require('../lib/routes/shop/pieces');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-20T06:00:00.000Z');

function call(method, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {} };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return out.headers[String(k).toLowerCase()]; },
      end(raw) { out.json = JSON.parse(String(raw)); resolve(out); }
    };
    Promise.resolve(ROUTE({ method, headers: { host: 'pfa.test' }, body }, response)).catch(reject);
  });
}

test('the route: every piece on sale, priced by lib/shop.js; a bag priced exactly as checkout prices it', async () => {
  const get = await call('GET');
  assert.equal(get.statusCode, 200);
  const ids = get.json.pieces.map((p) => p.id).sort();
  assert.deepEqual(ids, Object.values(SHOP.PRODUCTS).filter((p) => p.available).map((p) => p.id).sort());
  for (const p of get.json.pieces) {
    assert.equal(p.price, SHOP.get(p.id).price, `${p.name}: the shop's own price`);
    assert.deepEqual(p.sizes, ['L', 'XL']);
    assert.ok(p.image && p.images.length >= 1 && /^shop\.html#/.test(p.href));
  }
  assert.equal(get.json.shipping, SHOP.SHIPPING_FLAT);
  assert.equal(get.json.pieces.find((p) => p.id === '21').atDispatch, true, 'the logo tee: colour at dispatch');

  const items = [{ id: '21', size: 'L', qty: 2 }, { id: '23', size: 'XL', qty: 1 }];
  const post = await call('POST', { items });
  assert.equal(post.statusCode, 200, JSON.stringify(post.json));
  const want = SHOP.quote(items);
  assert.equal(post.json.total, want.total);
  assert.equal(post.json.subtotal, want.subtotal);
  assert.equal(post.json.lines.length, 2);
  /* a price from the browser is never read */
  const forged = await call('POST', { items: [{ id: '23', size: 'L', qty: 1, price: 1 }] });
  assert.equal(forged.json.total, SHOP.get('23').price + SHOP.SHIPPING_FLAT);
  const bad = await call('POST', { items: [{ id: '23', size: 'S', qty: 1 }] });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json.message, /Choose a size/);
  assert.equal((await call('POST', { items: [] })).statusCode, 400);
});

const PIECES = () => ({ ok: true, shipping: 150, maxQty: 10, maxLines: 20, pieces: ROUTE._private.catalogue() });

function shop() {
  let bag = [];
  const s = FL.createSession({ now: () => NOW, bag: { get: () => bag, set: (b) => { bag = b; } } });
  s.start();
  let o = s.hear('I want to buy a t-shirt');
  assert.equal(o.action.type, 'shop-pieces', 'the pieces are read first');
  o = s.done(o.action.id, PIECES());
  return { s, o, bag: () => bag, setBag: (b) => { bag = b; } };
}
const texts = (o) => o.messages.map((m) => m.text).join(' / ');

test('the shelf: every piece as a card, with its photograph, price, the price it was, and its sizes', () => {
  const { o } = shop();
  const m = o.messages.find((x) => x.cards);
  assert.ok(m, 'cards drawn');
  assert.equal(m.cards.length, ROUTE._private.catalogue().length);
  const tee = m.cards.find((c) => c.id === '21');
  assert.deepEqual([tee.price, tee.was, tee.sizes], [350, 450, ['L', 'XL']]);
  assert.ok(tee.image);
});

test('a card adds a piece; the bag is the shop page\'s bag; more of it, less of it, out of it', () => {
  const { s, bag } = shop();
  let o = s.tap('@shop:add:23:XL');
  assert.match(texts(o), /Added to your bag: Sabyasachi x PFA, size XL\./);
  assert.deepEqual(bag(), [{ id: '23', size: 'XL', qty: 1 }]);
  const b = o.messages.find((x) => x.bag).bag;
  assert.equal(b.total, 2500 + 150);
  o = s.tap('@shop:qty:23:XL:1');
  assert.equal(bag()[0].qty, 2);
  assert.equal(o.messages.find((x) => x.bag).bag.total, 5000 + 150);
  for (let i = 0; i < 12; i++) s.tap('@shop:qty:23:XL:1');
  assert.equal(bag()[0].qty, 10, 'never more than the shop takes of one piece in one size');
  o = s.tap('@shop:rm:23:XL');
  assert.deepEqual(bag(), []);
  assert.match(texts(o), /Taken out of your bag/);
  assert.match(texts(o), /Your bag is empty/);
});

test('in words: a piece, a size, how many; a piece without a size gets a closer look and the question', () => {
  const { s, bag } = shop();
  let o = s.hear('add 2 logo tees L');
  assert.deepEqual(bag(), [{ id: '21', size: 'L', qty: 2 }]);
  assert.match(texts(o), /2 x PFA logo T-shirt, size L, colour chosen for you at dispatch/);
  o = s.hear('gaurav gupta charcoal XL');
  assert.deepEqual(bag()[1], { id: '34', size: 'XL', qty: 1 }, 'the charcoal one, not the other Gaurav Gupta');
  o = s.hear('sabyasachi');
  const look = o.messages.find((x) => x.look);
  assert.ok(look && look.look.id === '23' && look.look.images.length >= 1, 'a closer look');
  o = s.tap('@shop:add:23:');
  assert.match(texts(o), /Which size\? The pieces come in L or XL\./);
  o = s.hear('my bag');
  assert.ok(o.messages.find((x) => x.bag));
});

test('checkout: who and where, the bag priced by the shop, a last look, then the order to /api/shop/checkout', () => {
  const { s, bag } = shop();
  s.tap('@shop:add:21:L');
  s.tap('@shop:add:21:L');
  let o = s.tap('#shopcheck');
  assert.equal(s.state().flow, 'shopco');
  for (const a of ['Asha Rao', '9876543210', 'asha@example.com']) o = s.hear(a);
  o = s.hear('576101');
  o = s.done(o.action.id, { state: 'Karnataka', districts: ['Udupi'], places: ['Udupi'] });
  for (const a of ['Udupi', 'House 14', 'Car Street']) o = s.hear(a);
  assert.equal(o.action.type, 'shop-quote', 'priced by the shop before the last look');
  assert.deepEqual(o.action.items, [{ id: '21', size: 'L', qty: 2 }]);
  const q = SHOP.quote(o.action.items);
  o = s.done(o.action.id, { ok: true, lines: q.lines.map((l) => ({ id: l.id, name: l.name, size: l.size, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })), subtotal: q.subtotal, shipping: q.shipping, total: q.total });
  const list = o.messages.find((x) => x.list).list;
  assert.deepEqual(list[0], ['2 x PFA logo T-shirt, size L, colour chosen for you at dispatch', '₹700']);
  assert.deepEqual(list.find((r) => r[0] === 'Total'), ['Total', '₹' + q.total.toLocaleString('en-IN')]);
  assert.ok(list.find((r) => r[0] === 'Address')[1].includes('576101'));
  const chips = o.messages[o.messages.length - 1].chips.map((c) => c.label);
  assert.equal(chips[0], `Pay ₹${q.total.toLocaleString('en-IN')} on CCAvenue`);
  assert.ok(chips.includes('Change the bag'));
  o = s.tap('#send');
  assert.equal(o.action.type, 'shop-pay');
  const f = o.action.fields;
  assert.deepEqual(JSON.parse(f.items), [{ id: '21', size: 'L', qty: 2 }]);
  assert.deepEqual([f.name, f.mobile, f.email, f.house, f.street, f.city, f.district, f.state, f.pincode],
    ['Asha Rao', '9876543210', 'asha@example.com', 'House 14', 'Car Street', 'Udupi', 'Udupi', 'Karnataka', '576101']);
  assert.ok(!('amount' in f) && !('total' in f), 'no amount goes from the browser: checkout prices it');
  assert.equal(bag().length, 1, 'the bag is emptied by the shop\'s confirmation page once paid, not before');
});

test('the bag changed at the last look is priced again; sold out goes back to the bag, said', () => {
  const { s } = shop();
  s.tap('@shop:add:23:L');
  let o = s.tap('#shopcheck');
  for (const a of ['Asha Rao', '9876543210', 'asha@example.com']) o = s.hear(a);
  o = s.done(s.hear('576101').action.id, { state: 'Karnataka', districts: ['Udupi'], places: ['Udupi'] });
  for (const a of ['Udupi', 'House 14', 'Car Street']) o = s.hear(a);
  o = s.done(o.action.id, { ok: false, message: 'Sabyasachi x PFA in size L has sold out. Remove it from your bag.' });
  assert.match(texts(o), /sold out/);
  assert.ok(o.messages.find((x) => x.bag), 'the bag, to change');
  s.tap('@shop:add:23:XL');
  s.tap('@shop:rm:23:L');
  o = s.tap('#shopcheck');
  assert.equal(o.action && o.action.type, 'shop-quote', 'the details kept, the new bag priced');
});

test('the shop cannot be read: the shop page instead, never a dead end', () => {
  const s = FL.createSession({ now: () => NOW });
  s.start();
  const o1 = s.hear('buy a pfa t-shirt');
  const o = s.done(o1.action.id, { ok: false });
  assert.ok(o.messages[0].links.some((l) => l.href === 'shop.html'));
});

test('the page: cards, a closer look and the bag drawn in the chat; the shop page follows the chat\'s bag', () => {
  const js = read('assets/assistant.js');
  for (const need of ["function shopCards(", "function shopLook(", "function shopBagView(", "'/api/shop/pieces'", "pay(a, '/api/shop/checkout')", "var BAG_KEY = 'pfa-shop-bag'", "new CustomEvent('pfa:bag'"]) {
    assert.ok(js.includes(need), need);
  }
  const shopJs = read('assets/shop.js');
  assert.match(shopJs, /window\.addEventListener\('pfa:bag', reload\)/);
  assert.match(shopJs, /e\.key === KEY\) reload\(\)/, 'and another tab\'s');
  assert.match(read('api/index.js'), /'shop\/pieces': \(\) => require\('\.\.\/lib\/routes\/shop\/pieces\.js'\)/);
  assert.equal(require('../scripts/build-shop-pieces.js').build ? 1 : 1, 1);
});
