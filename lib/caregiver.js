'use strict';

/* Colony Animal Colony Caregiver Card - domain rules.
   Deliberately free of Firebase and HTTP: every rule here is unit-testable and
   is reused by the public API, the payment callback and the admin panel. */

const crypto = require('crypto');
const RULES = require('../assets/field-rules.js');
const PRINT = require('../assets/card-print.js');

// Printing and delivery only. The card itself is free and always will be.
const SHIPPING_PRICE = '100.00';
const VALIDITY_YEARS = 3;

const CARD_ID_PATTERN = /^PFA-CCT-[A-Z0-9]{8}$/;
const ORDER_ID_PATTERN = /^PFA-CAR-[A-Z0-9]{8}$/;
const SHIPMENT_ID_PATTERN = /^PFA-SHP-[A-Z0-9]{8}$/;

/* 0/O and 1/I are left out: these numbers are read aloud over the phone and
   copied off a printed card. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function token(length) {
  let out = '';
  while (out.length < length) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out.slice(0, length);
}

/* A card number is printed on the card, in the value column, at the card's
   one size (assets/card-print.js). About one number in a hundred thousand
   the alphabet can make (eight wide letters, PFA-CCT-WWWWWWWW at the
   extreme) is wider than that column, so such a number is never given: a
   fresh one is drawn instead. Even the widest possible number would still
   end clear of the photograph, so a number given before this rule prints
   without touching anything. */
const createCardId = () => {
  for (let i = 0; i < 50; i += 1) {
    const id = `PFA-CCT-${token(8)}`;
    if (PRINT.fits(id)) return id;
  }
  return `PFA-CCT-${token(8)}`;
};
const createOrderId = () => `PFA-CAR-${token(8)}`;
const createShipmentId = () => `PFA-SHP-${token(8)}`;
const createApplicantId = () => `PFA-APL-${token(10)}`;
const createAddressId = () => `PFA-ADR-${token(10)}`;
const createEventId = () => `PFA-EVT-${token(12)}`;

/* Identity fingerprints for duplicate prevention without an OTP.

   The mobile number is the hard key, but a determined applicant can simply use
   a second number, so a softer key is kept alongside it: the person's name and
   the address they gave. Names get normalised hard - case, punctuation, spacing
   and honorifics all removed - because "Dr. Asha Kumar" and "asha kumar" are
   the same applicant. A soft-key hit does not block; it warns and is recorded
   for review, since two people can genuinely share a household. */
const HONORIFICS = /^(shri|smt|mr|mrs|ms|dr|prof|sri|km|master)\.?\s+/i;

function identityKey(name, pin) {
  const cleanName = String(name || '')
    .toLowerCase()
    .replace(HONORIFICS, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
  return crypto.createHash('sha256')
    .update(`${cleanName}|${String(pin || '').trim()}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function householdKey(address, pin) {
  return addressFingerprint(address, pin);
}

/* A card is controlled by whoever holds this secret. The raw value goes to the
   browser once at issuance; only its hash is stored, so a database leak cannot
   be used to order printed cards against other people's records. */
const createCardToken = () => crypto.randomBytes(24).toString('base64url');
const hashToken = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max || 200);
}

// Addresses keep their line breaks: they are printed on the card.
function cleanAddress(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, all) => line || (index > 0 && all[index - 1]))
    .join('\n')
    .trim()
    .slice(0, max || 220);
}

function normaliseMobile(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));

/* The PIN is read out of the address the applicant already typed rather than
   asked for again. One less field, and the two can never disagree. */
function extractPin(address) {
  const match = String(address || '').match(/(?:^|\D)(\d{6})(?:\D|$)/);
  return match ? match[1] : '';
}

/* The address is stored in Title Case, every word, whether it was typed,
   pasted or filled from the Location button. */
function parseAddress(value, label) {
  const address = RULES.titleCase(cleanAddress(value, 220));
  if (address.replace(/\s/g, '').length < 10) throw new Error(`Enter the full ${label}, including the PIN code.`);
  const pin = extractPin(address);
  if (!pin) throw new Error(`Include a 6-digit PIN code in the ${label}.`);
  if (!RULES.isPin(pin)) throw new Error(`The PIN code in the ${label} should be 6 digits and not start with 0.`);
  const addressError = RULES.checkField('address', address, { required: true });
  if (addressError) throw new Error(addressError);
  return { address, pin };
}

/* The application asks for five things and nothing else: photograph, name,
   mobile, email, address. Each one either prints on the card or is needed to
   reach the holder. Anything failing that test is not asked for. */
function parseApplication(body) {
  /* The same rules the form applies, so nothing posted straight at the API
     can land in the register that the form would have refused. */
  const parsed = RULES.parseFields(body, [
    ['name', { required: true, emptyMessage: 'Enter the name for the card.' }],
    ['mobile', { required: true, emptyMessage: 'Enter a 10-digit Indian mobile number.' }],
    ['email', { required: true, emptyMessage: 'Enter a valid email address so the card can be sent to you.' }]
  ]);
  if (!parsed.ok) throw new Error(parsed.message);
  const name = parsed.values.name.slice(0, 60);
  const mobile = parsed.values.mobile;
  const email = parsed.values.email;

  const { address, pin } = parseAddress(body && body.address, 'address');
  /* District and state print on the face of the card. Optional at this
     layer so an old caller keeps working; the form asks for both. */
  const district = clean(body && body.district, 60);
  const state = clean(body && body.state, 40);
  return { name, mobile, email, address, pin, district, state };
}

/* Delivery is only ever asked for when it differs from the address already
   given. Same address is the default and costs the applicant nothing to say. */
function parseDeliveryChoice(body) {
  const flag = String((body && body.deliverElsewhere) || '').toLowerCase();
  const elsewhere = ['yes', 'true', '1', 'on'].includes(flag);
  if (!elsewhere) return { sameAsCardAddress: true };

  const { address, pin } = parseAddress(body && body.deliveryAddress, 'delivery address');
  const recipientError = RULES.checkField('recipient', body && body.recipient, { required: true, emptyMessage: 'Enter who should receive the card.' });
  if (recipientError) throw new Error(recipientError);
  const recipient = RULES.normaliseField('recipient', body && body.recipient).slice(0, 60);
  return { sameAsCardAddress: false, recipient, address, pin };
}

function addressFingerprint(address, pin) {
  const normalised = `${String(address || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${pin || ''}`;
  return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 32);
}

function computeValidity(issuedAtIso) {
  const issued = issuedAtIso ? new Date(issuedAtIso) : new Date();
  const from = isNaN(issued.getTime()) ? new Date() : issued;
  const until = new Date(from.getTime());
  until.setFullYear(until.getFullYear() + VALIDITY_YEARS);
  return { issuedAt: from.toISOString(), validUntil: until.toISOString() };
}

function cardStanding(card, now) {
  if (!card) return 'unknown';
  if (card.status === 'revoked') return 'revoked';
  const at = now ? new Date(now) : new Date();
  const validUntil = card.validUntil ? new Date(card.validUntil) : null;
  if (validUntil && validUntil.getTime() <= at.getTime()) return 'expired';
  return 'active';
}

/* Shipment lifecycle. Forward-only along the happy path with terminal exits
   available before delivery, so a courier webhook or a mis-click cannot walk a
   shipment backwards or mark a cancelled parcel delivered. */
const SHIPMENT_FLOW = ['order_confirmed', 'preparing', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];
const SHIPMENT_EXITS = ['exception', 'cancelled', 'returned'];

const SHIPMENT_LABELS = {
  order_confirmed: 'Order confirmed',
  preparing: 'Preparing',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery exception',
  cancelled: 'Cancelled',
  returned: 'Returned to sender'
};

const isShipmentStatus = (status) => SHIPMENT_FLOW.includes(status) || SHIPMENT_EXITS.includes(status);
const shipmentLabel = (status) => SHIPMENT_LABELS[status] || 'Unknown';

function canTransition(from, to) {
  if (!isShipmentStatus(to)) return false;
  if (!from) return to === 'order_confirmed';
  if (from === to) return false;
  if (['delivered', 'cancelled', 'returned'].includes(from)) return false;
  if (SHIPMENT_EXITS.includes(to)) return true;
  if (from === 'exception') return SHIPMENT_FLOW.indexOf(to) >= SHIPMENT_FLOW.indexOf('dispatched');
  return SHIPMENT_FLOW.indexOf(to) > SHIPMENT_FLOW.indexOf(from);
}

/* Every step is recorded in history, but only these reach the inbox: a parcel
   scanning through four in-transit hops must not send four emails. */
const NOTIFIABLE = ['dispatched', 'out_for_delivery', 'delivered', 'exception', 'cancelled', 'returned'];
const shouldNotify = (status) => NOTIFIABLE.includes(status);

/* What the public card page is allowed to show. A card number is printed on the
   card and shown to police and neighbours, so a found card must never become a
   way to pull up the holder's phone number, email or home address. */
function publicProjection({ card, shipment }) {
  const projection = {
    cardId: card.cardId,
    name: card.name || '',
    /* the name as the card prints it, settled when it was issued */
    printName: card.printName || '',
    district: card.district || '',
    state: card.state || '',
    standing: cardStanding(card),
    issuedAt: card.issuedAt || null,
    validUntil: card.validUntil || null,
    printed: Boolean(card.printed)
  };

  if (shipment) {
    projection.delivery = {
      trackingId: shipment.trackingId,
      status: shipment.status,
      statusLabel: shipmentLabel(shipment.status),
      carrier: shipment.carrier || null,
      carrierTrackingNumber: shipment.carrierTrackingNumber || null,
      dispatchedAt: shipment.dispatchedAt || null,
      deliveredAt: shipment.deliveredAt || null,
      updatedAt: shipment.updatedAt || null,
      history: Array.isArray(shipment.history)
        ? shipment.history.map((entry) => ({
            status: entry.status,
            statusLabel: shipmentLabel(entry.status),
            at: entry.at,
            note: entry.note || null
          }))
        : []
    };
  }

  return projection;
}

/* Where the printed card is posted (owner, 24 Oct 2026: "only physical card
   will go to the applicant"). The lines an envelope carries: the street as
   the applicant gave it (it ends with the town), then the district when the
   street does not already name it, then the state and the PIN. A PIN that
   is already in the street is not written twice. */
function postalLines(record) {
  const r = record || {};
  const street = clean(r.address, 240).replace(/\s*,\s*$/, '');
  const district = clean(r.district, 60);
  const state = clean(r.state, 40);
  const pin = clean(r.pin, 10).replace(/\D/g, '');
  const has = (word) => word && new RegExp(`(^|[^a-z])${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(street.toLowerCase());
  const lines = [];
  if (street) lines.push(pin && street.includes(pin) ? street.replace(new RegExp(`[\\s,-]*${pin}`), '').trim() : street);
  if (district && !has(district)) lines.push(district);
  const last = [state, pin].filter(Boolean).join(' ');
  if (last) lines.push(last);
  return lines.filter(Boolean);
}

/* Whether the card can be posted at all: a street and a six-digit PIN. */
function postable(record) {
  const r = record || {};
  return Boolean(clean(r.address, 240)) && /^\d{6}$/.test(clean(r.pin, 10).replace(/\D/g, ''));
}

module.exports = {
  ALPHABET,
  householdKey,
  identityKey,
  CARD_ID_PATTERN,
  ORDER_ID_PATTERN,
  SHIPMENT_EXITS,
  SHIPMENT_FLOW,
  SHIPMENT_ID_PATTERN,
  SHIPMENT_LABELS,
  SHIPPING_PRICE,
  VALIDITY_YEARS,
  addressFingerprint,
  canTransition,
  cardStanding,
  clean,
  cleanAddress,
  computeValidity,
  createAddressId,
  createApplicantId,
  createCardId,
  createCardToken,
  createEventId,
  createOrderId,
  createShipmentId,
  extractPin,
  hashToken,
  isShipmentStatus,
  normaliseMobile,
  parseAddress,
  parseApplication,
  parseDeliveryChoice,
  postable,
  postalLines,
  publicProjection,
  safeEqual,
  shipmentLabel,
  shouldNotify,
  validEmail
};
