'use strict';
/* The address a parcel or a card is posted to.
   ------------------------------------------------------------------------
   Owner, 29 Oct 2026: "for all orders like ecom ones and card dispatches ask
   for proper mailing address including their house number etc. else will be
   hard to email.. check everysuch place on the end user website and update".

   The form fields are house, street and landmark (a gift's giftHouse,
   giftStreet and giftLandmark); the line is stored as address.

   Everything PFA posts or sends by courier (a membership card and kit, a
   colony caregiver card, a shop order, a gift's certificate) is asked for in
   three parts, on the page and here:

     house     House or flat number, and building   required
     street    Street and area                      required
     landmark  A landmark                           optional

   and stored as one line, in that order ("Flat 4B, Sai Residency, 12th
   Cross, Kodavoor, Near Sri Krishna Temple"), which is what the courier
   label, the admin panel and CCAvenue read. The parts are kept beside it.
   ------------------------------------------------------------------------ */
const RULES = require('../assets/field-rules.js');

const SAY = {
  house: 'Add the house or flat number and the building, so the courier finds the door.',
  street: 'Add the street and area.',
  streetWords: 'Add the street or area by name, not just numbers.'
};

const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const bare = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* "Krishna temple" reads to a courier as "Near Krishna Temple"; a landmark
   already said with its own word (opposite, behind, next to) is kept. */
const LANDMARK_WORD = /^(near|nr\.?|opp\.?|opposite|behind|beside|besides|next to|in front of|close to|above|below|off|after|before|adjacent to|facing)\b/i;

function compose(house, street, landmark) {
  const parts = [];
  /* a person who typed the house again at the start of the street is not
     printed twice; a bare number reads with its street ("12 MG Road") */
  const again = house && bare(street).startsWith(bare(house));
  if (house && !again && street && /^#?\d[\w/-]{0,7}$/.test(house)) parts.push(`${house} ${street}`);
  else {
    if (house && !again) parts.push(house);
    if (street) parts.push(street);
  }
  if (landmark) parts.push(LANDMARK_WORD.test(landmark) ? landmark : `Near ${landmark}`);
  return parts.join(', ');
}

/* Reads the three parts from a posted form. `names` maps them to the form's
   own field names (a gift's are giftHouse, giftStreet, giftLandmark).
   Throws an Error with the message to show; returns the parts and the
   address line. */
function read(body, names, labels) {
  const n = Object.assign({ house: 'house', street: 'street', landmark: 'landmark', line: 'address' }, names || {});
  const say = Object.assign({}, SAY, labels || {});
  const b = body || {};
  const rawHouse = clean(b[n.house], 120);
  /* a page from before the parts sent the street as the whole line */
  const rawStreet = clean(b[n.street] != null && String(b[n.street]).trim() ? b[n.street] : b[n.line], 240);
  const rawLandmark = clean(b[n.landmark], 160);
  /* A page from before the parts (an open tab, an old app) sends one line.
     It is taken only if it carries a house number; otherwise the person is
     asked for the door like everyone else. */
  const lineOnly = !rawHouse && !String(b[n.street] == null ? '' : b[n.street]).trim();
  if (lineOnly && rawStreet && /\d/.test(rawStreet)) {
    const line = RULES.normaliseField('address', rawStreet);
    const lineError = RULES.checkField('address', line, { required: true });
    if (lineError) throw fieldError(n.line, lineError);
    return { address: line, house: '', street: line, landmark: rawLandmark ? RULES.normaliseField('locality', rawLandmark) : '' };
  }
  if (!rawHouse) throw fieldError(n.house, say.house);
  const houseError = RULES.checkField('house', rawHouse, { required: true });
  if (houseError) throw fieldError(n.house, houseError);
  if (!rawStreet) throw fieldError(n.street, say.street);
  if (!/\p{L}.*\p{L}/u.test(rawStreet)) throw fieldError(n.street, say.streetWords);
  const streetError = RULES.checkField('locality', rawStreet, { required: true });
  if (streetError && !/under 120/.test(streetError)) throw fieldError(n.street, streetError);
  if (rawLandmark) {
    const landmarkError = RULES.checkField('locality', rawLandmark, { required: false });
    if (landmarkError) throw fieldError(n.landmark, landmarkError);
  }
  const house = RULES.normaliseField('house', rawHouse);
  const street = RULES.normaliseField('address', rawStreet);
  const landmark = rawLandmark ? RULES.normaliseField('locality', rawLandmark) : '';
  const address = RULES.normaliseField('address', compose(house, street, landmark));
  const lineError = RULES.checkField('address', address, { required: true });
  if (lineError) throw fieldError(n.street, lineError);
  return { address, house, street, landmark };
}

function fieldError(field, message) {
  const error = new Error(message);
  error.field = field;
  return error;
}

module.exports = { read, compose, SAY };
