'use strict';

/* POST /api/shop/checkout: the bag on shop.html, paid for.

   The browser sends which pieces, which sizes and how many, and the
   shopper's name, mobile, email and delivery address. Everything that costs
   money is decided here: lib/shop.js prices the bag, adds the delivery
   charge, and that total is what CCAvenue is asked to take.

   Before the shopper leaves for CCAvenue the order is written to the order
   store (pfa-oldsite once its key is set, this site's own Firestore until
   then; lib/shop-backend.js) as 'initiated', with the stock for each size reserved
   in the same write. If that write cannot be made, no payment is started: an
   order the backend never heard of is the one thing this must not produce.
   lib/routes/shop/response.js completes the record when CCAvenue answers. */

const crypto = require('crypto');
const { cleanText, getBaseUrl, readRequestBody, setSecurityHeaders } = require('../../ccavenue');
const { getCredentials, isConfigurationError, renderError, renderTransfer } = require('../../pfa-ccavenue-flow');
const RULES = require('../../../assets/field-rules.js');
const SHOP = require('../../shop');
const backend = require('../../shop-backend');
const { placeAgrees } = require('../../payment');
const POSTAL = require('../../postal');

const PHONE = '+91 99533 13319';
const BACK = '/shop.html#bag';

function orderId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  while (token.length < 8) token += alphabet[crypto.randomInt(0, alphabet.length)];
  return `PFA-SHP-${token}`;
}

/* The shopper and where the parcel goes, through the rules the browser
   applies, so the two can never disagree about a valid PIN or mobile. */
function readShopper(body) {
  const who = RULES.parseFields(body, [
    ['name', { required: true, emptyMessage: 'Enter your name.' }],
    ['mobile', { required: true, emptyMessage: 'Enter a 10-digit Indian mobile number for the delivery.' }],
    ['email', { required: true, emptyMessage: 'Enter your email, so your order confirmation reaches you.' }]
  ]);
  if (!who.ok) throw new Error(who.message);
  const place = (field, message) => {
    const error = RULES.checkField(field, body[field], { required: true });
    if (error) throw new Error(cleanText(body[field], 5) ? error : message);
    return cleanText(RULES.normaliseField(field, body[field]), 150);
  };
  const district = place('district', 'Pick the district.');
  const state = place('state', 'Pick the state.');
  const zip = place('pincode', 'Enter the 6-digit PIN code.');
  /* the PIN must be one that can be in the state, and the district in it:
     the same check the donation and the applications make */
  placeAgrees({ state, district, pin: zip });
  /* The parcel goes by courier: the door, the street, a landmark, and the
     town (owner, 29 Oct 2026: "ask for proper mailing address including
     their house number"). */
  const postal = POSTAL.read(body);
  /* the town; a page from before it was asked sends none, and the district
     stands in for it, as it always did */
  const city = cleanText(body.city, 5) ? place('city', 'Add the city, town or village.') : district;
  return {
    customer: { name: who.values.name.slice(0, 100), email: who.values.email, tel: who.values.mobile },
    delivery: {
      name: who.values.name.slice(0, 100),
      address: cleanText(postal.address, 150),
      house: postal.house,
      street: postal.street,
      landmark: postal.landmark,
      city,
      district,
      state,
      zip,
      country: 'India',
      tel: who.values.mobile
    }
  };
}

/* Stock is held as stock/{id}__{size}.remaining in the backend. A size never
   sold before has no document yet and starts from the catalogue's number.
   Each read comes back with its update time, and the write is made only if
   nothing changed since, so two shoppers cannot both take the last piece. */
async function stockWrites(lines) {
  const writes = [];
  const reserved = [];
  for (const line of lines.filter((l) => l.stock !== null && l.stock !== undefined)) {
    const key = `${line.id}__${line.size}`;
    const doc = await backend.read('stock', key);
    const remaining = doc && Number.isFinite(Number(doc.data.remaining)) ? Number(doc.data.remaining) : line.stock;
    if (remaining < line.qty) {
      throw Object.assign(new Error(remaining <= 0
        ? `${line.name} in ${SHOP.variant(line)} has sold out. Remove it from your bag and try again.`
        : `Only ${remaining} of ${line.name} in ${SHOP.variant(line)} ${remaining === 1 ? 'is' : 'are'} left. Change the quantity and try again.`), { shopper: true });
    }
    writes.push(doc
      ? { set: ['stock', key], data: { remaining: remaining - line.qty, updatedAt: new Date().toISOString() }, ifUpdateTime: doc.updateTime }
      : { set: ['stock', key], data: { productId: line.id, size: line.size, remaining: remaining - line.qty, updatedAt: new Date().toISOString() }, mustNotExist: true });
    reserved.push({ key, qty: line.qty });
  }
  return { writes, reserved };
}

function summaryOf(lines) {
  return lines.map((l) => `${l.slug}:${l.size}x${l.qty}`).join(',').slice(0, 250);
}

async function recordInitiated(id, quote, shopper) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stock = await stockWrites(quote.lines);
    const order = {
      orderId: id,
      status: 'initiated',
      createdAt: new Date().toISOString(),
      source: 'peopleforanimalsindia.org/shop',
      items: quote.lines.map((l) => ({ id: l.id, slug: l.slug, name: l.name, size: l.size, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      itemSummary: summaryOf(quote.lines),
      subtotal: quote.subtotal,
      shipping: quote.shipping,
      total: quote.total,
      customer: shopper.customer,
      delivery: shopper.delivery,
      stockReserved: stock.reserved,
      fulfilment: 'not-required'
    };
    const result = await backend.commit([{ set: ['orders', id], data: order, mustNotExist: true }, ...stock.writes]);
    if (result.ok) return order;
    if (!result.conflict) throw Object.assign(new Error(result.error || 'The order could not be recorded.'), { backend: true });
  }
  throw Object.assign(new Error('The shop is busy. Try again in a moment.'), { backend: true });
}

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return renderError(response, 405, 'Start from the shop', 'Orders are placed from the bag on the PFA shop page.', '/shop.html', 'Go to the shop');
  }

  let quote;
  let shopper;
  try {
    const body = await readRequestBody(request);
    quote = SHOP.quote(body.items);
    shopper = readShopper(body);
  } catch (error) {
    return renderError(response, 400, 'Please check your order', cleanText(error && error.message, 300), BACK, 'Back to your bag');
  }

  try {
    const { merchantId } = getCredentials('inr');
    const where = backend.ready();
    const id = orderId();
    let order;
    try {
      order = await recordInitiated(id, quote, shopper);
    } catch (error) {
      if (!error.shopper) error.backend = true;
      throw error;
    }
    await backend.ledger.started(order, where);
    const callback = `${getBaseUrl(request)}/api/shop/response`;
    const d = order.delivery;
    console.info('PFA shop order started', { orderId: id, total: order.total, lines: order.items.length, store: where });
    return renderTransfer(response, {
      merchant_id: merchantId,
      order_id: id,
      amount: order.total.toFixed(2),
      currency: 'INR',
      language: 'EN',
      redirect_url: callback,
      cancel_url: callback,
      billing_name: order.customer.name,
      billing_email: order.customer.email,
      billing_tel: order.customer.tel,
      billing_address: d.address,
      billing_city: d.city,
      billing_state: d.state,
      billing_zip: d.zip,
      billing_country: d.country,
      delivery_name: d.name,
      delivery_address: d.address,
      delivery_city: d.city,
      delivery_state: d.state,
      delivery_zip: d.zip,
      delivery_country: d.country,
      delivery_tel: d.tel,
      merchant_param2: 'PFA Shop',
      merchant_param3: 'store-order',
      merchant_param4: order.itemSummary.slice(0, 100),
      merchant_param5: id
    }, {
      title: 'Opening secure payment',
      message: `Your order ${id} for ₹${order.total.toLocaleString('en-IN')} is saved. You are being taken to CCAvenue to pay; PFA never sees your card, bank or UPI details.`,
      currency: 'inr',
      returnUrl: BACK
    });
  } catch (error) {
    const message = cleanText(error && error.message, 300);
    const config = isConfigurationError(message) || /PFA_SHOP_FIREBASE_SERVICE_ACCOUNT/.test(message);
    if (config || (error && error.backend)) console.error('PFA shop checkout could not start', { message });
    if (config) {
      return renderError(response, 503, 'Online orders are not open yet', `The shop cannot take payment just now. Nothing has been charged. To order, call PFA on ${PHONE}.`, BACK, 'Back to your bag');
    }
    if (error && error.backend) {
      return renderError(response, 503, 'Your order could not be saved', `Nothing has been charged. Try again in a moment, or call PFA on ${PHONE}.`, BACK, 'Back to your bag');
    }
    return renderError(response, 409, 'Please check your order', message, BACK, 'Back to your bag');
  }
};

module.exports._private = { orderId, readShopper, summaryOf };
