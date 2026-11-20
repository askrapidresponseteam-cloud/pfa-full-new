'use strict';

/* /api/shop/pieces: the shop, for the chat (owner, 20 Nov 2026: "make
   chatbot show shop items within the chat interface and add items to cart
   and checkout and pay.. show preview as well").

     GET   every piece on sale: name, designer, price and the price it was,
           sizes, photographs, and where it is on shop.html; the delivery
           charge and the most of one piece an order takes.
     POST  { items: [{ id, size, qty }] }: the bag priced here, by
           lib/shop.js, exactly as /api/shop/checkout will price it, with
           each size's stock checked, so what the chat shows before paying
           is what CCAvenue is asked to take. Nothing is reserved: that
           happens at checkout, in one write with the order.

   The chat's bag is the shop page's bag (localStorage 'pfa-shop-bag'), so a
   piece added in either is in both. */

const { readRequestBody, setSecurityHeaders } = require('../../ccavenue');
const SHOP = require('../../shop');
const PIECES = require('../../shop-pieces.json').pieces;

function send(response, status, body, cache) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache || 'no-store');
  response.end(JSON.stringify(body));
}

function catalogue() {
  return PIECES.map((p) => {
    const product = SHOP.get(p.id);
    if (!product || product.available === false) return null;
    return {
      id: product.id,
      name: product.name,
      designer: product.designer,
      kind: product.kind,
      price: product.price,
      was: product.listPrice > product.price ? product.listPrice : 0,
      sizes: product.sizes.slice(),
      atDispatch: Boolean(product.palette),
      image: p.image,
      images: (p.images && p.images.length ? p.images : [p.image]).filter(Boolean),
      href: `shop.html#${p.anchor}`
    };
  }).filter(Boolean);
}

/* What is left of each size, where it is counted; null when not counted or
   the store cannot be read just now (checkout checks again either way). */
async function leftOf(line) {
  if (line.stock === null || line.stock === undefined) return null;
  try {
    const backend = require('../../shop-backend');
    const doc = await backend.read('stock', `${line.id}__${line.size}`);
    return doc && Number.isFinite(Number(doc.data.remaining)) ? Number(doc.data.remaining) : line.stock;
  } catch (_) {
    return null;
  }
}

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);
  if (request.method === 'GET') {
    return send(response, 200, { ok: true, pieces: catalogue(), shipping: SHOP.SHIPPING_FLAT, maxQty: SHOP.MAX_QTY, maxLines: SHOP.MAX_LINES }, 'public, max-age=120');
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return send(response, 405, { ok: false, message: 'Use GET or POST.' });
  }
  let quote;
  try {
    const body = await readRequestBody(request, 16 * 1024);
    quote = SHOP.quote(body && body.items);
  } catch (error) {
    return send(response, 400, { ok: false, message: String((error && error.message) || 'Your bag could not be read.').slice(0, 300) });
  }
  const lines = [];
  for (const l of quote.lines) {
    const left = await leftOf(l);
    if (left !== null && left < l.qty) {
      return send(response, 409, {
        ok: false,
        id: l.id,
        size: l.size,
        left: Math.max(0, left),
        message: left <= 0
          ? `${l.name} in ${SHOP.variant(l)} has sold out. Remove it from your bag.`
          : `Only ${left} of ${l.name} in ${SHOP.variant(l)} ${left === 1 ? 'is' : 'are'} left. Change the quantity.`
      });
    }
    lines.push({ id: l.id, name: l.name, size: l.size, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, line: SHOP.describe(l) });
  }
  return send(response, 200, { ok: true, lines, subtotal: quote.subtotal, shipping: quote.shipping, total: quote.total, count: quote.count });
};

module.exports._private = { catalogue };
