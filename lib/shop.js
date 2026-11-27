'use strict';

/* The PFA shop's catalogue: the one place a price is trusted.

   The bag on shop.html lives in the visitor's browser, where anyone can edit
   it, so the browser sends only which piece, which size and how many. The
   amount CCAvenue is asked to take is worked out here, from this list, every
   time. A price arriving from the browser is never read.

   The pieces, their ids, prices and sizes are the ones on the old site's
   merchandise pages (peopleforanimalsindia.org/product.html), as kept in the
   PFAcurrent snapshot. The designer pieces are half price (owner, 3 Oct
   2026): ₹2500, with the ₹5000 they were listed at shown struck
   through. The ids are the old site's product_id values, so an
   order can be matched to the old records without a mapping. The photographs
   are in media/shop/, copied from that snapshot's uploads/product/.

   PFA is the seller. The money goes to PFA's own CCAvenue account, the one
   donations and memberships use; there is no third-party merchant here.

   The logo tee is made in a palette of colours (red, yellow, white and
   pink) but is not sold by colour: PFA picks the colour from what is on the
   shelf when it packs the order (owner, 8 Oct 2026; until then the shopper
   chose one). Such a piece lists the palette in `palette` and says so on
   every line, "colour chosen at dispatch", so the shopper's email and the
   packers' read the same. A colour sent by the browser is never read, for
   any piece. An order placed while colours were chosen keeps its colour and
   still reads "Red, size L".

   To take a piece off sale, set `available: false`. It stays in the list so
   an order already placed for it still reads correctly. */

const PRODUCTS = {
  '23': { slug: 'sabyasachi-x-pfa', name: 'Sabyasachi x PFA', designer: 'Sabyasachi', price: 2500, listPrice: 5000 },
  '26': { slug: 'gaurav-gupta-x-pfa', name: 'Gaurav Gupta x PFA', designer: 'Gaurav Gupta', price: 2500, listPrice: 5000 },
  '21': { slug: 't-shirt', name: 'PFA logo T-shirt', designer: 'People for Animals', price: 350, listPrice: 450, kind: 'essentials', palette: ['Red', 'Yellow', 'White', 'Pink'] },
  '27': { slug: 'varun-bahl-x-pfa', name: 'Varun Bahl x PFA', designer: 'Varun Bahl', price: 2500, listPrice: 5000 },
  '29': { slug: 'rocky-star-x-pfa', name: 'Rocky Star x PFA', designer: 'Rocky Star', price: 2500, listPrice: 5000 },
  '30': { slug: 'geisha-designs-x-pfa', name: 'Geisha Designs x PFA', designer: 'Geisha Designs', price: 2500, listPrice: 5000 },
  '31': { slug: 'muzaffar-ali-x-pfa', name: 'Muzaffar Ali x PFA', designer: 'Muzaffar Ali', price: 2500, listPrice: 5000 },
  '32': { slug: 'nida-mahmood-x-pfa', name: 'Nida Mahmood x PFA', designer: 'Nida Mahmood', price: 2500, listPrice: 5000 },
  '33': { slug: 'j-j-valaya-x-pfa', name: 'J J Valaya x PFA', designer: 'J J Valaya', price: 2500, listPrice: 5000 },
  '34': { slug: 'gaurav-gupta-x-pfa-charcoal', name: 'Gaurav Gupta x PFA, Charcoal', designer: 'Gaurav Gupta', price: 2500, listPrice: 5000, colour: 'Charcoal' },
  '35': { slug: 'monisha-jaisingh-x-pfa', name: 'Monisha Jaisingh x PFA', designer: 'Monisha Jaisingh', price: 2500, listPrice: 5000 },
  '36': { slug: 'varun-bahl-x-pfa-design-2', name: 'Varun Bahl x PFA, Design 2', designer: 'Varun Bahl', price: 2500, listPrice: 5000 },
  '37': { slug: 'raw-mango-x-pfa', name: 'Raw Mango x PFA', designer: 'Raw Mango', price: 2500, listPrice: 5000 },
  '38': { slug: 'masaba-gupta-x-pfa', name: 'Masaba Gupta x PFA', designer: 'Masaba Gupta', price: 2500, listPrice: 5000 },
  '39': { slug: 'ashima-singh-x-pfa', name: 'Ashima Singh x PFA', designer: 'Ashima Singh', price: 2500, listPrice: 5000 }
};

Object.keys(PRODUCTS).forEach((id) => {
  const p = PRODUCTS[id];
  p.id = id;
  p.kind = p.kind || 'designer';
  p.listPrice = p.listPrice || p.price;
  p.sizes = ['L', 'XL'];
  /* Pieces per size for this drop, as the old catalogue held them; null is
     not counted. The count itself lives in the pfa-oldsite stock collection,
     seeded from this number on the first sale of a size. */
  if (p.stock === undefined) p.stock = p.kind === 'designer' ? 99 : null;
  if (p.available === undefined) p.available = true;
  p.palette = Array.isArray(p.palette) && p.palette.length ? Object.freeze(p.palette.slice()) : null;
  Object.freeze(p.sizes);
  Object.freeze(p);
});
Object.freeze(PRODUCTS);

/* Delivery anywhere in India, one flat charge per order: the ₹150 the old
   site's cart charged. */
const SHIPPING_FLAT = 150;
const MAX_LINES = 20;
const MAX_QTY = 10;

function get(id) {
  const key = String(id == null ? '' : id).trim();
  return Object.prototype.hasOwnProperty.call(PRODUCTS, key) ? PRODUCTS[key] : null;
}

/* What the browser sent, read as a list. It may arrive as the JSON string a
   form field carries, or already parsed. */
function readItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/* Prices a bag from this catalogue. Two lines for the same piece and size
   are one line (a bag kept from before 8 Oct 2026 may hold the logo tee in
   two colours: they become one line). Throws with a sentence a shopper can
   act on, or returns { lines, subtotal, shipping, total, count }. */
function quote(raw) {
  const items = readItems(raw);
  if (items === null) throw new Error('Your bag could not be read. Add your pieces again.');
  if (!items.length) throw new Error('Your bag is empty.');
  if (items.length > MAX_LINES) throw new Error('That is too many lines for one order. Call PFA on +91 99533 13319 for a large order.');

  const merged = new Map();
  for (const item of items) {
    const product = get(item && item.id);
    if (!product) throw new Error('One of the pieces in your bag is no longer in the shop. Remove it and try again.');
    if (!product.available) throw new Error(`${product.name} is no longer available. Remove it from your bag and try again.`);
    const size = String(item.size || '').trim().toUpperCase();
    if (!product.sizes.includes(size)) throw new Error(`Choose a size for ${product.name}: ${product.sizes.join(' or ')}.`);
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error(`${product.name}: the quantity must be between 1 and ${MAX_QTY}.`);
    const key = `${product.id}:${size}`;
    const line = merged.get(key) || { id: product.id, slug: product.slug, name: product.name, size, qty: 0, unitPrice: product.price, stock: product.stock };
    line.qty += qty;
    if (line.qty > MAX_QTY) throw new Error(`${product.name}: the quantity must be between 1 and ${MAX_QTY}.`);
    merged.set(key, line);
  }

  const lines = [...merged.values()].map((l) => ({ ...l, lineTotal: l.unitPrice * l.qty }));
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping = SHIPPING_FLAT;
  return { lines, subtotal, shipping, total: subtotal + shipping, count: lines.reduce((n, l) => n + l.qty, 0) };
}

/* Which version of a piece a line is: "size L". An order placed while the
   logo tee was sold by colour reads "Red, size L". */
function variant(line) {
  return `${line.colour ? `${line.colour}, ` : ''}size ${line.size}`;
}

/* True for a line whose colour PFA chooses when it packs the order. */
function atDispatch(line) {
  const product = get(line && line.id);
  return Boolean(product && product.palette && !(line && line.colour));
}

/* One line of an order as people read it: "2 x Sabyasachi x PFA, size L",
   "1 x PFA logo T-shirt, size XL, colour chosen at dispatch". */
function describe(line) {
  return `${line.qty} x ${line.name}, ${variant(line)}${atDispatch(line) ? ', colour chosen at dispatch' : ''}`;
}

module.exports = { PRODUCTS, SHIPPING_FLAT, MAX_QTY, MAX_LINES, get, quote, describe, variant, atDispatch, readItems };
